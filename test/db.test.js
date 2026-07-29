import "fake-indexeddb/auto";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  db,
  newId,
  getSettings,
  setDefaultGrinderId,
  deleteGrinder,
  getRecentBags,
  getBagsForRoaster,
  countBagsForRoaster,
  getBrewsForBag,
  countBrewsForBag,
  getBrewDatesInMonth,
  exportAllData,
  importAllData,
} from "../src/db/db.js";

beforeEach(async () => {
  await Promise.all([
    db.roasters.clear(),
    db.bags.clear(),
    db.grinders.clear(),
    db.brews.clear(),
    db.settings.clear(),
  ]);
});

/**
 * @param {Partial<import("../src/models/types.js").Roaster>} [overrides]
 */
async function addRoaster(overrides = {}) {
  const roaster = { id: newId(), name: "Test Roaster", ...overrides };
  await db.roasters.add(roaster);
  return roaster;
}

/**
 * @param {string} roasterId
 * @param {Partial<import("../src/models/types.js").Bag>} [overrides]
 */
async function addBag(roasterId, overrides = {}) {
  /** @type {import("../src/models/types.js").Bag} */
  const bag = {
    id: newId(),
    name: "Test Bag",
    roasterId,
    roastDate: new Date(2026, 0, 1),
    type: "Espresso",
    createdAt: new Date(2026, 0, 1),
    ...overrides,
  };
  await db.bags.add(bag);
  return bag;
}

/**
 * @param {string} bagId
 * @param {string} grinderId
 * @param {Partial<import("../src/models/types.js").Brew>} [overrides]
 */
async function addBrew(bagId, grinderId, overrides = {}) {
  /** @type {import("../src/models/types.js").Brew} */
  const brew = {
    id: newId(),
    bagId,
    grinderId,
    brewDate: new Date(2026, 0, 1),
    createdAt: new Date(2026, 0, 1),
    grindSize: 20,
    extractionTimeSeconds: 28,
    rating: 3,
    ...overrides,
  };
  await db.brews.add(brew);
  return brew;
}

test("getRecentBags ranks by brew *logging* time, not the possibly-backdated brew date", async () => {
  const roaster = await addRoaster();
  const oldBag = await addBag(roaster.id, {
    name: "Old bag",
    createdAt: new Date(2026, 0, 1),
  });
  const newBag = await addBag(roaster.id, {
    name: "New bag",
    createdAt: new Date(2026, 0, 10),
  });
  const grinder = { id: newId(), name: "Grinder" };
  await db.grinders.add(grinder);

  // A brew logged "just now" (createdAt) but backdated to a much earlier
  // brewDate should still count as recent activity for oldBag.
  await addBrew(oldBag.id, grinder.id, {
    brewDate: new Date(2020, 0, 1),
    createdAt: new Date(2026, 0, 20),
  });

  const recent = await getRecentBags(2);
  assert.equal(recent[0].id, oldBag.id);
  assert.equal(recent[1].id, newBag.id);
});

test("getBagsForRoaster paginates via offset/limit in roastDate-descending order", async () => {
  const roaster = await addRoaster();
  const otherRoaster = await addRoaster({ name: "Other Roaster" });
  await addBag(otherRoaster.id, { name: "Not mine" });

  const bags = [];
  for (let i = 0; i < 5; i++) {
    bags.push(
      await addBag(roaster.id, {
        name: `Bag ${i}`,
        roastDate: new Date(2026, 0, i + 1),
      }),
    );
  }

  const total = await countBagsForRoaster(roaster.id);
  assert.equal(total, 5);

  const page1 = await getBagsForRoaster(roaster.id, { offset: 0, limit: 2 });
  assert.deepEqual(
    page1.map((b) => b.name),
    ["Bag 4", "Bag 3"],
  );

  const page2 = await getBagsForRoaster(roaster.id, { offset: 2, limit: 2 });
  assert.deepEqual(
    page2.map((b) => b.name),
    ["Bag 2", "Bag 1"],
  );
});

test("getBrewsForBag paginates via offset/limit in brewDate-descending order", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const grinder = { id: newId(), name: "Grinder" };
  await db.grinders.add(grinder);

  for (let i = 0; i < 3; i++) {
    await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 0, i + 1) });
  }

  const total = await countBrewsForBag(bag.id);
  assert.equal(total, 3);

  const page = await getBrewsForBag(bag.id, { offset: 1, limit: 1 });
  assert.equal(page.length, 1);
  assert.equal(page[0].brewDate.getDate(), 2);
});

test("getBrewDatesInMonth returns the set of days with a logged brew, excluding other months", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const grinder = { id: newId(), name: "Grinder" };
  await db.grinders.add(grinder);

  await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 5, 3) });
  await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 5, 3) }); // same day, twice
  await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 5, 15) });
  await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 6, 1) }); // next month
  await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 4, 30) }); // previous month

  const days = await getBrewDatesInMonth(2026, 5);
  assert.deepEqual([...days].sort((a, b) => a - b), [3, 15]);
});

test("deleteGrinder reassigns the default to another grinder when the default is deleted", async () => {
  const a = { id: newId(), name: "Grinder A" };
  const b = { id: newId(), name: "Grinder B" };
  await db.grinders.bulkAdd([a, b]);
  await setDefaultGrinderId(a.id);

  await deleteGrinder(a.id);

  const settings = await getSettings();
  assert.equal(settings?.defaultGrinderId, b.id);
});

test("deleteGrinder clears the default when no grinders remain", async () => {
  const a = { id: newId(), name: "Grinder A" };
  await db.grinders.add(a);
  await setDefaultGrinderId(a.id);

  await deleteGrinder(a.id);

  const settings = await getSettings();
  assert.equal(settings?.defaultGrinderId, undefined);
});

test("exportAllData / importAllData round-trips all tables and Date fields", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id, {
    roastDate: new Date(2026, 5, 15),
  });
  const grinder = {
    id: newId(),
    name: "Grinder",
    lastCleanedDate: new Date(2026, 5, 1),
  };
  await db.grinders.add(grinder);
  await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 5, 20) });
  await setDefaultGrinderId(grinder.id);

  const exported = await exportAllData();

  // Round-trip through JSON, exactly like the real export/import file does.
  const reparsed = JSON.parse(JSON.stringify(exported));

  await Promise.all([
    db.roasters.clear(),
    db.bags.clear(),
    db.grinders.clear(),
    db.brews.clear(),
    db.settings.clear(),
  ]);

  await importAllData(reparsed);

  const [roasters, bags, grinders, brews, settings] = await Promise.all([
    db.roasters.toArray(),
    db.bags.toArray(),
    db.grinders.toArray(),
    db.brews.toArray(),
    getSettings(),
  ]);

  assert.equal(roasters.length, 1);
  assert.equal(bags.length, 1);
  assert.ok(bags[0].roastDate instanceof Date);
  assert.equal(bags[0].roastDate.getTime(), bag.roastDate.getTime());
  assert.equal(grinders.length, 1);
  assert.ok(grinders[0].lastCleanedDate instanceof Date);
  assert.equal(brews.length, 1);
  assert.ok(brews[0].brewDate instanceof Date);
  assert.equal(settings?.defaultGrinderId, grinder.id);
});

test("importAllData rejects a file with an unrecognized export version", async () => {
  await assert.rejects(
    () => importAllData({ exportVersion: 999 }),
    /export/i,
  );
});
