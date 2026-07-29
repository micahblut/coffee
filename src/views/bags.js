import { db, newId } from "../db/db.js";
import { parseDateInputValue } from "../utils/dates.js";

const BAG_TYPES = ["Espresso", "Filter"];
const ROAST_PROCESSES = ["Washed", "Natural", "Honey", "Anaerobic", "Other"];

/**
 * @param {HTMLElement} container
 */
export async function renderBags(container) {
  const roasters = await db.roasters.orderBy("name").toArray();

  if (roasters.length === 0) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = "Add a roaster first before logging a bag.";
    container.append(message);
    return;
  }

  container.innerHTML = `
    <h1>Bags</h1>
    <form id="bag-form">
      <div>
        <label for="bag-name">Name</label>
        <input id="bag-name" name="name" type="text" placeholder="e.g. Sunrise Espresso Blend" required />
      </div>
      <div>
        <label for="bag-roaster">Roaster</label>
        <select id="bag-roaster" name="roasterId" required></select>
      </div>
      <div>
        <label for="bag-roast-date">Roast date</label>
        <input id="bag-roast-date" name="roastDate" type="date" required />
      </div>
      <div>
        <label for="bag-type">Type</label>
        <select id="bag-type" name="type" required>
          ${BAG_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="bag-origin">Origin</label>
        <input id="bag-origin" name="origin" type="text" placeholder="e.g. Ethiopia, Yirgacheffe" />
      </div>
      <div>
        <label for="bag-process">Process</label>
        <select id="bag-process" name="process">
          <option value="">—</option>
          ${ROAST_PROCESSES.map((process) => `<option value="${process}">${process}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="bag-weight">Weight (g)</label>
        <input id="bag-weight" name="weightGrams" type="number" min="0" />
      </div>
      <button type="submit">Add bag</button>
    </form>
    <ul id="bag-list"></ul>
  `;

  const roasterSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#bag-roaster")
  );
  for (const roaster of roasters) {
    const option = document.createElement("option");
    option.value = roaster.id;
    option.textContent = roaster.name;
    roasterSelect.append(option);
  }

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#bag-form")
  );
  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#bag-list")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const roasterId = String(data.get("roasterId") ?? "");
    const roastDate = String(data.get("roastDate") ?? "");
    const type = String(data.get("type") ?? "");
    const origin = String(data.get("origin") ?? "").trim();
    const process = String(data.get("process") ?? "").trim();
    const weightGrams = String(data.get("weightGrams") ?? "").trim();
    if (!name || !roasterId || !roastDate || !type) return;

    await db.bags.add({
      id: newId(),
      name,
      roasterId,
      roastDate: parseDateInputValue(roastDate),
      type: /** @type {import("../models/types.js").BagType} */ (type),
      origin: origin || undefined,
      process: /** @type {import("../models/types.js").RoastProcess | undefined} */ (
        process || undefined
      ),
      weightGrams: weightGrams ? Number(weightGrams) : undefined,
    });

    form.reset();
    await renderList();
  });

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const bagId = target.dataset.deleteId;
    if (!bagId) return;

    if (!confirm("Delete this bag?")) return;
    await db.bags.delete(bagId);
    await renderList();
  });

  async function renderList() {
    const roasterNames = new Map(roasters.map((r) => [r.id, r.name]));
    const bags = await db.bags.orderBy("roastDate").reverse().toArray();
    list.innerHTML = "";

    for (const bag of bags) {
      const item = document.createElement("li");

      const title = document.createElement("strong");
      title.textContent = `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"}`;
      item.append(title);

      const details = [bag.type, bag.roastDate.toLocaleDateString()];
      if (bag.origin) details.push(bag.origin);
      if (bag.process) details.push(bag.process);
      if (bag.weightGrams) details.push(`${bag.weightGrams}g`);
      item.append(` — ${details.join(", ")}`);

      item.append(" — ");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.dataset.deleteId = bag.id;
      item.append(deleteButton);

      list.append(item);
    }
  }

  await renderList();
}
