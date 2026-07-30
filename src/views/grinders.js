import {
  db,
  newId,
  getSettings,
  setDefaultGrinderId,
  deleteGrinder,
  markGrinderCleaned,
  getGrinderCleaningStatus,
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
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderGrinders(container, nav) {
  container.innerHTML = `
    <h1>Grinders</h1>
    <form id="grinder-form">
      <div>
        <label for="grinder-name">Name</label>
        <input id="grinder-name" name="name" type="text" autocomplete="off" required />
      </div>
      <div>
        <label for="grinder-last-cleaned">Last cleaned</label>
        <input id="grinder-last-cleaned" name="lastCleanedDate" type="date" autocomplete="off" />
      </div>
      <div>
        <label for="grinder-interval-grinds">Remind me to clean every</label>
        <input id="grinder-interval-grinds" name="cleaningIntervalGrinds" type="number" min="1" autocomplete="off" placeholder="grinds" />
      </div>
      <div>
        <label for="grinder-interval-weeks">...or every</label>
        <input id="grinder-interval-weeks" name="cleaningIntervalWeeks" type="number" min="1" autocomplete="off" placeholder="weeks" />
        <span>weeks, whichever comes first</span>
      </div>
      <button type="submit" id="grinder-submit">Add grinder</button>
      <button type="button" id="grinder-cancel" hidden>Cancel</button>
    </form>
    <ul id="grinder-list"></ul>
  `;

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#grinder-form")
  );
  const nameInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#grinder-name")
  );
  const lastCleanedInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#grinder-last-cleaned")
  );
  const intervalGrindsInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#grinder-interval-grinds")
  );
  const intervalWeeksInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#grinder-interval-weeks")
  );
  const submitButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#grinder-submit")
  );
  const cancelButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#grinder-cancel")
  );
  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#grinder-list")
  );

  /** @type {string | null} */
  let editingId = null;

  function resetToCreateMode() {
    editingId = null;
    form.reset();
    submitButton.textContent = "Add grinder";
    cancelButton.hidden = true;
  }

  cancelButton.addEventListener("click", resetToCreateMode);

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

    const existing = editingId ? await db.grinders.get(editingId) : undefined;
    const hasInterval = cleaningIntervalGrinds || cleaningIntervalWeeks;

    const fields = {
      name,
      // If a cleaning interval is being set up for the first time with no
      // baseline date, start the counter now rather than leaving it unset
      // (which would make the reminder unable to compute anything).
      lastCleanedDate: lastCleanedDate
        ? parseDateInputValue(lastCleanedDate)
        : hasInterval && !existing?.lastCleanedDate
          ? startOfToday()
          : existing?.lastCleanedDate,
      cleaningIntervalGrinds: cleaningIntervalGrinds
        ? Number(cleaningIntervalGrinds)
        : undefined,
      cleaningIntervalWeeks: cleaningIntervalWeeks
        ? Number(cleaningIntervalWeeks)
        : undefined,
    };

    if (editingId) {
      await db.grinders.update(editingId, fields);
    } else {
      const isFirstGrinder = (await db.grinders.count()) === 0;
      const grinderId = newId();
      await db.grinders.add({ id: grinderId, ...fields });
      if (isFirstGrinder) {
        await setDefaultGrinderId(grinderId);
      }
    }

    resetToCreateMode();
    await renderList();
  });

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    if (target.dataset.editId) {
      const grinder = await db.grinders.get(target.dataset.editId);
      if (!grinder) return;

      editingId = grinder.id;
      nameInput.value = grinder.name;
      lastCleanedInput.value = grinder.lastCleanedDate
        ? dateToInputValue(grinder.lastCleanedDate)
        : "";
      intervalGrindsInput.value =
        grinder.cleaningIntervalGrinds != null
          ? String(grinder.cleaningIntervalGrinds)
          : "";
      intervalWeeksInput.value =
        grinder.cleaningIntervalWeeks != null
          ? String(grinder.cleaningIntervalWeeks)
          : "";
      submitButton.textContent = "Save grinder";
      cancelButton.hidden = false;
      return;
    }

    if (target.dataset.markCleanedId) {
      await markGrinderCleaned(target.dataset.markCleanedId);
      await renderList();
      return;
    }

    if (target.dataset.deleteId) {
      if (!(await nav.confirm("Delete this grinder?", { confirmLabel: "Delete" })))
        return;
      await deleteGrinder(target.dataset.deleteId);
      if (editingId === target.dataset.deleteId) resetToCreateMode();
      await renderList();
    }
  });

  async function renderList() {
    const [grinders, settings] = await Promise.all([
      db.grinders.orderBy("name").toArray(),
      getSettings(),
    ]);
    const defaultGrinderId = settings?.defaultGrinderId;

    list.innerHTML = "";

    for (const grinder of grinders) {
      const item = document.createElement("li");

      const name = document.createElement("strong");
      name.textContent = grinder.name;
      item.append(name);

      if (grinder.lastCleanedDate) {
        item.append(
          ` — last cleaned ${grinder.lastCleanedDate.toLocaleDateString()}`,
        );
      }

      const status = await getGrinderCleaningStatus(grinder.id);
      if (status) {
        const statusEl = document.createElement("div");
        statusEl.textContent = formatCleaningStatus(status);
        item.append(statusEl);
      }

      if (grinder.id === defaultGrinderId) {
        item.append(" — default");
      }

      item.append(" — ");
      const markCleanedButton = document.createElement("button");
      markCleanedButton.type = "button";
      markCleanedButton.textContent = "Mark cleaned";
      markCleanedButton.dataset.markCleanedId = grinder.id;
      item.append(markCleanedButton);

      item.append(" — ");
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.dataset.editId = grinder.id;
      item.append(editButton);

      item.append(" ");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.dataset.deleteId = grinder.id;
      item.append(deleteButton);

      list.append(item);
    }
  }

  await renderList();
}

/**
 * Add/edit form for a single grinder, meant to be rendered inside a bottom
 * sheet (via nav.showModal) from the Equipment page. Unlike renderGrinders
 * above, this only ever handles one record at a time. Pass `grinder` as
 * undefined to create a new one instead of editing an existing one,
 * mirroring renderBrewForm's optional-id pattern — mark-cleaned/delete only
 * make sense for an existing record, so they're omitted in create mode.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {import("../models/types.js").Grinder | undefined} grinder
 * @param {() => void | Promise<void>} onSaved
 */
export async function renderGrinderEditSheet(container, nav, grinder, onSaved) {
  container.innerHTML = `
    <h2>${grinder ? "Edit grinder" : "Add grinder"}</h2>
    <form id="grinder-edit-form">
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
        <input id="grinder-edit-interval-grinds" name="cleaningIntervalGrinds" type="number" min="1" autocomplete="off" placeholder="grinds" />
      </div>
      <div>
        <label for="grinder-edit-interval-weeks">...or every</label>
        <input id="grinder-edit-interval-weeks" name="cleaningIntervalWeeks" type="number" min="1" autocomplete="off" placeholder="weeks" />
        <span>weeks, whichever comes first</span>
      </div>
      <div class="sheet-actions">
        <button type="submit" class="brew-button">Save</button>
      </div>
    </form>
    ${
      grinder
        ? `
      <div class="sheet-secondary-actions">
        <button type="button" id="grinder-edit-mark-cleaned" class="sheet-secondary-button">Mark cleaned</button>
        <button type="button" id="grinder-edit-delete" class="sheet-danger-button">Delete grinder</button>
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
