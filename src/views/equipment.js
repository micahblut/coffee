import {
  db,
  markGrinderCleaned,
  markBrewerCleaned,
} from "../db/db.js";
import { renderGrinderEditSheet } from "./grinders.js";
import { renderBrewerEditSheet, brewerTypeIcon } from "./brewers.js";

const PENCIL_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;
// Lucide's "wand-sparkles" icon.
const MARK_CLEANED_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"></path><path d="m14 7 3 3"></path><path d="M5 6v4"></path><path d="M19 14v4"></path><path d="M10 2v2"></path><path d="M7 8H3"></path><path d="M21 16h-4"></path><path d="M11 3H9"></path></svg>`;

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
    <p class="page-help-text">Add your brewing equipment here. You can configure your default brewing setup in Settings.</p>
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

      const trailing = document.createElement("span");
      trailing.className = "equipment-item-trailing";

      const meta = document.createElement("span");
      meta.className = "equipment-item-meta";
      meta.textContent = formatLastCleaned(grinder);
      trailing.append(meta);

      const markCleanedButton = document.createElement("button");
      markCleanedButton.type = "button";
      markCleanedButton.className = "equipment-item-clean-button";
      markCleanedButton.dataset.markCleanedId = grinder.id;
      markCleanedButton.setAttribute("aria-label", "Mark cleaned");
      markCleanedButton.innerHTML = MARK_CLEANED_ICON;
      trailing.append(markCleanedButton);

      const editIcon = document.createElement("span");
      editIcon.className = "equipment-item-edit-icon";
      editIcon.innerHTML = PENCIL_ICON;
      trailing.append(editIcon);

      item.append(trailing);
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

      const leading = document.createElement("span");
      leading.className = "equipment-item-leading";

      const typeIcon = document.createElement("span");
      typeIcon.className = "equipment-item-type-icon";
      typeIcon.innerHTML = brewerTypeIcon(brewer.type);
      leading.append(typeIcon);

      const name = document.createElement("span");
      name.className = "equipment-item-name";
      name.textContent = brewer.name;
      leading.append(name);

      item.append(leading);

      const trailing = document.createElement("span");
      trailing.className = "equipment-item-trailing";

      const meta = document.createElement("span");
      meta.className = "equipment-item-meta";
      meta.textContent = formatLastCleaned(brewer);
      trailing.append(meta);

      const markCleanedButton = document.createElement("button");
      markCleanedButton.type = "button";
      markCleanedButton.className = "equipment-item-clean-button";
      markCleanedButton.dataset.markCleanedId = brewer.id;
      markCleanedButton.setAttribute("aria-label", "Mark cleaned");
      markCleanedButton.innerHTML = MARK_CLEANED_ICON;
      trailing.append(markCleanedButton);

      const editIcon = document.createElement("span");
      editIcon.className = "equipment-item-edit-icon";
      editIcon.innerHTML = PENCIL_ICON;
      trailing.append(editIcon);

      item.append(trailing);
      brewerList.append(item);
    }
  }

  grinderList.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;

    const markCleanedTarget = event.target.closest("[data-mark-cleaned-id]");
    const markCleanedId = /** @type {HTMLElement | null} */ (
      markCleanedTarget
    )?.dataset.markCleanedId;
    if (markCleanedId) {
      await markGrinderCleaned(markCleanedId);
      await renderGrinderList();
      return;
    }

    const item = event.target.closest("[data-grinder-id]");
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
    if (!(event.target instanceof Element)) return;

    const markCleanedTarget = event.target.closest("[data-mark-cleaned-id]");
    const markCleanedId = /** @type {HTMLElement | null} */ (
      markCleanedTarget
    )?.dataset.markCleanedId;
    if (markCleanedId) {
      await markBrewerCleaned(markCleanedId);
      await renderBrewerList();
      return;
    }

    const item = event.target.closest("[data-brewer-id]");
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
