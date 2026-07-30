import {
  db,
  newId,
  getSettings,
  setDefaultBrewerId,
  deleteBrewer,
  markBrewerCleaned,
  getBrewerCleaningStatus,
} from "../db/db.js";
import {
  parseDateInputValue,
  dateToInputValue,
  startOfToday,
} from "../utils/dates.js";
import { formatCleaningStatus } from "./grinders.js";

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderBrewers(container, nav) {
  container.innerHTML = `
    <h1>Brewers</h1>
    <form id="brewer-form">
      <div>
        <label for="brewer-name">Name</label>
        <input id="brewer-name" name="name" type="text" autocomplete="off" required />
      </div>
      <div>
        <label for="brewer-last-cleaned">Last cleaned</label>
        <input id="brewer-last-cleaned" name="lastCleanedDate" type="date" autocomplete="off" />
      </div>
      <div>
        <label for="brewer-interval-brews">Remind me to clean every</label>
        <input id="brewer-interval-brews" name="cleaningIntervalBrews" type="number" min="1" autocomplete="off" placeholder="brews" />
      </div>
      <div>
        <label for="brewer-interval-weeks">...or every</label>
        <input id="brewer-interval-weeks" name="cleaningIntervalWeeks" type="number" min="1" autocomplete="off" placeholder="weeks" />
        <span>weeks, whichever comes first</span>
      </div>
      <button type="submit" id="brewer-submit">Add brewer</button>
      <button type="button" id="brewer-cancel" hidden>Cancel</button>
    </form>
    <ul id="brewer-list"></ul>
  `;

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#brewer-form")
  );
  const nameInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brewer-name")
  );
  const lastCleanedInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brewer-last-cleaned")
  );
  const intervalBrewsInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brewer-interval-brews")
  );
  const intervalWeeksInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brewer-interval-weeks")
  );
  const submitButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#brewer-submit")
  );
  const cancelButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#brewer-cancel")
  );
  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#brewer-list")
  );

  /** @type {string | null} */
  let editingId = null;

  function resetToCreateMode() {
    editingId = null;
    form.reset();
    submitButton.textContent = "Add brewer";
    cancelButton.hidden = true;
  }

  cancelButton.addEventListener("click", resetToCreateMode);

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

    const existing = editingId ? await db.brewers.get(editingId) : undefined;
    const hasInterval = cleaningIntervalBrews || cleaningIntervalWeeks;

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
      cleaningIntervalBrews: cleaningIntervalBrews
        ? Number(cleaningIntervalBrews)
        : undefined,
      cleaningIntervalWeeks: cleaningIntervalWeeks
        ? Number(cleaningIntervalWeeks)
        : undefined,
    };

    if (editingId) {
      await db.brewers.update(editingId, fields);
    } else {
      const isFirstBrewer = (await db.brewers.count()) === 0;
      const brewerId = newId();
      await db.brewers.add({ id: brewerId, ...fields });
      if (isFirstBrewer) {
        await setDefaultBrewerId(brewerId);
      }
    }

    resetToCreateMode();
    await renderList();
  });

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    if (target.dataset.editId) {
      const brewer = await db.brewers.get(target.dataset.editId);
      if (!brewer) return;

      editingId = brewer.id;
      nameInput.value = brewer.name;
      lastCleanedInput.value = brewer.lastCleanedDate
        ? dateToInputValue(brewer.lastCleanedDate)
        : "";
      intervalBrewsInput.value =
        brewer.cleaningIntervalBrews != null
          ? String(brewer.cleaningIntervalBrews)
          : "";
      intervalWeeksInput.value =
        brewer.cleaningIntervalWeeks != null
          ? String(brewer.cleaningIntervalWeeks)
          : "";
      submitButton.textContent = "Save brewer";
      cancelButton.hidden = false;
      return;
    }

    if (target.dataset.markCleanedId) {
      await markBrewerCleaned(target.dataset.markCleanedId);
      await renderList();
      return;
    }

    if (target.dataset.deleteId) {
      if (!(await nav.confirm("Delete this brewer?", { confirmLabel: "Delete" })))
        return;
      await deleteBrewer(target.dataset.deleteId);
      if (editingId === target.dataset.deleteId) resetToCreateMode();
      await renderList();
    }
  });

  async function renderList() {
    const [brewers, settings] = await Promise.all([
      db.brewers.orderBy("name").toArray(),
      getSettings(),
    ]);
    const defaultBrewerId = settings?.defaultBrewerId;

    list.innerHTML = "";

    for (const brewer of brewers) {
      const item = document.createElement("li");

      const name = document.createElement("strong");
      name.textContent = brewer.name;
      item.append(name);

      if (brewer.lastCleanedDate) {
        item.append(
          ` — last cleaned ${brewer.lastCleanedDate.toLocaleDateString()}`,
        );
      }

      const status = await getBrewerCleaningStatus(brewer.id);
      if (status) {
        const statusEl = document.createElement("div");
        statusEl.textContent = formatCleaningStatus(status);
        item.append(statusEl);
      }

      if (brewer.id === defaultBrewerId) {
        item.append(" — default");
      }

      item.append(" — ");
      const markCleanedButton = document.createElement("button");
      markCleanedButton.type = "button";
      markCleanedButton.textContent = "Mark cleaned";
      markCleanedButton.dataset.markCleanedId = brewer.id;
      item.append(markCleanedButton);

      item.append(" — ");
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.dataset.editId = brewer.id;
      item.append(editButton);

      item.append(" ");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.dataset.deleteId = brewer.id;
      item.append(deleteButton);

      list.append(item);
    }
  }

  await renderList();
}
