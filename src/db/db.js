import Dexie from "../vendor/dexie.mjs";
import { startOfToday, startOfDay } from "../utils/dates.js";

/**
 * @typedef {import("../models/types.js").Roaster} Roaster
 * @typedef {import("../models/types.js").Bag} Bag
 * @typedef {import("../models/types.js").Grinder} Grinder
 * @typedef {import("../models/types.js").Brewer} Brewer
 * @typedef {import("../models/types.js").Brew} Brew
 * @typedef {import("../models/types.js").Settings} Settings
 */

/**
 * @typedef {Object} CachedCryptoKey
 * @property {string} id
 * @property {CryptoKey} key
 * @property {Date} cachedAt
 */

export const db = /** @type {Dexie & {
 *   roasters: import("../vendor/dexie.d.mts").EntityTable<Roaster, "id">,
 *   bags: import("../vendor/dexie.d.mts").EntityTable<Bag, "id">,
 *   grinders: import("../vendor/dexie.d.mts").EntityTable<Grinder, "id">,
 *   brewers: import("../vendor/dexie.d.mts").EntityTable<Brewer, "id">,
 *   brews: import("../vendor/dexie.d.mts").EntityTable<Brew, "id">,
 *   settings: import("../vendor/dexie.d.mts").EntityTable<Settings, "id">,
 *   cryptoKeys: import("../vendor/dexie.d.mts").EntityTable<CachedCryptoKey, "id">,
 * }} */ (new Dexie("caffe"));

db.version(1).stores({
  roasters: "id, name",
  bags: "id, roasterId, roastDate, type",
  grinders: "id, name",
  brews: "id, bagId, grinderId, brewDate, rating",
  settings: "id",
});

db.version(2)
  .stores({
    roasters: "id, name",
    bags: "id, roasterId, roastDate, type, createdAt",
    grinders: "id, name",
    brews: "id, bagId, grinderId, brewDate, rating",
    settings: "id",
  })
  .upgrade(async (tx) => {
    // Existing bags predate createdAt; backfill with roastDate as the best
    // available approximation of when the bag was added.
    await tx
      .table("bags")
      .toCollection()
      .modify((bag) => {
        bag.createdAt = bag.roastDate;
      });
  });

// Compound indexes let child-entity lookups (bags for a roaster, brews for a
// bag) walk an index in sorted order directly, so offset/limit paginate via
// the index cursor instead of loading the full filtered set into memory.
db.version(3).stores({
  roasters: "id, name",
  bags: "id, roasterId, roastDate, type, createdAt, [roasterId+roastDate]",
  grinders: "id, name",
  brews: "id, bagId, grinderId, brewDate, rating, [bagId+brewDate]",
  settings: "id",
});

db.version(4).stores({
  roasters: "id, name",
  bags: "id, roasterId, roastDate, type, createdAt, [roasterId+roastDate]",
  grinders: "id, name",
  brewers: "id, name",
  brews: "id, bagId, grinderId, brewerId, brewDate, rating, [bagId+brewDate]",
  settings: "id",
});

db.version(5)
  .stores({
    roasters: "id, name",
    bags: "id, roasterId, roastDate, type, createdAt, [roasterId+roastDate]",
    grinders: "id, name",
    brewers: "id, name, type",
    brews: "id, bagId, grinderId, brewerId, brewDate, rating, [bagId+brewDate]",
    settings: "id",
  })
  .upgrade(async (tx) => {
    // Existing brewers predate the espresso/filter distinction — default to
    // Espresso (the more common dedicated "brewer" this app tracks) rather
    // than leaving it unset, since the field is required going forward.
    // Users can correct it per-brewer after upgrading.
    await tx
      .table("brewers")
      .toCollection()
      .modify((brewer) => {
        brewer.type = "Espresso";
      });
  });

// cryptoKeys caches the PRF-derived backup encryption key as a
// non-extractable CryptoKey (IndexedDB structured-clones these without ever
// exposing raw key bytes to JS). Deliberately never added to exportAllData's
// table list — it must never appear in a cloud backup or a local file export.
db.version(6).stores({
  roasters: "id, name",
  bags: "id, roasterId, roastDate, type, createdAt, [roasterId+roastDate]",
  grinders: "id, name",
  brewers: "id, name, type",
  brews: "id, bagId, grinderId, brewerId, brewDate, rating, [bagId+brewDate]",
  settings: "id",
  cryptoKeys: "id",
});

/**
 * Generates a client-side id for a new record. Using client-generated ids
 * (rather than autoincrement) means local records can sync to a future
 * backend without id collisions.
 * @returns {string}
 */
export function newId() {
  return crypto.randomUUID();
}

const SETTINGS_ID = "settings";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @returns {Promise<Settings | undefined>}
 */
export async function getSettings() {
  return db.settings.get(SETTINGS_ID);
}

/**
 * Merges the given fields into the singleton settings row. `db.settings.put`
 * overwrites the whole row, so this reads the current row first — otherwise
 * setting one default (e.g. dose) would wipe out the others (e.g. grinder).
 * @param {Partial<Settings>} fields
 */
export async function updateSettings(fields) {
  const current = await db.settings.get(SETTINGS_ID);
  await db.settings.put({ ...current, id: SETTINGS_ID, ...fields });
}

/**
 * @param {string | undefined} grinderId
 */
export async function setDefaultGrinderId(grinderId) {
  await updateSettings({ defaultGrinderId: grinderId });
}

/**
 * @param {string | undefined} brewerId
 */
export async function setDefaultBrewerId(brewerId) {
  await updateSettings({ defaultBrewerId: brewerId });
}

/**
 * Returns up to `limit` bags ranked by most recent activity — whichever is
 * more recent of when the bag was added or when a brew was last logged
 * against it (by logging time, not the possibly-backdated brew date). Used
 * to surface likely "currently open" bags as quick picks when logging a brew.
 * @param {number} limit
 * @returns {Promise<Bag[]>}
 */
export async function getRecentBags(limit) {
  const [bags, brews] = await Promise.all([
    db.bags.toArray(),
    db.brews.toArray(),
  ]);

  const lastLoggedAtByBagId = new Map();
  for (const brew of brews) {
    const current = lastLoggedAtByBagId.get(brew.bagId);
    if (!current || brew.createdAt > current) {
      lastLoggedAtByBagId.set(brew.bagId, brew.createdAt);
    }
  }

  return bags
    .map((bag) => {
      const lastLoggedAt = lastLoggedAtByBagId.get(bag.id);
      const lastActivity =
        lastLoggedAt && lastLoggedAt > bag.createdAt
          ? lastLoggedAt
          : bag.createdAt;
      return { bag, lastActivity };
    })
    .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime())
    .slice(0, limit)
    .map((entry) => entry.bag);
}

/**
 * @typedef {Object} Page
 * @property {number} [offset]
 * @property {number} [limit]
 */

/**
 * @typedef {Object} BagWithRating
 * @property {Bag} bag
 * @property {number | null} averageRating null if the bag has no brews
 *   logged yet
 * @property {number} brewCount
 */

/**
 * A page of every bag, most-recently-roasted first, each annotated with its
 * average brew rating — used for the Coffee page's "Recent bags" list,
 * which (despite the name) is the full bag catalog ordered by roast date,
 * not a bounded preview. Walks the roastDate index directly, so offset/limit
 * paginate via the index cursor rather than sorting the full set in memory.
 * @param {Page} [page]
 * @returns {Promise<BagWithRating[]>}
 */
export async function getBagsPageWithRatings({ offset = 0, limit } = {}) {
  let collection = db.bags.orderBy("roastDate").reverse().offset(offset);
  if (limit != null) collection = collection.limit(limit);
  const bags = await collection.toArray();

  const brews = await db.brews
    .where("bagId")
    .anyOf(bags.map((bag) => bag.id))
    .toArray();

  /** @type {Map<string, Brew[]>} */
  const brewsByBagId = new Map();
  for (const brew of brews) {
    const bagBrews = brewsByBagId.get(brew.bagId) ?? [];
    bagBrews.push(brew);
    brewsByBagId.set(brew.bagId, bagBrews);
  }

  return bags.map((bag) => {
    const bagBrews = brewsByBagId.get(bag.id) ?? [];
    const averageRating = bagBrews.length
      ? bagBrews.reduce((sum, brew) => sum + brew.rating, 0) / bagBrews.length
      : null;
    return { bag, averageRating, brewCount: bagBrews.length };
  });
}

/**
 * Bags belonging to a roaster, most recently roasted first. Walks the
 * [roasterId+roastDate] compound index directly, so offset/limit paginate
 * via the index cursor rather than sorting the full result set in memory.
 * @param {string} roasterId
 * @param {Page} [page]
 * @returns {Promise<Bag[]>}
 */
export async function getBagsForRoaster(roasterId, { offset = 0, limit } = {}) {
  let collection = db.bags
    .where("[roasterId+roastDate]")
    .between([roasterId, Dexie.minKey], [roasterId, Dexie.maxKey])
    .reverse()
    .offset(offset);
  if (limit != null) collection = collection.limit(limit);
  return collection.toArray();
}

/**
 * @param {string} roasterId
 * @returns {Promise<number>}
 */
export async function countBagsForRoaster(roasterId) {
  return db.bags.where("roasterId").equals(roasterId).count();
}

/**
 * @typedef {Object} RatedBag
 * @property {Bag} bag
 * @property {number} averageRating
 * @property {number} brewCount
 */

/**
 * A roaster's bags ranked by average brew rating, highest first. Bags with
 * fewer than `minBrews` brews are excluded — a bag with one 5-star brew
 * isn't meaningfully "best rated" next to one with twenty brews averaging
 * 4.8, and a bag's first brew or two are often still-dialing-in test shots
 * rather than a fair read on the coffee itself.
 * @param {string} roasterId
 * @param {{ limit?: number, minBrews?: number }} [options]
 * @returns {Promise<RatedBag[]>}
 */
export async function getBestRatedBagsForRoaster(
  roasterId,
  { limit = 5, minBrews = 5 } = {},
) {
  const bags = await db.bags.where("roasterId").equals(roasterId).toArray();
  if (bags.length === 0) return [];

  const brews = await db.brews
    .where("bagId")
    .anyOf(bags.map((bag) => bag.id))
    .toArray();

  /** @type {Map<string, Brew[]>} */
  const brewsByBagId = new Map();
  for (const brew of brews) {
    const bagBrews = brewsByBagId.get(brew.bagId) ?? [];
    bagBrews.push(brew);
    brewsByBagId.set(brew.bagId, bagBrews);
  }

  return bags
    .map((bag) => {
      const bagBrews = brewsByBagId.get(bag.id) ?? [];
      const averageRating =
        bagBrews.reduce((sum, brew) => sum + brew.rating, 0) /
        (bagBrews.length || 1);
      return { bag, averageRating, brewCount: bagBrews.length };
    })
    .filter((entry) => entry.brewCount >= minBrews)
    .sort((a, b) => b.averageRating - a.averageRating)
    .slice(0, limit);
}

/**
 * A page of a roaster's bags ranked by average brew rating, highest first —
 * used for the Roaster View's "Favorite bags" list, which (like the Coffee
 * page's Favorite Roasters) is the roaster's full set of bags, not a bounded
 * leaderboard. Unrated bags (no logged brews yet) are included with an
 * average of 0 rather than excluded, so a newly-added bag shows up
 * immediately instead of being invisible until it earns enough brews. Ties
 * break alphabetically by bag name.
 * @param {string} roasterId
 * @param {Page} [page]
 * @returns {Promise<RatedBag[]>}
 */
export async function getRoasterBagsRankedByRating(roasterId, { offset = 0, limit } = {}) {
  const bags = await db.bags.where("roasterId").equals(roasterId).toArray();
  if (bags.length === 0) return [];

  const brews = await db.brews
    .where("bagId")
    .anyOf(bags.map((bag) => bag.id))
    .toArray();

  /** @type {Map<string, Brew[]>} */
  const brewsByBagId = new Map();
  for (const brew of brews) {
    const bagBrews = brewsByBagId.get(brew.bagId) ?? [];
    bagBrews.push(brew);
    brewsByBagId.set(brew.bagId, bagBrews);
  }

  const ranked = bags
    .map((bag) => {
      const bagBrews = brewsByBagId.get(bag.id) ?? [];
      const averageRating = bagBrews.length
        ? bagBrews.reduce((sum, brew) => sum + brew.rating, 0) / bagBrews.length
        : 0;
      return { bag, averageRating, brewCount: bagBrews.length };
    })
    .sort(
      (a, b) =>
        b.averageRating - a.averageRating || a.bag.name.localeCompare(b.bag.name),
    );

  return limit != null
    ? ranked.slice(offset, offset + limit)
    : ranked.slice(offset);
}

/**
 * @typedef {Object} RatedRoaster
 * @property {Roaster} roaster
 * @property {number} averageRating
 * @property {number} brewCount
 */

/**
 * A page of every roaster ranked by average brew rating across all of their
 * bags combined, highest first — used for the Coffee page's "Favorite Roasters"
 * list, which is the full roaster catalog, not a bounded leaderboard.
 * Unrated roasters (no logged brews yet) are included with an average of 0
 * rather than excluded, so a newly-added roaster shows up immediately
 * instead of being invisible until it earns enough brews. Ties (including
 * every unrated roaster, all tied at 0) break alphabetically by name.
 * Requires loading every roaster/bag/brew to compute the ranking regardless
 * of page — fine at hobbyist scale, same tradeoff as
 * getBestRatedBagsForRoaster above.
 * @param {Page} [page]
 * @returns {Promise<RatedRoaster[]>}
 */
export async function getRoastersRankedByRating({ offset = 0, limit } = {}) {
  const [roasters, bags, brews] = await Promise.all([
    db.roasters.toArray(),
    db.bags.toArray(),
    db.brews.toArray(),
  ]);

  const roasterIdByBagId = new Map(bags.map((bag) => [bag.id, bag.roasterId]));

  /** @type {Map<string, Brew[]>} */
  const brewsByRoasterId = new Map();
  for (const brew of brews) {
    const roasterId = roasterIdByBagId.get(brew.bagId);
    if (!roasterId) continue;
    const roasterBrews = brewsByRoasterId.get(roasterId) ?? [];
    roasterBrews.push(brew);
    brewsByRoasterId.set(roasterId, roasterBrews);
  }

  const ranked = roasters
    .map((roaster) => {
      const roasterBrews = brewsByRoasterId.get(roaster.id) ?? [];
      const averageRating = roasterBrews.length
        ? roasterBrews.reduce((sum, brew) => sum + brew.rating, 0) /
          roasterBrews.length
        : 0;
      return { roaster, averageRating, brewCount: roasterBrews.length };
    })
    .sort(
      (a, b) =>
        b.averageRating - a.averageRating ||
        a.roaster.name.localeCompare(b.roaster.name),
    );

  return limit != null
    ? ranked.slice(offset, offset + limit)
    : ranked.slice(offset);
}

/**
 * Brews logged against a bag, most recently brewed first. Walks the
 * [bagId+brewDate] compound index directly, same rationale as
 * getBagsForRoaster above.
 * @param {string} bagId
 * @param {Page} [page]
 * @returns {Promise<Brew[]>}
 */
export async function getBrewsForBag(bagId, { offset = 0, limit } = {}) {
  let collection = db.brews
    .where("[bagId+brewDate]")
    .between([bagId, Dexie.minKey], [bagId, Dexie.maxKey])
    .reverse()
    .offset(offset);
  if (limit != null) collection = collection.limit(limit);
  return collection.toArray();
}

/**
 * @param {string} bagId
 * @returns {Promise<number>}
 */
export async function countBrewsForBag(bagId) {
  return db.brews.where("bagId").equals(bagId).count();
}

/**
 * The top-rated brews logged against a bag, highest rating first (ties
 * broken by most recent). Unlike getBestRatedBagsForRoaster, this has no
 * minimum-count floor — it's surfacing this bag's own standout brews, not
 * ranking it against others.
 * @param {string} bagId
 * @param {number} [limit]
 * @returns {Promise<Brew[]>}
 */
export async function getBestBrewsForBag(bagId, limit = 5) {
  const brews = await db.brews.where("bagId").equals(bagId).toArray();
  return brews
    .sort(
      (a, b) =>
        b.rating - a.rating || b.brewDate.getTime() - a.brewDate.getTime(),
    )
    .slice(0, limit);
}

/**
 * @typedef {Object} RatingByDaysSinceRoast
 * @property {string} brewId
 * @property {number} daysSinceRoast
 * @property {number} rating
 */

/**
 * Every brew logged against a bag, as individual (days since roast, rating)
 * points for a freshness scatter plot — deliberately *not* averaged per day,
 * since a bag's first brew or two are often still-dialing-in test shots and
 * averaging them into a single point would hide that from the chart. Ties on
 * daysSinceRoast break by logging time (createdAt) — otherwise same-day
 * brews would sort in whatever order IndexedDB happens to iterate them,
 * which isn't guaranteed to be deterministic.
 * @param {string} bagId
 * @returns {Promise<RatingByDaysSinceRoast[]>}
 */
export async function getBrewRatingsByDaysSinceRoast(bagId) {
  const bag = await db.bags.get(bagId);
  if (!bag) return [];

  const brews = await db.brews.where("bagId").equals(bagId).toArray();
  return brews
    .map((brew) => ({
      brewId: brew.id,
      daysSinceRoast: Math.round(
        (brew.brewDate.getTime() - bag.roastDate.getTime()) / MS_PER_DAY,
      ),
      rating: brew.rating,
      createdAt: brew.createdAt,
    }))
    .sort(
      (a, b) =>
        a.daysSinceRoast - b.daysSinceRoast ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map(({ brewId, daysSinceRoast, rating }) => ({
      brewId,
      daysSinceRoast,
      rating,
    }));
}

/**
 * Days (1-31) within the given month that have at least one logged brew.
 * @param {number} year
 * @param {number} monthIndex 0-based, matching Date's convention
 * @returns {Promise<Set<number>>}
 */
export async function getBrewDatesInMonth(year, monthIndex) {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 1);
  const brews = await db.brews
    .where("brewDate")
    .between(start, end, true, false)
    .toArray();
  return new Set(brews.map((brew) => brew.brewDate.getDate()));
}

/**
 * Brews logged on a specific calendar day, most recently logged first.
 * @param {Date} date
 * @returns {Promise<Brew[]>}
 */
export async function getBrewsForDate(date) {
  const start = startOfDay(date);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const brews = await db.brews
    .where("brewDate")
    .between(start, end, true, false)
    .toArray();
  return brews.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * The most recently logged brews across all bags, most recent brewDate
 * first (ties broken by logging time). Mirrors getBestBrewsForBag's
 * in-memory sort — dataset is small enough (a hobbyist's own brew log)
 * that scanning the whole table is simpler than a compound index.
 * @param {number} limit
 * @returns {Promise<Brew[]>}
 */
export async function getRecentBrews(limit) {
  const brews = await db.brews.toArray();
  return brews
    .sort(
      (a, b) =>
        b.brewDate.getTime() - a.brewDate.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .slice(0, limit);
}

/**
 * True if there's no user-entered data at all — used to decide whether
 * signing in on a fresh device should pull the cloud backup down instead of
 * pushing this empty state up over it.
 * @returns {Promise<boolean>}
 */
export async function hasNoLocalData() {
  const counts = await Promise.all([
    db.roasters.count(),
    db.bags.count(),
    db.grinders.count(),
    db.brewers.count(),
    db.brews.count(),
  ]);
  return counts.every((count) => count === 0);
}

const EXPORT_VERSION = 1;

/**
 * @typedef {Object} ExportedData
 * @property {number} exportVersion
 * @property {string} exportedAt
 * @property {Settings[]} settings
 * @property {Grinder[]} grinders
 * @property {Brewer[]} brewers
 * @property {Roaster[]} roasters
 * @property {Bag[]} bags
 * @property {Brew[]} brews
 */

/**
 * @returns {Promise<ExportedData>}
 */
export async function exportAllData() {
  const [settings, grinders, brewers, roasters, bags, brews] =
    await Promise.all([
      db.settings.toArray(),
      db.grinders.toArray(),
      db.brewers.toArray(),
      db.roasters.toArray(),
      db.bags.toArray(),
      db.brews.toArray(),
    ]);

  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    grinders,
    brewers,
    roasters,
    bags,
    brews,
  };
}

/**
 * @template T
 * @param {T[]} rows
 * @param {(keyof T)[]} dateFields
 * @returns {T[]}
 */
function reviveDates(rows, dateFields) {
  return rows.map((row) => {
    const revived = { ...row };
    for (const field of dateFields) {
      if (revived[field] != null) {
        revived[field] = /** @type {any} */ (new Date(/** @type {any} */ (revived[field])));
      }
    }
    return revived;
  });
}

/**
 * Replaces all local data with the contents of a previously exported file.
 * @param {unknown} data
 */
export async function importAllData(data) {
  const parsed = /** @type {Partial<ExportedData> | null} */ (
    typeof data === "object" ? data : null
  );
  if (!parsed || parsed.exportVersion !== EXPORT_VERSION) {
    throw new Error("This file isn't a caffe export I recognize.");
  }

  const roasters = parsed.roasters ?? [];
  const bags = reviveDates(parsed.bags ?? [], ["roastDate", "createdAt"]);
  const grinders = reviveDates(parsed.grinders ?? [], ["lastCleanedDate"]);
  const brewers = reviveDates(parsed.brewers ?? [], ["lastCleanedDate"]);
  const brews = reviveDates(parsed.brews ?? [], ["brewDate", "createdAt"]);
  const settings = parsed.settings ?? [];

  await db.transaction(
    "rw",
    [db.roasters, db.bags, db.grinders, db.brewers, db.brews, db.settings],
    async () => {
      await Promise.all([
        db.roasters.clear(),
        db.bags.clear(),
        db.grinders.clear(),
        db.brewers.clear(),
        db.brews.clear(),
        db.settings.clear(),
      ]);
      await Promise.all([
        db.roasters.bulkAdd(roasters),
        db.bags.bulkAdd(bags),
        db.grinders.bulkAdd(grinders),
        db.brewers.bulkAdd(brewers),
        db.brews.bulkAdd(brews),
        db.settings.bulkAdd(settings),
      ]);
    },
  );
}

/**
 * Deletes a grinder. If it was the default, reassigns the default to another
 * remaining grinder (or clears it, if none are left) so settings never point
 * to a deleted grinder.
 * @param {string} grinderId
 */
export async function deleteGrinder(grinderId) {
  await db.transaction("rw", db.grinders, db.settings, async () => {
    await db.grinders.delete(grinderId);

    const settings = await db.settings.get(SETTINGS_ID);
    if (settings?.defaultGrinderId !== grinderId) return;

    const nextDefault = await db.grinders.orderBy("name").first();
    await db.settings.put({
      ...settings,
      defaultGrinderId: nextDefault?.id,
    });
  });
}

/**
 * Deletes a brewer. If it was the default, reassigns the default to another
 * remaining brewer (or clears it, if none are left) so settings never point
 * to a deleted brewer.
 * @param {string} brewerId
 */
export async function deleteBrewer(brewerId) {
  await db.transaction("rw", db.brewers, db.settings, async () => {
    await db.brewers.delete(brewerId);

    const settings = await db.settings.get(SETTINGS_ID);
    if (settings?.defaultBrewerId !== brewerId) return;

    const nextDefault = await db.brewers.orderBy("name").first();
    await db.settings.put({
      ...settings,
      defaultBrewerId: nextDefault?.id,
    });
  });
}

/**
 * @param {string} grinderId
 */
export async function markGrinderCleaned(grinderId) {
  await db.grinders.update(grinderId, { lastCleanedDate: startOfToday() });
}

/**
 * @param {string} brewerId
 */
export async function markBrewerCleaned(brewerId) {
  await db.brewers.update(brewerId, { lastCleanedDate: startOfToday() });
}

const CLEANING_DUE_SOON_RATIO = 0.9;
const DAYS_PER_WEEK = 7;

/**
 * @typedef {Object} CleaningStatus
 * @property {"due-soon" | "overdue"} level
 * @property {"grinds" | "brews" | "days"} metric
 * @property {number} amount Non-negative — remaining (due-soon) or overage (overdue).
 */

/**
 * Checks whether a grinder is due (or overdue) for cleaning, based on
 * whichever configured interval — grind count or elapsed time — is
 * proportionally closer to its limit. This mirrors a "whichever comes
 * first" maintenance schedule (like a car's oil-change interval): grind
 * count is the primary signal, elapsed time is a backstop for grinders
 * that see light use but still accumulate residue over time. The interval
 * is entered (and stored) in weeks for easy data entry, but the ratio and
 * remaining/overage amount are computed in days for a more granular signal
 * than whole weeks would give (e.g. "due in 3 days" instead of "due in 1
 * week").
 * @param {string} grinderId
 * @returns {Promise<CleaningStatus | null>} null if no interval is
 *   configured, lastCleanedDate is unset, or it isn't due soon yet.
 */
export async function getGrinderCleaningStatus(grinderId) {
  const grinder = await db.grinders.get(grinderId);
  if (!grinder?.lastCleanedDate) return null;
  if (
    grinder.cleaningIntervalGrinds == null &&
    grinder.cleaningIntervalWeeks == null
  ) {
    return null;
  }

  const lastCleanedDate = grinder.lastCleanedDate;
  const grindsSinceClean = await db.brews
    .where("grinderId")
    .equals(grinderId)
    .and((brew) => brew.brewDate >= lastCleanedDate)
    .count();
  const daysSinceClean = (Date.now() - lastCleanedDate.getTime()) / MS_PER_DAY;

  const grindsRatio =
    grinder.cleaningIntervalGrinds != null
      ? grindsSinceClean / grinder.cleaningIntervalGrinds
      : -Infinity;
  const daysRatio =
    grinder.cleaningIntervalWeeks != null
      ? daysSinceClean / (grinder.cleaningIntervalWeeks * DAYS_PER_WEEK)
      : -Infinity;

  if (Math.max(grindsRatio, daysRatio) < CLEANING_DUE_SOON_RATIO) return null;

  if (grindsRatio >= daysRatio) {
    // grindsRatio can only win a comparison against a finite daysRatio (or
    // -Infinity) by itself being finite, which means cleaningIntervalGrinds
    // must be set — the ratio computation above already proved this.
    const interval = /** @type {number} */ (grinder.cleaningIntervalGrinds);
    const remaining = interval - grindsSinceClean;
    return remaining > 0
      ? { level: "due-soon", metric: "grinds", amount: remaining }
      : { level: "overdue", metric: "grinds", amount: -remaining };
  }

  const intervalDays =
    /** @type {number} */ (grinder.cleaningIntervalWeeks) * DAYS_PER_WEEK;
  const remainingDays = intervalDays - daysSinceClean;
  return remainingDays > 0
    ? { level: "due-soon", metric: "days", amount: Math.ceil(remainingDays) }
    : { level: "overdue", metric: "days", amount: Math.round(-remainingDays) };
}

/**
 * Checks whether a brewer is due (or overdue) for cleaning. Mirrors
 * getGrinderCleaningStatus above — brew count is the primary signal,
 * elapsed time is a backstop for brewers that see light use.
 * @param {string} brewerId
 * @returns {Promise<CleaningStatus | null>} null if no interval is
 *   configured, lastCleanedDate is unset, or it isn't due soon yet.
 */
export async function getBrewerCleaningStatus(brewerId) {
  const brewer = await db.brewers.get(brewerId);
  if (!brewer?.lastCleanedDate) return null;
  if (
    brewer.cleaningIntervalBrews == null &&
    brewer.cleaningIntervalWeeks == null
  ) {
    return null;
  }

  const lastCleanedDate = brewer.lastCleanedDate;
  const brewsSinceClean = await db.brews
    .where("brewerId")
    .equals(brewerId)
    .and((brew) => brew.brewDate >= lastCleanedDate)
    .count();
  const daysSinceClean = (Date.now() - lastCleanedDate.getTime()) / MS_PER_DAY;

  const brewsRatio =
    brewer.cleaningIntervalBrews != null
      ? brewsSinceClean / brewer.cleaningIntervalBrews
      : -Infinity;
  const daysRatio =
    brewer.cleaningIntervalWeeks != null
      ? daysSinceClean / (brewer.cleaningIntervalWeeks * DAYS_PER_WEEK)
      : -Infinity;

  if (Math.max(brewsRatio, daysRatio) < CLEANING_DUE_SOON_RATIO) return null;

  if (brewsRatio >= daysRatio) {
    // brewsRatio can only win a comparison against a finite daysRatio (or
    // -Infinity) by itself being finite, which means cleaningIntervalBrews
    // must be set — the ratio computation above already proved this.
    const interval = /** @type {number} */ (brewer.cleaningIntervalBrews);
    const remaining = interval - brewsSinceClean;
    return remaining > 0
      ? { level: "due-soon", metric: "brews", amount: remaining }
      : { level: "overdue", metric: "brews", amount: -remaining };
  }

  const intervalDays =
    /** @type {number} */ (brewer.cleaningIntervalWeeks) * DAYS_PER_WEEK;
  const remainingDays = intervalDays - daysSinceClean;
  return remainingDays > 0
    ? { level: "due-soon", metric: "days", amount: Math.ceil(remainingDays) }
    : { level: "overdue", metric: "days", amount: Math.round(-remainingDays) };
}
