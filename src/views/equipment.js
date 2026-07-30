import { db } from "../db/db.js";
import { renderGrinderEditSheet } from "./grinders.js";
import { renderBrewerEditSheet } from "./brewers.js";

/**
 * @param {import("../models/types.js").Grinder | import("../models/types.js").Brewer} equipment
 * @returns {string}
 */
function formatLastCleaned(equipment) {
  return equipment.lastCleanedDate
    ? `Last cleaned ${equipment.lastCleanedDate.toLocaleDateString()}`
    : "Never cleaned";
}

/**
 * Equipment page — Grinders and Brewers, each shown as a mat of cards
 * (styled like Recent Brews on the home screen). Tapping a card opens its
 * edit form in a bottom sheet; saving or closing the sheet dismisses it.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderEquipmentHome(container, nav) {
  container.innerHTML = `
    <h1>Equipment</h1>
    <section class="equipment-section">
      <h2>Grinders</h2>
      <ul id="grinder-equipment-list" class="equipment-list"></ul>
      <div class="brew-button-frame">
        <button type="button" id="add-grinder-button" class="brew-button">Add grinder</button>
      </div>
    </section>
    <section class="equipment-section">
      <h2>Brewers</h2>
      <ul id="brewer-equipment-list" class="equipment-list"></ul>
      <div class="brew-button-frame">
        <button type="button" id="add-brewer-button" class="brew-button">Add brewer</button>
      </div>
    </section>
  `;

  const grinderList = /** @type {HTMLUListElement} */ (
    container.querySelector("#grinder-equipment-list")
  );
  const brewerList = /** @type {HTMLUListElement} */ (
    container.querySelector("#brewer-equipment-list")
  );

  async function renderGrinderList() {
    const grinders = await db.grinders.orderBy("name").toArray();
    grinderList.innerHTML = "";

    if (grinders.length === 0) {
      const empty = document.createElement("li");
      empty.className = "equipment-empty";
      empty.textContent = "No grinders yet.";
      grinderList.append(empty);
      return;
    }

    for (const grinder of grinders) {
      const item = document.createElement("li");
      item.className = "equipment-item";
      item.dataset.grinderId = grinder.id;

      const name = document.createElement("span");
      name.className = "equipment-item-name";
      name.textContent = grinder.name;
      item.append(name);

      const meta = document.createElement("span");
      meta.className = "equipment-item-meta";
      meta.textContent = formatLastCleaned(grinder);
      item.append(meta);

      grinderList.append(item);
    }
  }

  async function renderBrewerList() {
    const brewers = await db.brewers.orderBy("name").toArray();
    brewerList.innerHTML = "";

    if (brewers.length === 0) {
      const empty = document.createElement("li");
      empty.className = "equipment-empty";
      empty.textContent = "No brewers yet.";
      brewerList.append(empty);
      return;
    }

    for (const brewer of brewers) {
      const item = document.createElement("li");
      item.className = "equipment-item";
      item.dataset.brewerId = brewer.id;

      const name = document.createElement("span");
      name.className = "equipment-item-name";
      name.textContent = brewer.name;
      item.append(name);

      const meta = document.createElement("span");
      meta.className = "equipment-item-meta";
      meta.textContent = formatLastCleaned(brewer);
      item.append(meta);

      brewerList.append(item);
    }
  }

  grinderList.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const item = target.closest("[data-grinder-id]");
    const grinderId = /** @type {HTMLElement | null} */ (item)?.dataset
      .grinderId;
    if (!grinderId) return;

    const grinder = await db.grinders.get(grinderId);
    if (!grinder) return;

    nav.showModal((sheet) =>
      renderGrinderEditSheet(sheet, nav, grinder, renderGrinderList),
    );
  });

  brewerList.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const item = target.closest("[data-brewer-id]");
    const brewerId = /** @type {HTMLElement | null} */ (item)?.dataset
      .brewerId;
    if (!brewerId) return;

    const brewer = await db.brewers.get(brewerId);
    if (!brewer) return;

    nav.showModal((sheet) =>
      renderBrewerEditSheet(sheet, nav, brewer, renderBrewerList),
    );
  });

  const addGrinderButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-grinder-button")
  );
  addGrinderButton.addEventListener("click", () => {
    nav.showModal((sheet) =>
      renderGrinderEditSheet(sheet, nav, undefined, renderGrinderList),
    );
  });

  const addBrewerButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-brewer-button")
  );
  addBrewerButton.addEventListener("click", () => {
    nav.showModal((sheet) =>
      renderBrewerEditSheet(sheet, nav, undefined, renderBrewerList),
    );
  });

  await Promise.all([renderGrinderList(), renderBrewerList()]);
}
