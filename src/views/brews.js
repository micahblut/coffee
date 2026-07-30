import {
  db,
  newId,
  getSettings,
  getRecentBags,
  getBrewsForDate,
  getGrinderCleaningStatus,
  getBrewerCleaningStatus,
} from "../db/db.js";
import {
  parseDateInputValue,
  dateToInputValue,
  todayDateInputValue,
} from "../utils/dates.js";
import { renderBagForm } from "./bags.js";
import { formatCleaningStatus } from "./grinders.js";

const RATINGS = [1, 2, 3, 4, 5];

/**
 * @param {import("../models/types.js").Brew} brew
 * @param {Map<string, string>} grinderNames
 * @param {Map<string, string>} brewerNames
 * @returns {string}
 */
export function formatBrewDetails(brew, grinderNames, brewerNames) {
  const details = [
    brew.brewDate.toLocaleDateString(),
    `brewer: ${brewerNames.get(brew.brewerId) ?? "Unknown"}`,
    `grinder: ${grinderNames.get(brew.grinderId) ?? "Unknown"}`,
    `grind ${brew.grindSize}`,
  ];
  if (brew.doseGrams && brew.yieldGrams) {
    details.push(`${brew.doseGrams}g → ${brew.yieldGrams}g`);
  } else if (brew.doseGrams) {
    details.push(`dose ${brew.doseGrams}g`);
  } else if (brew.yieldGrams) {
    details.push(`yield ${brew.yieldGrams}g`);
  }
  details.push(`${brew.extractionTimeSeconds}s`);
  if (brew.waterTempCelsius) details.push(`${brew.waterTempCelsius}°C`);
  return details.join(", ");
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {{
 *   brewId?: string,
 *   isModal?: boolean,
 *   onSaved?: (brew: import("../models/types.js").Brew) => void | Promise<void>,
 * }} [options]
 */
export async function renderBrewForm(container, nav, options = {}) {
  const { brewId, isModal, onSaved } = options;
  const [grinders, brewers] = await Promise.all([
    db.grinders.orderBy("name").toArray(),
    db.brewers.orderBy("name").toArray(),
  ]);

  // Unlike bags/roasters, there's no inline "+ Add new grinder/brewer" escape
  // hatch yet (users are expected to rarely have more than one or two), so
  // this is still a hard stop rather than a modal detour.
  if (grinders.length === 0) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent =
      "Add a grinder first before logging a brew (see the Grinders tab).";
    container.append(message);
    return;
  }
  if (brewers.length === 0) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent =
      "Add a brewer first before logging a brew (see the Brewers tab).";
    container.append(message);
    return;
  }

  const [bags, roasters, settings, existing] = await Promise.all([
    db.bags.orderBy("roastDate").reverse().toArray(),
    db.roasters.toArray(),
    getSettings(),
    brewId ? db.brews.get(brewId) : undefined,
  ]);

  const roasterNames = new Map(roasters.map((r) => [r.id, r.name]));
  const defaultGrinderId = settings?.defaultGrinderId;
  const defaultBrewerId = settings?.defaultBrewerId;

  container.innerHTML = `
    <h1>${brewId ? "Edit brew" : "Add brew"}</h1>
    <form id="brew-form">
      <div>
        <label for="brew-bag">Bag</label>
        <div id="recent-bags"></div>
        <select id="brew-bag" name="bagId" required></select>
        <button type="button" id="add-bag-inline">+ Add new bag</button>
      </div>
      <div>
        <label for="brew-brewer">Brewer</label>
        <select id="brew-brewer" name="brewerId" required></select>
        <div id="brewer-cleaning-status"></div>
      </div>
      <div>
        <label for="brew-grinder">Grinder</label>
        <select id="brew-grinder" name="grinderId" required></select>
        <div id="grinder-cleaning-status"></div>
      </div>
      <div>
        <label for="brew-date">Brew date</label>
        <input id="brew-date" name="brewDate" type="date" max="${todayDateInputValue()}" autocomplete="off" required />
      </div>
      <div>
        <label for="brew-grind-size">Grind size</label>
        <input id="brew-grind-size" name="grindSize" type="number" step="any" autocomplete="off" required />
      </div>
      <div>
        <label for="brew-dose">Dose (g)</label>
        <input id="brew-dose" name="doseGrams" type="number" step="any" min="0" autocomplete="off" />
      </div>
      <div>
        <label for="brew-yield">Yield (g)</label>
        <input id="brew-yield" name="yieldGrams" type="number" step="any" min="0" autocomplete="off" />
      </div>
      <div>
        <label for="brew-extraction-time">Extraction time (seconds)</label>
        <input id="brew-extraction-time" name="extractionTimeSeconds" type="number" min="0" autocomplete="off" required />
      </div>
      <div>
        <label for="brew-water-temp">Water temp (°C)</label>
        <input id="brew-water-temp" name="waterTempCelsius" type="number" step="any" autocomplete="off" />
      </div>
      <div>
        <label for="brew-rating">Rating</label>
        <select id="brew-rating" name="rating" required>
          <option value="" disabled selected>Select…</option>
          ${RATINGS.map((r) => `<option value="${r}">${r}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="brew-notes">Notes</label>
        <textarea id="brew-notes" name="notes" maxlength="256" rows="3" autocomplete="off"></textarea>
      </div>
      <button type="submit">${brewId ? "Save brew" : "Add brew"}</button>
      <button type="button" id="brew-form-cancel">Cancel</button>
    </form>
  `;

  const bagSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#brew-bag")
  );
  for (const bag of bags) {
    const option = document.createElement("option");
    option.value = bag.id;
    option.textContent = `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"} (${bag.roastDate.toLocaleDateString()})`;
    bagSelect.append(option);
  }
  if (existing) bagSelect.value = existing.bagId;

  const recentBagsContainer = /** @type {HTMLElement} */ (
    container.querySelector("#recent-bags")
  );

  async function renderRecentBags() {
    const recentBags = await getRecentBags(3);
    recentBagsContainer.innerHTML = "";

    for (const bag of recentBags) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"}`;
      button.addEventListener("click", () => {
        bagSelect.value = bag.id;
      });
      recentBagsContainer.append(button);
    }
  }

  const addBagButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-bag-inline")
  );
  addBagButton.addEventListener("click", () => {
    nav.showModal((modalContainer) =>
      renderBagForm(modalContainer, nav, {
        isModal: true,
        onSaved: async (bag) => {
          // roasterNames was snapshotted when this form loaded, so a roaster
          // created just now (nested inside this same detour) won't be in
          // it yet — refresh the entry rather than assume it's there.
          if (!roasterNames.has(bag.roasterId)) {
            const roaster = await db.roasters.get(bag.roasterId);
            if (roaster) roasterNames.set(roaster.id, roaster.name);
          }
          const option = document.createElement("option");
          option.value = bag.id;
          option.textContent = `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"} (${bag.roastDate.toLocaleDateString()})`;
          bagSelect.append(option);
          bagSelect.value = bag.id;
          nav.hideModal();
        },
      }),
    );
  });

  const grinderSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#brew-grinder")
  );
  for (const grinder of grinders) {
    const option = document.createElement("option");
    option.value = grinder.id;
    option.textContent = grinder.name;
    grinderSelect.append(option);
  }
  grinderSelect.value = existing?.grinderId ?? defaultGrinderId ?? "";

  const grinderCleaningStatusEl = /** @type {HTMLElement} */ (
    container.querySelector("#grinder-cleaning-status")
  );
  async function renderGrinderCleaningStatus() {
    const status = grinderSelect.value
      ? await getGrinderCleaningStatus(grinderSelect.value)
      : null;
    grinderCleaningStatusEl.textContent = status
      ? formatCleaningStatus(status)
      : "";
  }
  grinderSelect.addEventListener("change", renderGrinderCleaningStatus);
  await renderGrinderCleaningStatus();

  const brewerSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#brew-brewer")
  );
  for (const brewer of brewers) {
    const option = document.createElement("option");
    option.value = brewer.id;
    option.textContent = brewer.name;
    brewerSelect.append(option);
  }
  brewerSelect.value = existing?.brewerId ?? defaultBrewerId ?? "";

  const brewerCleaningStatusEl = /** @type {HTMLElement} */ (
    container.querySelector("#brewer-cleaning-status")
  );
  async function renderBrewerCleaningStatus() {
    const status = brewerSelect.value
      ? await getBrewerCleaningStatus(brewerSelect.value)
      : null;
    brewerCleaningStatusEl.textContent = status
      ? formatCleaningStatus(status)
      : "";
  }
  brewerSelect.addEventListener("change", renderBrewerCleaningStatus);
  await renderBrewerCleaningStatus();

  const dateInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-date")
  );
  dateInput.value = existing
    ? dateToInputValue(existing.brewDate)
    : todayDateInputValue();

  const grindSizeInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-grind-size")
  );
  grindSizeInput.value = existing ? String(existing.grindSize) : "";
  const doseInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-dose")
  );
  doseInput.value =
    existing?.doseGrams != null
      ? String(existing.doseGrams)
      : settings?.defaultDoseGrams != null
        ? String(settings.defaultDoseGrams)
        : "";
  const yieldInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-yield")
  );
  yieldInput.value =
    existing?.yieldGrams != null
      ? String(existing.yieldGrams)
      : settings?.defaultYieldGrams != null
        ? String(settings.defaultYieldGrams)
        : "";
  const extractionInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-extraction-time")
  );
  extractionInput.value = existing ? String(existing.extractionTimeSeconds) : "";
  const waterTempInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-water-temp")
  );
  waterTempInput.value =
    existing?.waterTempCelsius != null
      ? String(existing.waterTempCelsius)
      : settings?.defaultWaterTempCelsius != null
        ? String(settings.defaultWaterTempCelsius)
        : "";
  const ratingSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#brew-rating")
  );
  if (existing) ratingSelect.value = String(existing.rating);
  const notesTextarea = /** @type {HTMLTextAreaElement} */ (
    container.querySelector("#brew-notes")
  );
  notesTextarea.value = existing?.notes ?? "";

  const cancelButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#brew-form-cancel")
  );
  cancelButton.addEventListener("click", () => {
    if (isModal) nav.hideModal();
    else nav.goBack();
  });

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#brew-form")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const bagId = String(data.get("bagId") ?? "");
    const grinderId = String(data.get("grinderId") ?? "");
    const brewerId = String(data.get("brewerId") ?? "");
    const brewDate = String(data.get("brewDate") ?? "");
    const grindSize = String(data.get("grindSize") ?? "").trim();
    const doseGrams = String(data.get("doseGrams") ?? "").trim();
    const yieldGrams = String(data.get("yieldGrams") ?? "").trim();
    const extractionTimeSeconds = String(
      data.get("extractionTimeSeconds") ?? "",
    ).trim();
    const waterTempCelsius = String(data.get("waterTempCelsius") ?? "").trim();
    const rating = String(data.get("rating") ?? "");
    const notes = String(data.get("notes") ?? "")
      .trim()
      .slice(0, 256);

    if (
      !bagId ||
      !grinderId ||
      !brewerId ||
      !brewDate ||
      !grindSize ||
      !extractionTimeSeconds ||
      !rating
    ) {
      return;
    }
    if (brewDate > todayDateInputValue()) return;

    const fields = {
      bagId,
      grinderId,
      brewerId,
      brewDate: parseDateInputValue(brewDate),
      grindSize: Number(grindSize),
      doseGrams: doseGrams ? Number(doseGrams) : undefined,
      yieldGrams: yieldGrams ? Number(yieldGrams) : undefined,
      extractionTimeSeconds: Number(extractionTimeSeconds),
      waterTempCelsius: waterTempCelsius ? Number(waterTempCelsius) : undefined,
      rating: /** @type {1 | 2 | 3 | 4 | 5} */ (Number(rating)),
      notes: notes || undefined,
    };

    /** @type {import("../models/types.js").Brew} */
    let saved;
    if (brewId) {
      await db.brews.update(brewId, fields);
      saved = { id: brewId, createdAt: existing?.createdAt ?? new Date(), ...fields };
    } else {
      saved = { id: newId(), createdAt: new Date(), ...fields };
      await db.brews.add(saved);
    }

    if (onSaved) {
      await onSaved(saved);
    } else if (isModal) {
      nav.hideModal();
    } else {
      await nav.goBack();
    }
  });

  await renderRecentBags();
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderBrewsList(container, nav) {
  const [bags, grinders, brewers, roasters] = await Promise.all([
    db.bags.toArray(),
    db.grinders.toArray(),
    db.brewers.toArray(),
    db.roasters.toArray(),
  ]);
  const roasterNames = new Map(roasters.map((r) => [r.id, r.name]));
  const grinderNames = new Map(grinders.map((g) => [g.id, g.name]));
  const brewerNames = new Map(brewers.map((b) => [b.id, b.name]));
  const bagsById = new Map(bags.map((b) => [b.id, b]));

  container.innerHTML = `
    <h1>Brews</h1>
    <button type="button" id="add-brew">Add brew</button>
    <ul id="brew-list"></ul>
  `;

  const addButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-brew")
  );
  addButton.addEventListener("click", () => {
    nav.navigate((c) => renderBrewForm(c, nav));
  });

  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#brew-list")
  );

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    const editId = target.dataset.editId;
    if (editId) {
      await nav.navigate((c) => renderBrewForm(c, nav, { brewId: editId }));
      return;
    }

    const deleteId = target.dataset.deleteId;
    if (!deleteId) return;

    if (!(await nav.confirm("Delete this brew?", { confirmLabel: "Delete" })))
      return;
    await db.brews.delete(deleteId);
    await renderList();
  });

  async function renderList() {
    const brews = await db.brews.orderBy("brewDate").reverse().toArray();
    list.innerHTML = "";

    for (const brew of brews) {
      const item = document.createElement("li");
      const bag = bagsById.get(brew.bagId);
      const bagLabel = bag
        ? `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"}`
        : "Unknown bag";

      const title = document.createElement("strong");
      title.textContent = `${bagLabel} — ${"★".repeat(brew.rating)}${"☆".repeat(5 - brew.rating)}`;
      item.append(title);

      item.append(` — ${formatBrewDetails(brew, grinderNames, brewerNames)}`);

      if (brew.notes) {
        const notes = document.createElement("div");
        notes.textContent = brew.notes;
        item.append(notes);
      }

      item.append(" — ");
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.dataset.editId = brew.id;
      item.append(editButton);

      item.append(" ");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.dataset.deleteId = brew.id;
      item.append(deleteButton);

      list.append(item);
    }
  }

  await renderList();
}

/**
 * Read-only list of the brews logged on a single calendar day — surfaced by
 * selecting a date on the home page calendar.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {Date} date
 */
export async function renderBrewsForDate(container, nav, date) {
  const [brews, bags, grinders, brewers, roasters] = await Promise.all([
    getBrewsForDate(date),
    db.bags.toArray(),
    db.grinders.toArray(),
    db.brewers.toArray(),
    db.roasters.toArray(),
  ]);
  const roasterNames = new Map(roasters.map((r) => [r.id, r.name]));
  const grinderNames = new Map(grinders.map((g) => [g.id, g.name]));
  const brewerNames = new Map(brewers.map((b) => [b.id, b.name]));
  const bagsById = new Map(bags.map((b) => [b.id, b]));

  container.innerHTML = `
    <h1>${date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</h1>
    <ul id="day-brew-list"></ul>
  `;

  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#day-brew-list")
  );

  if (brews.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No brews logged on this day.";
    list.append(empty);
    return;
  }

  for (const brew of brews) {
    const item = document.createElement("li");
    const bag = bagsById.get(brew.bagId);
    const bagLabel = bag
      ? `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"}`
      : "Unknown bag";

    const title = document.createElement("strong");
    title.textContent = `${bagLabel} — ${"★".repeat(brew.rating)}${"☆".repeat(5 - brew.rating)}`;
    item.append(title);

    item.append(` — ${formatBrewDetails(brew, grinderNames, brewerNames)}`);

    if (brew.notes) {
      const notes = document.createElement("div");
      notes.textContent = brew.notes;
      item.append(notes);
    }

    list.append(item);
  }
}
