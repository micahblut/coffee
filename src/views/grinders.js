import {
  db,
  newId,
  getSettings,
  setDefaultGrinderId,
  deleteGrinder,
} from "../db/db.js";
import { parseDateInputValue } from "../utils/dates.js";

/**
 * @param {HTMLElement} container
 */
export async function renderGrinders(container) {
  container.innerHTML = `
    <h1>Grinders</h1>
    <form id="grinder-form">
      <div>
        <label for="grinder-name">Name</label>
        <input id="grinder-name" name="name" type="text" required />
      </div>
      <div>
        <label for="grinder-last-cleaned">Last cleaned</label>
        <input id="grinder-last-cleaned" name="lastCleanedDate" type="date" />
      </div>
      <button type="submit">Add grinder</button>
    </form>
    <ul id="grinder-list"></ul>
  `;

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#grinder-form")
  );
  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#grinder-list")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const lastCleanedDate = String(data.get("lastCleanedDate") ?? "").trim();
    if (!name) return;

    const isFirstGrinder = (await db.grinders.count()) === 0;
    const grinderId = newId();

    await db.grinders.add({
      id: grinderId,
      name,
      lastCleanedDate: lastCleanedDate
        ? parseDateInputValue(lastCleanedDate)
        : undefined,
    });

    if (isFirstGrinder) {
      await setDefaultGrinderId(grinderId);
    }

    form.reset();
    await renderList();
  });

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    if (target.dataset.makeDefaultId) {
      await setDefaultGrinderId(target.dataset.makeDefaultId);
      await renderList();
      return;
    }

    if (target.dataset.deleteId) {
      if (!confirm("Delete this grinder?")) return;
      await deleteGrinder(target.dataset.deleteId);
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
