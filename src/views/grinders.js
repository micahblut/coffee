import {
  db,
  newId,
  getSettings,
  setDefaultGrinderId,
  deleteGrinder,
} from "../db/db.js";
import { parseDateInputValue, dateToInputValue } from "../utils/dates.js";

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
    if (!name) return;

    const fields = {
      name,
      lastCleanedDate: lastCleanedDate
        ? parseDateInputValue(lastCleanedDate)
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
      submitButton.textContent = "Save grinder";
      cancelButton.hidden = false;
      return;
    }

    if (target.dataset.makeDefaultId) {
      await setDefaultGrinderId(target.dataset.makeDefaultId);
      await renderList();
      return;
    }

    if (target.dataset.deleteId) {
      if (!confirm("Delete this grinder?")) return;
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

      item.append(" — ");
      if (grinder.id === defaultGrinderId) {
        item.append("default");
      } else {
        const defaultButton = document.createElement("button");
        defaultButton.type = "button";
        defaultButton.textContent = "Make default";
        defaultButton.dataset.makeDefaultId = grinder.id;
        item.append(defaultButton);
      }

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
