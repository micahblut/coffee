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
