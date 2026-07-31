import { db, newId, setDefaultBrewerId, deleteBrewer } from "../db/db.js";
import {
  parseDateInputValue,
  dateToInputValue,
  startOfToday,
} from "../utils/dates.js";

const BREWER_TYPES = ["Espresso", "Filter"];

// Lucide has no dedicated "portafilter" glyph, so this is a hand-drawn
// silhouette (handle + basket + double spout) kept in the same stroke style
// as the rest of the app's Lucide-derived icons.
const PORTAFILTER_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="3" cy="9" r="1.5"></circle><path d="M5 9h6"></path><path d="M11 5h9l-2 7h-5Z"></path><path d="M13.5 12v4"></path><path d="M17.5 12v4"></path></svg>`;
// Lucide's "funnel" icon.
const FUNNEL_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"></path></svg>`;

/**
 * @param {import("../models/types.js").BrewerType} type
 * @returns {string}
 */
export function brewerTypeIcon(type) {
  return type === "Filter" ? FUNNEL_ICON : PORTAFILTER_ICON;
}

/**
 * Add/edit form for a single brewer, meant to be rendered inside a bottom
 * sheet (via nav.showModal) from the Equipment page. This only ever handles
 * one record at a time. Pass `brewer` as
 * undefined to create a new one instead of editing an existing one — delete
 * only makes sense for an existing record, so it's omitted in create mode.
 * Marking a brewer cleaned happens from the Equipment list's own icon or by
 * editing the Last cleaned date here, not a dedicated button.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {import("../models/types.js").Brewer | undefined} brewer
 * @param {() => void | Promise<void>} onSaved
 */
export async function renderBrewerEditSheet(container, nav, brewer, onSaved) {
  container.innerHTML = `
    <h1>${brewer ? "Edit brewer" : "Add brewer"}</h1>
    <form id="brewer-edit-form">
      <section class="settings-section">
        <div class="settings-card">
          <div>
            <label for="brewer-edit-name">Name</label>
            <input id="brewer-edit-name" name="name" type="text" autocomplete="off" required />
          </div>
          <div>
            <label for="brewer-edit-type">Type</label>
            <select id="brewer-edit-type" name="type" required>
              ${BREWER_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}
            </select>
          </div>
          <div>
            <label for="brewer-edit-last-cleaned">Last cleaned</label>
            <input id="brewer-edit-last-cleaned" name="lastCleanedDate" type="date" autocomplete="off" />
          </div>
          <div>
            <label for="brewer-edit-interval-brews">Remind me to clean every</label>
            <input id="brewer-edit-interval-brews" name="cleaningIntervalBrews" type="number" min="1" autocomplete="off" placeholder="e.g. 20" />
            <span class="field-hint">brews</span>
          </div>
          <div>
            <label for="brewer-edit-interval-weeks">...or every</label>
            <input id="brewer-edit-interval-weeks" name="cleaningIntervalWeeks" type="number" min="1" autocomplete="off" placeholder="e.g. 4" />
            <span class="field-hint">weeks, whichever comes first</span>
          </div>
        </div>
      </section>
      <div class="sheet-actions">
        <button type="submit" class="brew-button">Save</button>
      </div>
    </form>
    ${
      brewer
        ? `
      <div class="sheet-secondary-actions">
        <button type="button" id="brewer-edit-delete" class="detail-delete-button">Delete brewer</button>
      </div>
    `
        : ""
    }
  `;

  const nameInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brewer-edit-name")
  );
  nameInput.value = brewer?.name ?? "";
  const typeSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#brewer-edit-type")
  );
  if (brewer) typeSelect.value = brewer.type;
  const lastCleanedInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brewer-edit-last-cleaned")
  );
  lastCleanedInput.value = brewer?.lastCleanedDate
    ? dateToInputValue(brewer.lastCleanedDate)
    : "";
  const intervalBrewsInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brewer-edit-interval-brews")
  );
  intervalBrewsInput.value =
    brewer?.cleaningIntervalBrews != null
      ? String(brewer.cleaningIntervalBrews)
      : "";
  const intervalWeeksInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brewer-edit-interval-weeks")
  );
  intervalWeeksInput.value =
    brewer?.cleaningIntervalWeeks != null
      ? String(brewer.cleaningIntervalWeeks)
      : "";

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#brewer-edit-form")
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const type = String(data.get("type") ?? "");
    const lastCleanedDate = String(data.get("lastCleanedDate") ?? "").trim();
    const cleaningIntervalBrews = String(
      data.get("cleaningIntervalBrews") ?? "",
    ).trim();
    const cleaningIntervalWeeks = String(
      data.get("cleaningIntervalWeeks") ?? "",
    ).trim();
    if (!name || !type) return;

    const hasInterval = cleaningIntervalBrews || cleaningIntervalWeeks;

    const fields = {
      name,
      type: /** @type {import("../models/types.js").BrewerType} */ (type),
      lastCleanedDate: lastCleanedDate
        ? parseDateInputValue(lastCleanedDate)
        : hasInterval && !brewer?.lastCleanedDate
          ? startOfToday()
          : brewer?.lastCleanedDate,
      cleaningIntervalBrews: cleaningIntervalBrews
        ? Number(cleaningIntervalBrews)
        : undefined,
      cleaningIntervalWeeks: cleaningIntervalWeeks
        ? Number(cleaningIntervalWeeks)
        : undefined,
    };

    if (brewer) {
      await db.brewers.update(brewer.id, fields);
    } else {
      const isFirstBrewer = (await db.brewers.count()) === 0;
      const brewerId = newId();
      await db.brewers.add({ id: brewerId, ...fields });
      if (isFirstBrewer) await setDefaultBrewerId(brewerId);
    }

    nav.hideModal();
    await onSaved();
  });

  if (brewer) {
    const deleteButton = /** @type {HTMLButtonElement} */ (
      container.querySelector("#brewer-edit-delete")
    );
    deleteButton.addEventListener("click", async () => {
      if (
        !(await nav.confirm("Delete this brewer?", { confirmLabel: "Delete" }))
      )
        return;
      await deleteBrewer(brewer.id);
      nav.hideModal();
      await onSaved();
    });
  }
}
