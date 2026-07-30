import "fake-indexeddb/auto";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  db,
  newId,
  getSettings,
  updateSettings,
  setDefaultGrinderId,
  setDefaultBrewerId,
  deleteGrinder,
  deleteBrewer,
  getRecentBags,
  getBagsForRoaster,
  countBagsForRoaster,
  getBrewsForBag,
  countBrewsForBag,
  getBrewDatesInMonth,
  markGrinderCleaned,
  markBrewerCleaned,
  getGrinderCleaningStatus,
  getBrewerCleaningStatus,
  exportAllData,
  importAllData,
} from "../src/db/db.js";
import { startOfToday } from "../src/utils/dates.js";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await Promise.all([
    db.roasters.clear(),
    db.bags.clear(),
    db.grinders.clear(),
    db.brewers.clear(),
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
 * @param {Partial<import("../src/models/types.js").Brewer>} [overrides]
 */
async function addBrewer(overrides = {}) {
  const brewer = { id: newId(), name: "Test Brewer", ...overrides };
  await db.brewers.add(brewer);
  return brewer;
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
    // Most tests here exercise grinder/bag/pagination logic and don't care
    // which brewer was used, so default to a fresh id rather than making
    // every call site pass one explicitly.
    brewerId: newId(),
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

test("getGrinderCleaningStatus returns null when no interval is configured", async () => {
  const grinder = {
    id: newId(),
    name: "G",
    lastCleanedDate: new Date(2020, 0, 1),
  };
  await db.grinders.add(grinder);

  assert.equal(await getGrinderCleaningStatus(grinder.id), null);
});

test("getGrinderCleaningStatus returns null when lastCleanedDate is unset, even with an interval configured", async () => {
  const grinder = { id: newId(), name: "G", cleaningIntervalGrinds: 100 };
  await db.grinders.add(grinder);

  assert.equal(await getGrinderCleaningStatus(grinder.id), null);
});

test("getGrinderCleaningStatus reports due-soon by grind count once past the warn threshold", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const grinder = {
    id: newId(),
    name: "G",
    lastCleanedDate: new Date(2026, 0, 1),
    cleaningIntervalGrinds: 10,
  };
  await db.grinders.add(grinder);
  for (let i = 0; i < 9; i++) {
    await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 0, 2 + i) });
  }

  const status = await getGrinderCleaningStatus(grinder.id);
  assert.deepEqual(status, { level: "due-soon", metric: "grinds", amount: 1 });
});

test("getGrinderCleaningStatus reports overdue by grind count past the limit", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const grinder = {
    id: newId(),
    name: "G",
    lastCleanedDate: new Date(2026, 0, 1),
    cleaningIntervalGrinds: 10,
  };
  await db.grinders.add(grinder);
  for (let i = 0; i < 13; i++) {
    await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 0, 2 + i) });
  }

  const status = await getGrinderCleaningStatus(grinder.id);
  assert.deepEqual(status, { level: "overdue", metric: "grinds", amount: 3 });
});

test("getGrinderCleaningStatus ignores brews logged before the last cleaning", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const grinder = {
    id: newId(),
    name: "G",
    lastCleanedDate: new Date(2026, 0, 10),
    cleaningIntervalGrinds: 5,
  };
  await db.grinders.add(grinder);
  for (let i = 0; i < 20; i++) {
    await addBrew(bag.id, grinder.id, { brewDate: new Date(2026, 0, 1) });
  }

  assert.equal(await getGrinderCleaningStatus(grinder.id), null);
});

test("getGrinderCleaningStatus stays quiet when neither interval is close", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const grinder = {
    id: newId(),
    name: "G",
    lastCleanedDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    cleaningIntervalGrinds: 100,
    cleaningIntervalWeeks: 10,
  };
  await db.grinders.add(grinder);
  await addBrew(bag.id, grinder.id, { brewDate: new Date() });

  assert.equal(await getGrinderCleaningStatus(grinder.id), null);
});

test("getGrinderCleaningStatus lets the weeks backstop (converted to days) take over for a lightly-used grinder", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const grinder = {
    id: newId(),
    name: "G",
    lastCleanedDate: new Date(Date.now() - 3.9 * MS_PER_WEEK),
    cleaningIntervalGrinds: 1000, // barely dented by one brew
    cleaningIntervalWeeks: 4,
  };
  await db.grinders.add(grinder);
  await addBrew(bag.id, grinder.id, { brewDate: new Date() });

  const status = await getGrinderCleaningStatus(grinder.id);
  assert.equal(status?.level, "due-soon");
  assert.equal(status?.metric, "days");
});

test("getGrinderCleaningStatus works with only a weeks interval configured, reporting in days", async () => {
  const grinder = {
    id: newId(),
    name: "G",
    lastCleanedDate: new Date(Date.now() - 6 * MS_PER_WEEK),
    cleaningIntervalWeeks: 4,
  };
  await db.grinders.add(grinder);

  const status = await getGrinderCleaningStatus(grinder.id);
  assert.equal(status?.level, "overdue");
  assert.equal(status?.metric, "days");
  assert.equal(status?.amount, 14); // 2 weeks overdue, expressed in days
});

test("getGrinderCleaningStatus counts a brew logged the same day the grinder was marked cleaned", async () => {
  // markGrinderCleaned and brewDate must agree on granularity (both
  // midnight-normalized) — otherwise a same-day brew's midnight timestamp
  // would fall before a "cleaned" timestamp stamped later that same day,
  // and get silently excluded from the grind count.
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const grinder = {
    id: newId(),
    name: "G",
    cleaningIntervalGrinds: 1,
  };
  await db.grinders.add(grinder);

  await markGrinderCleaned(grinder.id);
  await addBrew(bag.id, grinder.id, { brewDate: startOfToday() });
  await addBrew(bag.id, grinder.id, { brewDate: startOfToday() });

  const status = await getGrinderCleaningStatus(grinder.id);
  assert.deepEqual(status, { level: "overdue", metric: "grinds", amount: 1 });
});

test("markGrinderCleaned resets lastCleanedDate to the start of today", async () => {
  const grinder = {
    id: newId(),
    name: "G",
    lastCleanedDate: new Date(2020, 0, 1),
  };
  await db.grinders.add(grinder);

  await markGrinderCleaned(grinder.id);

  const updated = await db.grinders.get(grinder.id);
  assert.equal(updated?.lastCleanedDate?.getTime(), startOfToday().getTime());
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

test("updateSettings merges fields instead of overwriting the whole settings row", async () => {
  await setDefaultGrinderId("grinder-1");
  await updateSettings({ defaultDoseGrams: 18 });
  await updateSettings({ defaultYieldGrams: 36 });

  const settings = await getSettings();
  assert.equal(settings?.defaultGrinderId, "grinder-1");
  assert.equal(settings?.defaultDoseGrams, 18);
  assert.equal(settings?.defaultYieldGrams, 36);
});

test("getBrewerCleaningStatus reports due-soon by brew count once past the warn threshold", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const brewer = {
    id: newId(),
    name: "B",
    lastCleanedDate: new Date(2026, 0, 1),
    cleaningIntervalBrews: 10,
  };
  await db.brewers.add(brewer);
  for (let i = 0; i < 9; i++) {
    await addBrew(bag.id, newId(), {
      brewerId: brewer.id,
      brewDate: new Date(2026, 0, 2 + i),
    });
  }

  const status = await getBrewerCleaningStatus(brewer.id);
  assert.deepEqual(status, { level: "due-soon", metric: "brews", amount: 1 });
});

test("getBrewerCleaningStatus reports overdue by brew count past the limit", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const brewer = {
    id: newId(),
    name: "B",
    lastCleanedDate: new Date(2026, 0, 1),
    cleaningIntervalBrews: 10,
  };
  await db.brewers.add(brewer);
  for (let i = 0; i < 13; i++) {
    await addBrew(bag.id, newId(), {
      brewerId: brewer.id,
      brewDate: new Date(2026, 0, 2 + i),
    });
  }

  const status = await getBrewerCleaningStatus(brewer.id);
  assert.deepEqual(status, { level: "overdue", metric: "brews", amount: 3 });
});

test("getBrewerCleaningStatus lets the weeks backstop (converted to days) take over for a lightly-used brewer", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const brewer = {
    id: newId(),
    name: "B",
    lastCleanedDate: new Date(Date.now() - 3.9 * MS_PER_WEEK),
    cleaningIntervalBrews: 1000,
    cleaningIntervalWeeks: 4,
  };
  await db.brewers.add(brewer);
  await addBrew(bag.id, newId(), { brewerId: brewer.id, brewDate: new Date() });

  const status = await getBrewerCleaningStatus(brewer.id);
  assert.equal(status?.level, "due-soon");
  assert.equal(status?.metric, "days");
});

test("getBrewerCleaningStatus counts a brew logged the same day the brewer was marked cleaned", async () => {
  const roaster = await addRoaster();
  const bag = await addBag(roaster.id);
  const brewer = { id: newId(), name: "B", cleaningIntervalBrews: 1 };
  await db.brewers.add(brewer);

  await markBrewerCleaned(brewer.id);
  await addBrew(bag.id, newId(), {
    brewerId: brewer.id,
    brewDate: startOfToday(),
  });
  await addBrew(bag.id, newId(), {
    brewerId: brewer.id,
    brewDate: startOfToday(),
  });

  const status = await getBrewerCleaningStatus(brewer.id);
  assert.deepEqual(status, { level: "overdue", metric: "brews", amount: 1 });
});

test("markBrewerCleaned resets lastCleanedDate to the start of today", async () => {
  const brewer = {
    id: newId(),
    name: "B",
    lastCleanedDate: new Date(2020, 0, 1),
  };
  await db.brewers.add(brewer);

  await markBrewerCleaned(brewer.id);

  const updated = await db.brewers.get(brewer.id);
  assert.equal(updated?.lastCleanedDate?.getTime(), startOfToday().getTime());
});

test("deleteBrewer reassigns the default to another brewer when the default is deleted", async () => {
  const a = await addBrewer({ name: "Brewer A" });
  const b = await addBrewer({ name: "Brewer B" });
  await setDefaultBrewerId(a.id);

  await deleteBrewer(a.id);

  const settings = await getSettings();
  assert.equal(settings?.defaultBrewerId, b.id);
});

test("deleteBrewer clears the default when no brewers remain, without touching other settings", async () => {
  const a = await addBrewer({ name: "Brewer A" });
  await setDefaultGrinderId("grinder-1");
  await setDefaultBrewerId(a.id);

  await deleteBrewer(a.id);

  const settings = await getSettings();
  assert.equal(settings?.defaultBrewerId, undefined);
  assert.equal(settings?.defaultGrinderId, "grinder-1");
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
  const brewer = await addBrewer({
    name: "Brewer",
    lastCleanedDate: new Date(2026, 5, 1),
  });
  await addBrew(bag.id, grinder.id, {
    brewerId: brewer.id,
    brewDate: new Date(2026, 5, 20),
  });
  await setDefaultGrinderId(grinder.id);
  await setDefaultBrewerId(brewer.id);

  const exported = await exportAllData();

  // Round-trip through JSON, exactly like the real export/import file does.
  const reparsed = JSON.parse(JSON.stringify(exported));

  await Promise.all([
    db.roasters.clear(),
    db.bags.clear(),
    db.grinders.clear(),
    db.brewers.clear(),
    db.brews.clear(),
    db.settings.clear(),
  ]);

  await importAllData(reparsed);

  const [roasters, bags, grinders, brewers, brews, settings] =
    await Promise.all([
      db.roasters.toArray(),
      db.bags.toArray(),
      db.grinders.toArray(),
      db.brewers.toArray(),
      db.brews.toArray(),
      getSettings(),
    ]);

  assert.equal(roasters.length, 1);
  assert.equal(bags.length, 1);
  assert.ok(bags[0].roastDate instanceof Date);
  assert.equal(bags[0].roastDate.getTime(), bag.roastDate.getTime());
  assert.equal(grinders.length, 1);
  assert.ok(grinders[0].lastCleanedDate instanceof Date);
  assert.equal(brewers.length, 1);
  assert.ok(brewers[0].lastCleanedDate instanceof Date);
  assert.equal(brews.length, 1);
  assert.ok(brews[0].brewDate instanceof Date);
  assert.equal(settings?.defaultBrewerId, brewer.id);
  assert.equal(settings?.defaultGrinderId, grinder.id);
});

test("importAllData rejects a file with an unrecognized export version", async () => {
  await assert.rejects(
    () => importAllData({ exportVersion: 999 }),
    /export/i,
  );
});
