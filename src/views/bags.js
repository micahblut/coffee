import { db, newId, getBrewsForBag, countBrewsForBag } from "../db/db.js";
import {
  parseDateInputValue,
  dateToInputValue,
  todayDateInputValue,
} from "../utils/dates.js";
import { formatBrewDetails } from "./brews.js";

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
 * @param {import("../main.js").Navigate} navigate
 */
export async function renderBags(container, navigate) {
  const roasters = await db.roasters.orderBy("name").toArray();

  if (roasters.length === 0) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = "Add a roaster first before logging a bag.";
    container.append(message);
    return;
  }

  container.innerHTML = `
    <h1>Bags</h1>
    <form id="bag-form">
      <div>
        <label for="bag-name">Name</label>
        <input id="bag-name" name="name" type="text" placeholder="e.g. Sunrise Espresso Blend" required />
      </div>
      <div>
        <label for="bag-roaster">Roaster</label>
        <select id="bag-roaster" name="roasterId" required></select>
      </div>
      <div>
        <label for="bag-roast-date">Roast date</label>
        <input id="bag-roast-date" name="roastDate" type="date" max="${todayDateInputValue()}" required />
      </div>
      <div>
        <label for="bag-type">Type</label>
        <select id="bag-type" name="type" required>
          ${BAG_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="bag-origin">Origin</label>
        <input id="bag-origin" name="origin" type="text" placeholder="e.g. Ethiopia, Yirgacheffe" />
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
        <input id="bag-weight" name="weightGrams" type="number" min="0" />
      </div>
      <button type="submit" id="bag-submit">Add bag</button>
      <button type="button" id="bag-cancel" hidden>Cancel</button>
    </form>
    <ul id="bag-list"></ul>
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
  const submitButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#bag-submit")
  );
  const cancelButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#bag-cancel")
  );
  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#bag-list")
  );

  /** @type {string | null} */
  let editingId = null;

  function resetToCreateMode() {
    editingId = null;
    form.reset();
    submitButton.textContent = "Add bag";
    cancelButton.hidden = true;
  }

  cancelButton.addEventListener("click", resetToCreateMode);

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

    if (editingId) {
      await db.bags.update(editingId, fields);
    } else {
      await db.bags.add({ id: newId(), createdAt: new Date(), ...fields });
    }

    resetToCreateMode();
    await renderList();
  });

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    const viewId = target.dataset.viewId;
    if (viewId) {
      await navigate((c) => renderBagDetail(c, navigate, viewId));
      return;
    }

    if (target.dataset.editId) {
      const bag = await db.bags.get(target.dataset.editId);
      if (!bag) return;

      editingId = bag.id;
      nameInput.value = bag.name;
      roasterSelect.value = bag.roasterId;
      roastDateInput.value = dateToInputValue(bag.roastDate);
      typeSelect.value = bag.type;
      originInput.value = bag.origin ?? "";
      processSelect.value = bag.process ?? "";
      weightInput.value = bag.weightGrams != null ? String(bag.weightGrams) : "";
      submitButton.textContent = "Save bag";
      cancelButton.hidden = false;
      return;
    }

    const bagId = target.dataset.deleteId;
    if (!bagId) return;

    if (!confirm("Delete this bag?")) return;
    await db.bags.delete(bagId);
    if (editingId === bagId) resetToCreateMode();
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
 * @param {import("../main.js").Navigate} navigate
 * @param {string} bagId
 */
export async function renderBagDetail(container, navigate, bagId) {
  const bag = await db.bags.get(bagId);
  if (!bag) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = "Bag not found.";
    container.append(message);
    return;
  }

  const [roaster, grinders] = await Promise.all([
    db.roasters.get(bag.roasterId),
    db.grinders.toArray(),
  ]);
  const grinderNames = new Map(grinders.map((g) => [g.id, g.name]));

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

      item.append(` — ${formatBrewDetails(brew, grinderNames)}`);

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
