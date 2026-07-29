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
