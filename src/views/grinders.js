import {
  db,
  newId,
  setDefaultGrinderId,
  deleteGrinder,
  markGrinderCleaned,
} from "../db/db.js";
import {
  parseDateInputValue,
  dateToInputValue,
  startOfToday,
} from "../utils/dates.js";

/**
 * @param {import("../db/db.js").CleaningStatus} status
 * @returns {string}
 */
export function formatCleaningStatus(status) {
  // amount is 0 exactly when usage/age has hit the interval right on the
  // nose (neither past it nor short of it), which the "overdue" branch
  // otherwise reports as a confusing "0 grinds overdue for a clean".
  if (status.amount === 0) return "Due for a clean";
  return status.level === "overdue"
    ? `${status.amount} ${status.metric} overdue for a clean`
    : `Cleaning due in ${status.amount} ${status.metric}`;
}

/**
 * Add/edit form for a single grinder, meant to be rendered inside a bottom
 * sheet (via nav.showModal) from the Equipment page. This only ever handles
 * one record at a time. Pass `grinder` as
 * undefined to create a new one instead of editing an existing one —
 * mark-cleaned/delete only make sense for an existing record, so they're
 * omitted in create mode.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {import("../models/types.js").Grinder | undefined} grinder
 * @param {() => void | Promise<void>} onSaved
 */
export async function renderGrinderEditSheet(container, nav, grinder, onSaved) {
  container.innerHTML = `
    <h1>${grinder ? "Edit grinder" : "Add grinder"}</h1>
    <form id="grinder-edit-form">
      <section class="settings-section">
        <div class="settings-card">
          <div>
            <label for="grinder-edit-name">Name</label>
            <input id="grinder-edit-name" name="name" type="text" autocomplete="off" required />
          </div>
          <div>
            <label for="grinder-edit-last-cleaned">Last cleaned</label>
            <input id="grinder-edit-last-cleaned" name="lastCleanedDate" type="date" autocomplete="off" />
          </div>
          <div>
            <label for="grinder-edit-interval-grinds">Remind me to clean every</label>
            <input id="grinder-edit-interval-grinds" name="cleaningIntervalGrinds" type="number" min="1" autocomplete="off" placeholder="e.g. 20" />
            <span class="field-hint">grinds</span>
          </div>
          <div>
            <label for="grinder-edit-interval-weeks">...or every</label>
            <input id="grinder-edit-interval-weeks" name="cleaningIntervalWeeks" type="number" min="1" autocomplete="off" placeholder="e.g. 4" />
            <span class="field-hint">weeks, whichever comes first</span>
          </div>
        </div>
      </section>
      <div class="sheet-actions">
        <button type="submit" class="brew-button">Save</button>
      </div>
    </form>
    ${
      grinder
        ? `
      <div class="sheet-secondary-actions">
        <button type="button" id="grinder-edit-mark-cleaned" class="sheet-secondary-button">Mark cleaned</button>
        <button type="button" id="grinder-edit-delete" class="detail-delete-button">Delete grinder</button>
      </div>
    `
        : ""
    }
  `;

  const nameInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#grinder-edit-name")
  );
  nameInput.value = grinder?.name ?? "";
  const lastCleanedInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#grinder-edit-last-cleaned")
  );
  lastCleanedInput.value = grinder?.lastCleanedDate
    ? dateToInputValue(grinder.lastCleanedDate)
    : "";
  const intervalGrindsInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#grinder-edit-interval-grinds")
  );
  intervalGrindsInput.value =
    grinder?.cleaningIntervalGrinds != null
      ? String(grinder.cleaningIntervalGrinds)
      : "";
  const intervalWeeksInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#grinder-edit-interval-weeks")
  );
  intervalWeeksInput.value =
    grinder?.cleaningIntervalWeeks != null
      ? String(grinder.cleaningIntervalWeeks)
      : "";

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#grinder-edit-form")
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const lastCleanedDate = String(data.get("lastCleanedDate") ?? "").trim();
    const cleaningIntervalGrinds = String(
      data.get("cleaningIntervalGrinds") ?? "",
    ).trim();
    const cleaningIntervalWeeks = String(
      data.get("cleaningIntervalWeeks") ?? "",
    ).trim();
    if (!name) return;

    const hasInterval = cleaningIntervalGrinds || cleaningIntervalWeeks;

    const fields = {
      name,
      lastCleanedDate: lastCleanedDate
        ? parseDateInputValue(lastCleanedDate)
        : hasInterval && !grinder?.lastCleanedDate
          ? startOfToday()
          : grinder?.lastCleanedDate,
      cleaningIntervalGrinds: cleaningIntervalGrinds
        ? Number(cleaningIntervalGrinds)
        : undefined,
      cleaningIntervalWeeks: cleaningIntervalWeeks
        ? Number(cleaningIntervalWeeks)
        : undefined,
    };

    if (grinder) {
      await db.grinders.update(grinder.id, fields);
    } else {
      const isFirstGrinder = (await db.grinders.count()) === 0;
      const grinderId = newId();
      await db.grinders.add({ id: grinderId, ...fields });
      if (isFirstGrinder) await setDefaultGrinderId(grinderId);
    }

    nav.hideModal();
    await onSaved();
  });

  if (grinder) {
    const markCleanedButton = /** @type {HTMLButtonElement} */ (
      container.querySelector("#grinder-edit-mark-cleaned")
    );
    markCleanedButton.addEventListener("click", async () => {
      await markGrinderCleaned(grinder.id);
      lastCleanedInput.value = dateToInputValue(startOfToday());
      await onSaved();
    });

    const deleteButton = /** @type {HTMLButtonElement} */ (
      container.querySelector("#grinder-edit-delete")
    );
    deleteButton.addEventListener("click", async () => {
      if (
        !(await nav.confirm("Delete this grinder?", { confirmLabel: "Delete" }))
      )
        return;
      await deleteGrinder(grinder.id);
      nav.hideModal();
      await onSaved();
    });
  }
}
