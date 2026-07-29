import { db, newId, getSettings } from "../db/db.js";
import { parseDateInputValue, todayDateInputValue } from "../utils/dates.js";

const RATINGS = [1, 2, 3, 4, 5];

/**
 * @param {HTMLElement} container
 */
export async function renderBrews(container) {
  const [bags, grinders, roasters, settings] = await Promise.all([
    db.bags.orderBy("roastDate").reverse().toArray(),
    db.grinders.orderBy("name").toArray(),
    db.roasters.toArray(),
    getSettings(),
  ]);

  if (bags.length === 0 || grinders.length === 0) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent =
      bags.length === 0
        ? "Add a bag first before logging a brew."
        : "Add a grinder first before logging a brew.";
    container.append(message);
    return;
  }

  const roasterNames = new Map(roasters.map((r) => [r.id, r.name]));
  const grinderNames = new Map(grinders.map((g) => [g.id, g.name]));
  const bagsById = new Map(bags.map((b) => [b.id, b]));
  const defaultGrinderId = settings?.defaultGrinderId;

  container.innerHTML = `
    <h1>Brews</h1>
    <form id="brew-form">
      <div>
        <label for="brew-bag">Bag</label>
        <select id="brew-bag" name="bagId" required></select>
      </div>
      <div>
        <label for="brew-grinder">Grinder</label>
        <select id="brew-grinder" name="grinderId" required></select>
      </div>
      <div>
        <label for="brew-date">Brew date</label>
        <input id="brew-date" name="brewDate" type="date" required />
      </div>
      <div>
        <label for="brew-grind-size">Grind size</label>
        <input id="brew-grind-size" name="grindSize" type="number" step="any" required />
      </div>
      <div>
        <label for="brew-dose">Dose (g)</label>
        <input id="brew-dose" name="doseGrams" type="number" step="any" min="0" />
      </div>
      <div>
        <label for="brew-yield">Yield (g)</label>
        <input id="brew-yield" name="yieldGrams" type="number" step="any" min="0" />
      </div>
      <div>
        <label for="brew-extraction-time">Extraction time (seconds)</label>
        <input id="brew-extraction-time" name="extractionTimeSeconds" type="number" min="0" required />
      </div>
      <div>
        <label for="brew-water-temp">Water temp (°C)</label>
        <input id="brew-water-temp" name="waterTempCelsius" type="number" step="any" />
      </div>
      <div>
        <label for="brew-rating">Rating</label>
        <select id="brew-rating" name="rating" required>
          <option value="" disabled selected>Select…</option>
          ${RATINGS.map((r) => `<option value="${r}">${r}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="brew-notes">Notes</label>
        <textarea id="brew-notes" name="notes" maxlength="256" rows="3"></textarea>
      </div>
      <button type="submit">Add brew</button>
    </form>
    <ul id="brew-list"></ul>
  `;

  const bagSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#brew-bag")
  );
  for (const bag of bags) {
    const option = document.createElement("option");
    option.value = bag.id;
    option.textContent = `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"} (${bag.roastDate.toLocaleDateString()})`;
    bagSelect.append(option);
  }

  const grinderSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#brew-grinder")
  );
  for (const grinder of grinders) {
    const option = document.createElement("option");
    option.value = grinder.id;
    option.textContent = grinder.name;
    if (grinder.id === defaultGrinderId) option.selected = true;
    grinderSelect.append(option);
  }

  const dateInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#brew-date")
  );
  dateInput.value = todayDateInputValue();

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#brew-form")
  );
  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#brew-list")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const bagId = String(data.get("bagId") ?? "");
    const grinderId = String(data.get("grinderId") ?? "");
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

    if (
      !bagId ||
      !grinderId ||
      !brewDate ||
      !grindSize ||
      !extractionTimeSeconds ||
      !rating
    ) {
      return;
    }

    await db.brews.add({
      id: newId(),
      bagId,
      grinderId,
      brewDate: parseDateInputValue(brewDate),
      grindSize: Number(grindSize),
      doseGrams: doseGrams ? Number(doseGrams) : undefined,
      yieldGrams: yieldGrams ? Number(yieldGrams) : undefined,
      extractionTimeSeconds: Number(extractionTimeSeconds),
      waterTempCelsius: waterTempCelsius ? Number(waterTempCelsius) : undefined,
      rating: /** @type {1 | 2 | 3 | 4 | 5} */ (Number(rating)),
      notes: notes || undefined,
    });

    form.reset();
    dateInput.value = todayDateInputValue();
    for (const option of grinderSelect.options) {
      option.selected = option.value === defaultGrinderId;
    }
    await renderList();
  });

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const brewId = target.dataset.deleteId;
    if (!brewId) return;

    if (!confirm("Delete this brew?")) return;
    await db.brews.delete(brewId);
    await renderList();
  });

  async function renderList() {
    const brews = await db.brews.orderBy("brewDate").reverse().toArray();
    list.innerHTML = "";

    for (const brew of brews) {
      const item = document.createElement("li");
      const bag = bagsById.get(brew.bagId);
      const bagLabel = bag
        ? `${bag.name} — ${roasterNames.get(bag.roasterId) ?? "Unknown roaster"}`
        : "Unknown bag";

      const title = document.createElement("strong");
      title.textContent = `${bagLabel} — ${"★".repeat(brew.rating)}${"☆".repeat(5 - brew.rating)}`;
      item.append(title);

      const details = [
        brew.brewDate.toLocaleDateString(),
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
      details.push(`${brew.extractionTimeSeconds}s`);
      if (brew.waterTempCelsius) details.push(`${brew.waterTempCelsius}°C`);
      item.append(` — ${details.join(", ")}`);

      if (brew.notes) {
        const notes = document.createElement("div");
        notes.textContent = brew.notes;
        item.append(notes);
      }

      item.append(" — ");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.dataset.deleteId = brew.id;
      item.append(deleteButton);

      list.append(item);
    }
  }

  await renderList();
}
