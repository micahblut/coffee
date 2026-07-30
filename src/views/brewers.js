import {
  db,
  newId,
  setDefaultBrewerId,
  deleteBrewer,
  markBrewerCleaned,
} from "../db/db.js";
import {
  parseDateInputValue,
  dateToInputValue,
  startOfToday,
} from "../utils/dates.js";

/**
 * Add/edit form for a single brewer, meant to be rendered inside a bottom
 * sheet (via nav.showModal) from the Equipment page. This only ever handles
 * one record at a time. Pass `brewer` as
 * undefined to create a new one instead of editing an existing one,
 * mirroring renderBrewForm's optional-id pattern — mark-cleaned/delete only
 * make sense for an existing record, so they're omitted in create mode.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {import("../models/types.js").Brewer | undefined} brewer
 * @param {() => void | Promise<void>} onSaved
 */
export async function renderBrewerEditSheet(container, nav, brewer, onSaved) {
  container.innerHTML = `
    <h2>${brewer ? "Edit brewer" : "Add brewer"}</h2>
    <form id="brewer-edit-form">
      <div>
        <label for="brewer-edit-name">Name</label>
        <input id="brewer-edit-name" name="name" type="text" autocomplete="off" required />
      </div>
      <div>
        <label for="brewer-edit-last-cleaned">Last cleaned</label>
        <input id="brewer-edit-last-cleaned" name="lastCleanedDate" type="date" autocomplete="off" />
      </div>
      <div>
        <label for="brewer-edit-interval-brews">Remind me to clean every</label>
        <input id="brewer-edit-interval-brews" name="cleaningIntervalBrews" type="number" min="1" autocomplete="off" placeholder="brews" />
      </div>
      <div>
        <label for="brewer-edit-interval-weeks">...or every</label>
        <input id="brewer-edit-interval-weeks" name="cleaningIntervalWeeks" type="number" min="1" autocomplete="off" placeholder="weeks" />
        <span>weeks, whichever comes first</span>
      </div>
      <div class="sheet-actions">
        <button type="submit" class="brew-button">Save</button>
      </div>
    </form>
    ${
      brewer
        ? `
      <div class="sheet-secondary-actions">
        <button type="button" id="brewer-edit-mark-cleaned" class="sheet-secondary-button">Mark cleaned</button>
        <button type="button" id="brewer-edit-delete" class="sheet-danger-button">Delete brewer</button>
      </div>
    `
        : ""
    }
  `;

  const nameInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brewer-edit-name")
  );
  nameInput.value = brewer?.name ?? "";
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
    const lastCleanedDate = String(data.get("lastCleanedDate") ?? "").trim();
    const cleaningIntervalBrews = String(
      data.get("cleaningIntervalBrews") ?? "",
    ).trim();
    const cleaningIntervalWeeks = String(
      data.get("cleaningIntervalWeeks") ?? "",
    ).trim();
    if (!name) return;

    const hasInterval = cleaningIntervalBrews || cleaningIntervalWeeks;

    const fields = {
      name,
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
    const markCleanedButton = /** @type {HTMLButtonElement} */ (
      container.querySelector("#brewer-edit-mark-cleaned")
    );
    markCleanedButton.addEventListener("click", async () => {
      await markBrewerCleaned(brewer.id);
      lastCleanedInput.value = dateToInputValue(startOfToday());
      await onSaved();
    });

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
