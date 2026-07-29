import Dexie from "../vendor/dexie.mjs";

/**
 * @typedef {import("../models/types.js").Roaster} Roaster
 * @typedef {import("../models/types.js").Bag} Bag
 * @typedef {import("../models/types.js").Grinder} Grinder
 * @typedef {import("../models/types.js").Brew} Brew
 */

export const db = /** @type {Dexie & {
 *   roasters: import("../vendor/dexie.d.mts").EntityTable<Roaster, "id">,
 *   bags: import("../vendor/dexie.d.mts").EntityTable<Bag, "id">,
 *   grinders: import("../vendor/dexie.d.mts").EntityTable<Grinder, "id">,
 *   brews: import("../vendor/dexie.d.mts").EntityTable<Brew, "id">,
 * }} */ (new Dexie("caffe"));

db.version(1).stores({
  roasters: "id, name",
  bags: "id, roasterId, roastDate, type",
  grinders: "id, name",
  brews: "id, bagId, grinderId, brewDate, rating",
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
