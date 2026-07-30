import { db, newId, getBrewsForBag, countBrewsForBag } from "../db/db.js";
import {
  parseDateInputValue,
  dateToInputValue,
  todayDateInputValue,
} from "../utils/dates.js";
import { formatBrewDetails } from "./brews.js";
import { renderRoasterForm } from "./roasters.js";

const BAG_TYPES = ["Espresso", "Filter"];
const ROAST_PROCESSES = ["Washed", "Natural", "Honey", "Anaerobic", "Other"];
const PAGE_SIZE = 10;

/**
 * @param {import("../models/types.js").Bag} bag
 * @returns {string}
 */
export function formatBagDetails(bag) {
  const details = [bag.type, bag.roastDate.toLocaleDateString()];
  if (bag.origin) details.push(bag.origin);
  if (bag.process) details.push(bag.process);
  if (bag.weightGrams) details.push(`${bag.weightGrams}g`);
  return details.join(", ");
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {{
 *   bagId?: string,
 *   isModal?: boolean,
 *   onSaved?: (bag: import("../models/types.js").Bag) => void | Promise<void>,
 *   onDeleted?: () => void | Promise<void>,
 * }} [options]
 */
export async function renderBagForm(container, nav, options = {}) {
  const { bagId, isModal, onSaved, onDeleted } = options;
  const [roasters, existing] = await Promise.all([
    db.roasters.orderBy("name").toArray(),
    bagId ? db.bags.get(bagId) : undefined,
  ]);

  // Editing an existing bag from a sheet (the Coffee page's tap-to-edit
  // flow) skips the Cancel button in favor of the sheet's drag-to-dismiss
  // gesture, and adds Delete — mirrors the Roaster/Grinder/Brewer sheets.
  const isEditSheet = isModal && bagId;

  container.innerHTML = `
    <h1>${bagId ? "Edit bag" : "Add bag"}</h1>
    <form id="bag-form">
      <div>
        <label for="bag-name">Name</label>
        <input id="bag-name" name="name" type="text" placeholder="e.g. Sunrise Espresso Blend" autocomplete="off" required />
      </div>
      <div>
        <label for="bag-roaster">Roaster</label>
        <select id="bag-roaster" name="roasterId" required></select>
        <button type="button" id="add-roaster-inline">+ Add new roaster</button>
      </div>
      <div>
        <label for="bag-roast-date">Roast date</label>
        <input id="bag-roast-date" name="roastDate" type="date" max="${todayDateInputValue()}" autocomplete="off" required />
      </div>
      <div>
        <label for="bag-type">Type</label>
        <select id="bag-type" name="type" required>
          ${BAG_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="bag-origin">Origin</label>
        <input id="bag-origin" name="origin" type="text" placeholder="e.g. Ethiopia, Yirgacheffe" autocomplete="off" />
      </div>
      <div>
        <label for="bag-process">Process</label>
        <select id="bag-process" name="process">
          <option value="">—</option>
          ${ROAST_PROCESSES.map((process) => `<option value="${process}">${process}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="bag-weight">Weight (g)</label>
        <input id="bag-weight" name="weightGrams" type="number" min="0" autocomplete="off" />
      </div>
      ${
        isEditSheet
          ? `
        <div class="sheet-actions">
          <button type="submit" class="brew-button">Save bag</button>
        </div>
      `
          : `
        <button type="submit">${bagId ? "Save bag" : "Add bag"}</button>
        <button type="button" id="bag-form-cancel">Cancel</button>
      `
      }
    </form>
    ${
      isEditSheet
        ? `
      <div class="sheet-secondary-actions">
        <button type="button" id="bag-form-delete" class="sheet-danger-button">Delete bag</button>
      </div>
    `
        : ""
    }
  `;

  const roasterSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#bag-roaster")
  );
  for (const roaster of roasters) {
    const option = document.createElement("option");
    option.value = roaster.id;
    option.textContent = roaster.name;
    roasterSelect.append(option);
  }

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#bag-form")
  );
  const nameInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#bag-name")
  );
  const roastDateInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#bag-roast-date")
  );
  const typeSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#bag-type")
  );
  const originInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#bag-origin")
  );
  const processSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#bag-process")
  );
  const weightInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#bag-weight")
  );

  nameInput.value = existing?.name ?? "";
  if (existing) roasterSelect.value = existing.roasterId;
  roastDateInput.value = existing ? dateToInputValue(existing.roastDate) : "";
  if (existing) typeSelect.value = existing.type;
  originInput.value = existing?.origin ?? "";
  if (existing?.process) processSelect.value = existing.process;
  weightInput.value =
    existing?.weightGrams != null ? String(existing.weightGrams) : "";

  const cancelButton = /** @type {HTMLButtonElement | null} */ (
    container.querySelector("#bag-form-cancel")
  );
  cancelButton?.addEventListener("click", () => {
    if (isModal) nav.hideModal();
    else nav.goBack();
  });

  if (isEditSheet) {
    const deleteButton = /** @type {HTMLButtonElement} */ (
      container.querySelector("#bag-form-delete")
    );
    deleteButton.addEventListener("click", async () => {
      if (!(await nav.confirm("Delete this bag?", { confirmLabel: "Delete" })))
        return;
      await db.bags.delete(bagId);
      nav.hideModal();
      await onDeleted?.();
    });
  }

  const addRoasterButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-roaster-inline")
  );
  addRoasterButton.addEventListener("click", () => {
    nav.showModal((modalContainer) =>
      renderRoasterForm(modalContainer, nav, {
        isModal: true,
        onSaved: (roaster) => {
          const option = document.createElement("option");
          option.value = roaster.id;
          option.textContent = roaster.name;
          roasterSelect.append(option);
          roasterSelect.value = roaster.id;
          nav.hideModal();
        },
      }),
    );
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const roasterId = String(data.get("roasterId") ?? "");
    const roastDate = String(data.get("roastDate") ?? "");
    const type = String(data.get("type") ?? "");
    const origin = String(data.get("origin") ?? "").trim();
    const process = String(data.get("process") ?? "").trim();
    const weightGrams = String(data.get("weightGrams") ?? "").trim();
    if (!name || !roasterId || !roastDate || !type) return;
    if (roastDate > todayDateInputValue()) return;

    const fields = {
      name,
      roasterId,
      roastDate: parseDateInputValue(roastDate),
      type: /** @type {import("../models/types.js").BagType} */ (type),
      origin: origin || undefined,
      process: /** @type {import("../models/types.js").RoastProcess | undefined} */ (
        process || undefined
      ),
      weightGrams: weightGrams ? Number(weightGrams) : undefined,
    };

    /** @type {import("../models/types.js").Bag} */
    let saved;
    if (bagId) {
      await db.bags.update(bagId, fields);
      saved = { id: bagId, createdAt: existing?.createdAt ?? new Date(), ...fields };
    } else {
      saved = { id: newId(), createdAt: new Date(), ...fields };
      await db.bags.add(saved);
    }

    if (onSaved) {
      await onSaved(saved);
    } else if (isModal) {
      nav.hideModal();
    } else {
      await nav.goBack();
    }
  });
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderBagsList(container, nav) {
  const roasters = await db.roasters.orderBy("name").toArray();

  container.innerHTML = `
    <h1>Bags</h1>
    <button type="button" id="add-bag">Add bag</button>
    <ul id="bag-list"></ul>
  `;

  const addButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-bag")
  );
  addButton.addEventListener("click", () => {
    nav.navigate((c) => renderBagForm(c, nav));
  });

  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#bag-list")
  );

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    const viewId = target.dataset.viewId;
    if (viewId) {
      await nav.navigate((c) => renderBagDetail(c, nav, viewId));
      return;
    }

    const editId = target.dataset.editId;
    if (editId) {
      await nav.navigate((c) => renderBagForm(c, nav, { bagId: editId }));
      return;
    }

    const deleteId = target.dataset.deleteId;
    if (!deleteId) return;

    if (!(await nav.confirm("Delete this bag?", { confirmLabel: "Delete" })))
      return;
    await db.bags.delete(deleteId);
    await renderList();
  });

  async function renderList() {
    const roasterNames = new Map(roasters.map((r) => [r.id, r.name]));
    const bags = await db.bags.orderBy("roastDate").reverse().toArray();
    list.innerHTML = "";

    for (const bag of bags) {
      const item = document.createElement("li");

      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.textContent = `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"}`;
      nameButton.dataset.viewId = bag.id;
      item.append(nameButton);

      item.append(` — ${formatBagDetails(bag)}`);

      item.append(" — ");
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.dataset.editId = bag.id;
      item.append(editButton);

      item.append(" ");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.dataset.deleteId = bag.id;
      item.append(deleteButton);

      list.append(item);
    }
  }

  await renderList();
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {string} bagId
 */
export async function renderBagDetail(container, nav, bagId) {
  const bag = await db.bags.get(bagId);
  if (!bag) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = "Bag not found.";
    container.append(message);
    return;
  }

  const [roaster, grinders, brewers] = await Promise.all([
    db.roasters.get(bag.roasterId),
    db.grinders.toArray(),
    db.brewers.toArray(),
  ]);
  const grinderNames = new Map(grinders.map((g) => [g.id, g.name]));
  const brewerNames = new Map(brewers.map((b) => [b.id, b.name]));

  container.innerHTML = `
    <h1 id="bag-detail-title"></h1>
    <p id="bag-detail-meta"></p>
    <h2>Brews</h2>
    <ul id="bag-detail-brews"></ul>
    <div id="bag-detail-pagination"></div>
  `;

  const title = /** @type {HTMLElement} */ (
    container.querySelector("#bag-detail-title")
  );
  title.textContent = bag.name;

  const meta = /** @type {HTMLElement} */ (
    container.querySelector("#bag-detail-meta")
  );
  meta.textContent = `${roaster?.name ?? "Unknown roaster"} — ${formatBagDetails(bag)}`;

  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#bag-detail-brews")
  );
  const pagination = /** @type {HTMLElement} */ (
    container.querySelector("#bag-detail-pagination")
  );

  let offset = 0;

  async function renderPage() {
    const [brews, total] = await Promise.all([
      getBrewsForBag(bagId, { offset, limit: PAGE_SIZE }),
      countBrewsForBag(bagId),
    ]);

    list.innerHTML = "";

    if (brews.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No brews logged for this bag yet.";
      list.append(empty);
    }

    for (const brew of brews) {
      const item = document.createElement("li");

      const rating = document.createElement("strong");
      rating.textContent = `${"★".repeat(brew.rating)}${"☆".repeat(5 - brew.rating)}`;
      item.append(rating);

      item.append(` — ${formatBrewDetails(brew, grinderNames, brewerNames)}`);

      if (brew.notes) {
        const notes = document.createElement("div");
        notes.textContent = brew.notes;
        item.append(notes);
      }

      list.append(item);
    }

    pagination.innerHTML = "";
    if (total > PAGE_SIZE) {
      const prevButton = document.createElement("button");
      prevButton.type = "button";
      prevButton.textContent = "Previous";
      prevButton.disabled = offset === 0;
      prevButton.addEventListener("click", () => {
        offset = Math.max(0, offset - PAGE_SIZE);
        renderPage();
      });

      const status = document.createElement("span");
      status.textContent = ` ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total} `;

      const nextButton = document.createElement("button");
      nextButton.type = "button";
      nextButton.textContent = "Next";
      nextButton.disabled = offset + PAGE_SIZE >= total;
      nextButton.addEventListener("click", () => {
        offset += PAGE_SIZE;
        renderPage();
      });

      pagination.append(prevButton, status, nextButton);
    }
  }

  await renderPage();
}
