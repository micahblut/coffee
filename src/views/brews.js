import {
  db,
  newId,
  getSettings,
  getRecentBags,
  getBrewsForDate,
  getGrinderCleaningStatus,
  getBrewerCleaningStatus,
  getMostRecentlyLoggedBrew,
} from "../db/db.js";
import {
  parseDateInputValue,
  dateToInputValue,
  todayDateInputValue,
} from "../utils/dates.js";
import { renderBagForm } from "./bags.js";
import { formatCleaningStatus } from "./grinders.js";

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
  if (brew.extractionTimeSeconds != null) {
    details.push(`${brew.extractionTimeSeconds}s`);
  }
  if (brew.waterTempCelsius) details.push(`${brew.waterTempCelsius}°C`);
  return details.join(", ");
}

/**
 * The compact "Grind 18 · Yield 36g · 28s" line shown on a brew card on the
 * Home screen and a Bag View's brew list — yield and extraction time are
 * both optional (extraction time doesn't apply to every brew method), so
 * either is omitted from the line when not recorded.
 * @param {import("../models/types.js").Brew} brew
 * @returns {string}
 */
export function formatBrewCardMeta(brew) {
  const parts = [`Grind ${brew.grindSize}`];
  if (brew.yieldGrams != null) parts.push(`Yield ${brew.yieldGrams}g`);
  if (brew.extractionTimeSeconds != null) {
    parts.push(`${brew.extractionTimeSeconds}s`);
  }
  return parts.join(" · ");
}

/**
 * @returns {string}
 */
function starRatingHtml() {
  return [1, 2, 3, 4, 5]
    .map(
      (value) =>
        `<button type="button" class="star-rating-star" data-value="${value}" aria-label="${value} star${value === 1 ? "" : "s"}">☆</button>`,
    )
    .join("");
}

/**
 * The brew sheet — handles both adding a brew (triggered by the Brew button
 * on the Home screen and the Bag View) and editing one (tapping a brew
 * anywhere it's listed). Same layout either way: settings the user already
 * has a default for move into a collapsed "Change defaults" section (opened
 * automatically when editing, so nothing about the stored record is hidden),
 * and the bag is either already known (pre-filled from the Bag View, or
 * simply the brew being edited) or picked fresh via the Home screen's
 * recent-bags quick list.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {{
 *   brewId?: string,
 *   prefillBagId?: string,
 *   onSaved?: (brew: import("../models/types.js").Brew) => void | Promise<void>,
 *   onDeleted?: () => void | Promise<void>,
 * }} [options]
 */
export async function renderBrewSheet(container, nav, options = {}) {
  const { brewId, prefillBagId, onSaved, onDeleted } = options;
  const [grinders, brewers] = await Promise.all([
    db.grinders.orderBy("name").toArray(),
    db.brewers.orderBy("name").toArray(),
  ]);

  if (grinders.length === 0 || brewers.length === 0) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent =
      "Set up your equipment before you brew.";
    container.append(message);
    return;
  }

  const [bags, roasters, settings, existing, lastBrew] = await Promise.all([
    db.bags.orderBy("roastDate").reverse().toArray(),
    db.roasters.toArray(),
    getSettings(),
    brewId ? db.brews.get(brewId) : undefined,
    // Only meaningful when adding a brew — editing one already shows its own
    // stored values, so there's nothing to jog the user's memory about.
    brewId ? undefined : getMostRecentlyLoggedBrew(),
  ]);
  const roasterNames = new Map(roasters.map((r) => [r.id, r.name]));
  const bagsById = new Map(bags.map((bag) => [bag.id, bag]));

  // Editing a brew always has a known bag (the one it was already logged
  // against); adding one from the Bag View pre-fills it. Either way, the
  // recent-bags quick-pick only makes sense when nothing's decided yet.
  const knownBagId = existing?.bagId ?? prefillBagId;
  const recentBags = knownBagId ? [] : await getRecentBags(3);

  const hasDefaultBrewer = settings?.defaultBrewerId != null;
  const hasDefaultGrinder = settings?.defaultGrinderId != null;
  const hasDefaultGrindSize = settings?.defaultGrindSize != null;
  const hasDefaultDose = settings?.defaultDoseGrams != null;
  const hasDefaultYield = settings?.defaultYieldGrams != null;
  const hasDefaultWaterTemp = settings?.defaultWaterTempCelsius != null;

  /**
   * @param {import("../models/types.js").Bag} bag
   * @returns {string}
   */
  function bagLabel(bag) {
    return `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"}`;
  }

  const brewerFieldHtml = `
    <div>
      <label for="brew-brewer">Brewer</label>
      <select id="brew-brewer" name="brewerId" required></select>
      <div id="brewer-cleaning-status" class="cleaning-status"></div>
    </div>
  `;
  const grinderFieldHtml = `
    <div>
      <label for="brew-grinder">Grinder</label>
      <select id="brew-grinder" name="grinderId" required></select>
      <div id="grinder-cleaning-status" class="cleaning-status"></div>
    </div>
  `;
  const grindSizeFieldHtml = `
    <div>
      <label for="brew-grind-size">Grind size</label>
      <input id="brew-grind-size" name="grindSize" type="number" step="any" autocomplete="off" required />
    </div>
  `;
  const doseFieldHtml = `
    <div>
      <label for="brew-dose">Dose (g)</label>
      <input id="brew-dose" name="doseGrams" type="number" step="any" min="0" autocomplete="off" />
    </div>
  `;
  const yieldFieldHtml = `
    <div>
      <label for="brew-yield">Yield (g)</label>
      <input id="brew-yield" name="yieldGrams" type="number" step="any" min="0" autocomplete="off" />
    </div>
  `;
  const waterTempFieldHtml = `
    <div>
      <label for="brew-water-temp">Water temp (°C)</label>
      <input id="brew-water-temp" name="waterTempCelsius" type="number" step="any" autocomplete="off" />
    </div>
  `;

  // Date and extraction time have no notion of a "default" — they always
  // show. Everything else only shows here if the user hasn't already
  // configured a default for it; otherwise it moves to the collapsed
  // section below.
  const mainFieldsHtml = [
    hasDefaultBrewer ? "" : brewerFieldHtml,
    hasDefaultGrinder ? "" : grinderFieldHtml,
    `
    <div>
      <label for="brew-date">Date</label>
      <input id="brew-date" name="brewDate" type="date" max="${todayDateInputValue()}" autocomplete="off" required />
    </div>
    `,
    hasDefaultGrindSize ? "" : grindSizeFieldHtml,
    hasDefaultDose ? "" : doseFieldHtml,
    hasDefaultYield ? "" : yieldFieldHtml,
    `
    <div>
      <label for="brew-extraction-time">Extraction time (seconds)</label>
      <input id="brew-extraction-time" name="extractionTimeSeconds" type="number" min="0" autocomplete="off" />
    </div>
    `,
    hasDefaultWaterTemp ? "" : waterTempFieldHtml,
  ].join("");

  const defaultsFieldsHtml = [
    hasDefaultBrewer ? brewerFieldHtml : "",
    hasDefaultGrinder ? grinderFieldHtml : "",
    hasDefaultGrindSize ? grindSizeFieldHtml : "",
    hasDefaultDose ? doseFieldHtml : "",
    hasDefaultYield ? yieldFieldHtml : "",
    hasDefaultWaterTemp ? waterTempFieldHtml : "",
  ].join("");

  // If the bag is already known (editing, or added from the Bag View), a
  // confirmation line names it. Coming from Home to add a brew, nothing is
  // pre-selected — the user picks a bag from the quick-pick list (its red
  // outline is the only indication of what's selected) or opens the full
  // picker below.
  const bagFieldHtml = knownBagId
    ? `
    <div class="detail-name" id="brew-bag-current-name"></div>
    <details class="form-details">
      <summary>Change bag</summary>
      <div>
        <label for="brew-bag">Bag</label>
        <select id="brew-bag" name="bagId"></select>
        <button type="button" id="add-bag-inline" class="inline-text-button">+ Add new bag</button>
      </div>
    </details>
  `
    : `
    <label>Bag</label>
    <div id="bag-quick-picks" class="bag-quick-picks"></div>
    <details id="brew-bag-details" class="form-details">
      <summary>Choose a different bag</summary>
      <div>
        <label for="brew-bag">Bag</label>
        <select id="brew-bag" name="bagId"></select>
        <button type="button" id="add-bag-inline" class="inline-text-button">+ Add new bag</button>
      </div>
    </details>
  `;

  container.innerHTML = `
    <h1>${existing ? "Edit brew" : "Add brew"}</h1>
    <form id="brew-form">
      <section class="settings-section">
        <h2>Coffee</h2>
        <div class="settings-card">${bagFieldHtml}</div>
      </section>
      <section class="settings-section">
        <h2>Brew details</h2>
        <div class="settings-card">
          ${mainFieldsHtml}
          ${
            defaultsFieldsHtml
              ? `
          <details class="form-details" ${existing ? "open" : ""}>
            <summary>Change defaults</summary>
            ${defaultsFieldsHtml}
          </details>
          `
              : ""
          }
        </div>
      </section>
      <section class="settings-section">
        <h2>Rating &amp; notes</h2>
        <div class="settings-card">
          <div id="brew-rating-stars" class="star-rating" role="group" aria-label="Rating"></div>
          <input type="hidden" id="brew-rating" name="rating" />
          <div>
            <label for="brew-notes">Notes</label>
            <textarea id="brew-notes" name="notes" maxlength="256" rows="5" class="brew-notes-textarea" autocomplete="off"></textarea>
          </div>
        </div>
      </section>
      <p id="brew-form-error" class="form-error"></p>
      <div class="sheet-actions">
        <button type="submit" class="brew-button">Save</button>
      </div>
    </form>
    ${
      existing
        ? `
      <div class="sheet-secondary-actions">
        <button type="button" id="brew-delete" class="detail-delete-button">Delete brew</button>
      </div>
    `
        : ""
    }
  `;

  // "Last used: …" placeholders for numeric fields with no configured
  // default — only populated when adding a brew (lastBrew is undefined when
  // editing), so the user can jog their memory on settings they haven't
  // changed since. Shown as the input's own placeholder (a suggestion to
  // type, not a value that's actually set) rather than separate text.
  /**
   * @param {string} selector
   * @param {string | number | null | undefined} value
   */
  function setLastUsedPlaceholder(selector, value) {
    const el = /** @type {HTMLInputElement | null} */ (container.querySelector(selector));
    if (el && value != null) el.placeholder = `Last used: ${value}`;
  }
  if (lastBrew) {
    if (!hasDefaultGrindSize) {
      setLastUsedPlaceholder("#brew-grind-size", lastBrew.grindSize);
    }
    if (!hasDefaultDose) {
      setLastUsedPlaceholder(
        "#brew-dose",
        lastBrew.doseGrams != null ? `${lastBrew.doseGrams}g` : null,
      );
    }
    if (!hasDefaultYield) {
      setLastUsedPlaceholder(
        "#brew-yield",
        lastBrew.yieldGrams != null ? `${lastBrew.yieldGrams}g` : null,
      );
    }
    setLastUsedPlaceholder(
      "#brew-extraction-time",
      lastBrew.extractionTimeSeconds != null ? `${lastBrew.extractionTimeSeconds}s` : null,
    );
    if (!hasDefaultWaterTemp) {
      setLastUsedPlaceholder(
        "#brew-water-temp",
        lastBrew.waterTempCelsius != null ? `${lastBrew.waterTempCelsius}°C` : null,
      );
    }
  }

  if (existing) {
    const deleteButton = /** @type {HTMLButtonElement} */ (
      container.querySelector("#brew-delete")
    );
    deleteButton.addEventListener("click", async () => {
      if (!(await nav.confirm("Delete this brew?", { confirmLabel: "Delete" })))
        return;
      await db.brews.delete(existing.id);
      if (onDeleted) {
        await onDeleted();
      } else {
        nav.hideModal();
      }
    });
  }

  const bagSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#brew-bag")
  );
  // No option is selected by default (unless a bag was prefilled) — the
  // placeholder keeps the native select's own value genuinely empty rather
  // than silently defaulting to whichever bag happens to sort first.
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.disabled = true;
  placeholderOption.selected = true;
  placeholderOption.textContent = "Select a bag…";
  bagSelect.append(placeholderOption);
  for (const bag of bags) {
    const option = document.createElement("option");
    option.value = bag.id;
    option.textContent = `${bagLabel(bag)} (${bag.roastDate.toLocaleDateString()})`;
    bagSelect.append(option);
  }
  if (knownBagId) bagSelect.value = knownBagId;

  const bagNameEl = /** @type {HTMLElement | null} */ (
    container.querySelector("#brew-bag-current-name")
  );
  const dateInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-date")
  );
  dateInput.value = existing
    ? dateToInputValue(existing.brewDate)
    : todayDateInputValue();

  // A brew can't predate the bag it was made from, so the date picker's
  // lower bound tracks whichever bag is currently selected.
  function syncBagDisplay() {
    const bag = bagsById.get(bagSelect.value);
    if (bagNameEl) bagNameEl.textContent = bag ? bagLabel(bag) : "";
    dateInput.min = bag ? dateToInputValue(bag.roastDate) : "";
    for (const chip of /** @type {HTMLButtonElement[]} */ (
      Array.from(container.querySelectorAll(".bag-quick-pick"))
    )) {
      chip.classList.toggle("selected", chip.dataset.bagId === bagSelect.value);
    }
  }

  if (!knownBagId) {
    const quickPicksContainer = /** @type {HTMLElement} */ (
      container.querySelector("#bag-quick-picks")
    );
    for (const bag of recentBags) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bag-quick-pick";
      button.dataset.bagId = bag.id;
      button.textContent = bagLabel(bag);
      button.addEventListener("click", () => {
        bagSelect.value = bag.id;
        syncBagDisplay();
      });
      quickPicksContainer.append(button);
    }
  }

  bagSelect.addEventListener("change", syncBagDisplay);
  syncBagDisplay();

  const addBagButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-bag-inline")
  );
  addBagButton.addEventListener("click", () => {
    nav.showModal((modalContainer) =>
      renderBagForm(modalContainer, nav, {
        onSaved: async (bag) => {
          // roasterNames was snapshotted when this form loaded, so a roaster
          // created just now (nested inside this same detour) won't be in
          // it yet — refresh the entry rather than assume it's there.
          if (!roasterNames.has(bag.roasterId)) {
            const roaster = await db.roasters.get(bag.roasterId);
            if (roaster) roasterNames.set(roaster.id, roaster.name);
          }
          bagsById.set(bag.id, bag);
          const option = document.createElement("option");
          option.value = bag.id;
          option.textContent = `${bagLabel(bag)} (${bag.roastDate.toLocaleDateString()})`;
          bagSelect.append(option);
          bagSelect.value = bag.id;
          syncBagDisplay();
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
  grinderSelect.value = existing?.grinderId ?? settings?.defaultGrinderId ?? "";

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
  brewerSelect.value = existing?.brewerId ?? settings?.defaultBrewerId ?? "";

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

  const grindSizeInput = /** @type {HTMLInputElement | null} */ (
    container.querySelector("#brew-grind-size")
  );
  if (grindSizeInput) {
    grindSizeInput.value =
      existing?.grindSize != null
        ? String(existing.grindSize)
        : settings?.defaultGrindSize != null
          ? String(settings.defaultGrindSize)
          : "";
  }

  const doseInput = /** @type {HTMLInputElement | null} */ (
    container.querySelector("#brew-dose")
  );
  if (doseInput) {
    doseInput.value =
      existing?.doseGrams != null
        ? String(existing.doseGrams)
        : settings?.defaultDoseGrams != null
          ? String(settings.defaultDoseGrams)
          : "";
  }
  const yieldInput = /** @type {HTMLInputElement | null} */ (
    container.querySelector("#brew-yield")
  );
  if (yieldInput) {
    yieldInput.value =
      existing?.yieldGrams != null
        ? String(existing.yieldGrams)
        : settings?.defaultYieldGrams != null
          ? String(settings.defaultYieldGrams)
          : "";
  }
  const extractionInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-extraction-time")
  );
  extractionInput.value = existing ? String(existing.extractionTimeSeconds) : "";
  const waterTempInput = /** @type {HTMLInputElement | null} */ (
    container.querySelector("#brew-water-temp")
  );
  if (waterTempInput) {
    waterTempInput.value =
      existing?.waterTempCelsius != null
        ? String(existing.waterTempCelsius)
        : settings?.defaultWaterTempCelsius != null
          ? String(settings.defaultWaterTempCelsius)
          : "";
  }

  const starsContainer = /** @type {HTMLElement} */ (
    container.querySelector("#brew-rating-stars")
  );
  starsContainer.innerHTML = starRatingHtml();
  const ratingInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-rating")
  );
  const starButtons = /** @type {HTMLButtonElement[]} */ (
    Array.from(starsContainer.querySelectorAll(".star-rating-star"))
  );
  /** @param {number} value */
  function setRating(value) {
    ratingInput.value = String(value);
    for (const button of starButtons) {
      const filled = Number(button.dataset.value) <= value;
      button.classList.toggle("filled", filled);
      button.textContent = filled ? "★" : "☆";
    }
  }
  for (const button of starButtons) {
    button.addEventListener("click", () =>
      setRating(Number(button.dataset.value)),
    );
  }
  if (existing) setRating(existing.rating);

  const notesTextarea = /** @type {HTMLTextAreaElement} */ (
    container.querySelector("#brew-notes")
  );
  notesTextarea.value = existing?.notes ?? "";

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#brew-form")
  );
  const errorEl = /** @type {HTMLElement} */ (
    container.querySelector("#brew-form-error")
  );
  const bagDetailsEl = /** @type {HTMLDetailsElement | null} */ (
    container.querySelector("#brew-bag-details")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.textContent = "";

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

    // The bag quick-picks and star rating have no native browser validation
    // UI of their own (unlike a plain required <select>/<input>), so a
    // missing one needs its own visible feedback — otherwise the form just
    // silently does nothing on submit.
    if (!bagId) {
      errorEl.textContent = "Select a bag before saving.";
      if (bagDetailsEl) bagDetailsEl.open = true;
      return;
    }
    if (!rating) {
      errorEl.textContent = "Select a rating before saving.";
      return;
    }
    if (!grinderId || !brewerId || !brewDate || !grindSize) {
      errorEl.textContent = "Fill in the missing brew details before saving.";
      return;
    }
    if (brewDate > todayDateInputValue()) {
      errorEl.textContent = "Brew date can't be in the future.";
      return;
    }
    const bag = bagsById.get(bagId);
    if (bag && brewDate < dateToInputValue(bag.roastDate)) {
      errorEl.textContent = "Brew date can't be before the bag's roast date.";
      return;
    }

    const fields = {
      bagId,
      grinderId,
      brewerId,
      brewDate: parseDateInputValue(brewDate),
      grindSize: Number(grindSize),
      doseGrams: doseGrams ? Number(doseGrams) : undefined,
      yieldGrams: yieldGrams ? Number(yieldGrams) : undefined,
      extractionTimeSeconds: extractionTimeSeconds
        ? Number(extractionTimeSeconds)
        : undefined,
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
    } else {
      nav.hideModal();
    }
  });
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
