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
