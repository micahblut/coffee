import Dexie from "../vendor/dexie.mjs";

/**
 * @typedef {import("../models/types.js").Roaster} Roaster
 * @typedef {import("../models/types.js").Bag} Bag
 * @typedef {import("../models/types.js").Grinder} Grinder
 * @typedef {import("../models/types.js").Brew} Brew
 * @typedef {import("../models/types.js").Settings} Settings
 */

export const db = /** @type {Dexie & {
 *   roasters: import("../vendor/dexie.d.mts").EntityTable<Roaster, "id">,
 *   bags: import("../vendor/dexie.d.mts").EntityTable<Bag, "id">,
 *   grinders: import("../vendor/dexie.d.mts").EntityTable<Grinder, "id">,
 *   brews: import("../vendor/dexie.d.mts").EntityTable<Brew, "id">,
 *   settings: import("../vendor/dexie.d.mts").EntityTable<Settings, "id">,
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

/**
 * @returns {Promise<Settings | undefined>}
 */
export async function getSettings() {
  return db.settings.get(SETTINGS_ID);
}

/**
 * @param {string} grinderId
 */
export async function setDefaultGrinderId(grinderId) {
  await db.settings.put({ id: SETTINGS_ID, defaultGrinderId: grinderId });
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

const EXPORT_VERSION = 1;

/**
 * @typedef {Object} ExportedData
 * @property {number} exportVersion
 * @property {string} exportedAt
 * @property {Settings[]} settings
 * @property {Grinder[]} grinders
 * @property {Roaster[]} roasters
 * @property {Bag[]} bags
 * @property {Brew[]} brews
 */

/**
 * @returns {Promise<ExportedData>}
 */
export async function exportAllData() {
  const [settings, grinders, roasters, bags, brews] = await Promise.all([
    db.settings.toArray(),
    db.grinders.toArray(),
    db.roasters.toArray(),
    db.bags.toArray(),
    db.brews.toArray(),
  ]);

  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    grinders,
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
  const brews = reviveDates(parsed.brews ?? [], ["brewDate", "createdAt"]);
  const settings = parsed.settings ?? [];

  await db.transaction(
    "rw",
    db.roasters,
    db.bags,
    db.grinders,
    db.brews,
    db.settings,
    async () => {
      await Promise.all([
        db.roasters.clear(),
        db.bags.clear(),
        db.grinders.clear(),
        db.brews.clear(),
        db.settings.clear(),
      ]);
      await Promise.all([
        db.roasters.bulkAdd(roasters),
        db.bags.bulkAdd(bags),
        db.grinders.bulkAdd(grinders),
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
    await db.settings.put({ id: SETTINGS_ID, defaultGrinderId: nextDefault?.id });
  });
}

/**
 * @param {string} grinderId
 */
export async function markGrinderCleaned(grinderId) {
  await db.grinders.update(grinderId, { lastCleanedDate: new Date() });
}

const CLEANING_DUE_SOON_RATIO = 0.8;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} CleaningStatus
 * @property {"due-soon" | "overdue"} level
 * @property {"grinds" | "weeks"} metric
 * @property {number} amount Non-negative — remaining (due-soon) or overage (overdue).
 */

/**
 * Checks whether a grinder is due (or overdue) for cleaning, based on
 * whichever configured interval — grind count or elapsed weeks — is
 * proportionally closer to its limit. This mirrors a "whichever comes
 * first" maintenance schedule (like a car's oil-change interval): grind
 * count is the primary signal, elapsed time is a backstop for grinders
 * that see light use but still accumulate residue over time.
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
  const weeksSinceClean =
    (Date.now() - lastCleanedDate.getTime()) / MS_PER_WEEK;

  const grindsRatio =
    grinder.cleaningIntervalGrinds != null
      ? grindsSinceClean / grinder.cleaningIntervalGrinds
      : -Infinity;
  const weeksRatio =
    grinder.cleaningIntervalWeeks != null
      ? weeksSinceClean / grinder.cleaningIntervalWeeks
      : -Infinity;

  if (Math.max(grindsRatio, weeksRatio) < CLEANING_DUE_SOON_RATIO) return null;

  if (grindsRatio >= weeksRatio) {
    // grindsRatio can only win a comparison against a finite weeksRatio (or
    // -Infinity) by itself being finite, which means cleaningIntervalGrinds
    // must be set — the ratio computation above already proved this.
    const interval = /** @type {number} */ (grinder.cleaningIntervalGrinds);
    const remaining = interval - grindsSinceClean;
    return remaining > 0
      ? { level: "due-soon", metric: "grinds", amount: remaining }
      : { level: "overdue", metric: "grinds", amount: -remaining };
  }

  const weeksInterval = /** @type {number} */ (grinder.cleaningIntervalWeeks);
  const remainingWeeks = weeksInterval - weeksSinceClean;
  return remainingWeeks > 0
    ? { level: "due-soon", metric: "weeks", amount: Math.ceil(remainingWeeks) }
    : { level: "overdue", metric: "weeks", amount: Math.round(-remainingWeeks) };
}
