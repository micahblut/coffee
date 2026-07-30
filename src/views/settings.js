import { db, getSettings, updateSettings } from "../db/db.js";

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderSettings(container, nav) {
  const [grinders, brewers, settings] = await Promise.all([
    db.grinders.orderBy("name").toArray(),
    db.brewers.orderBy("name").toArray(),
    getSettings(),
  ]);

  container.innerHTML = `
    <h1>Settings</h1>
    <p>These defaults pre-fill the brew form — leave any blank to not pre-fill it.</p>
    <form id="settings-form">
      <div>
        <label for="settings-grinder">Default grinder</label>
        <select id="settings-grinder" name="defaultGrinderId">
          <option value="">None</option>
        </select>
      </div>
      <div>
        <label for="settings-brewer">Default brewer</label>
        <select id="settings-brewer" name="defaultBrewerId">
          <option value="">None</option>
        </select>
      </div>
      <div>
        <label for="settings-dose">Default dose (g)</label>
        <input id="settings-dose" name="defaultDoseGrams" type="number" step="any" min="0" autocomplete="off" />
      </div>
      <div>
        <label for="settings-yield">Default yield (g)</label>
        <input id="settings-yield" name="defaultYieldGrams" type="number" step="any" min="0" autocomplete="off" />
      </div>
      <div>
        <label for="settings-water-temp">Default water temp (°C)</label>
        <input id="settings-water-temp" name="defaultWaterTempCelsius" type="number" step="any" autocomplete="off" />
      </div>
      <button type="submit">Save settings</button>
    </form>
    <p id="settings-status"></p>
  `;

  const grinderSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#settings-grinder")
  );
  for (const grinder of grinders) {
    const option = document.createElement("option");
    option.value = grinder.id;
    option.textContent = grinder.name;
    grinderSelect.append(option);
  }
  grinderSelect.value = settings?.defaultGrinderId ?? "";

  const brewerSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#settings-brewer")
  );
  for (const brewer of brewers) {
    const option = document.createElement("option");
    option.value = brewer.id;
    option.textContent = brewer.name;
    brewerSelect.append(option);
  }
  brewerSelect.value = settings?.defaultBrewerId ?? "";

  const doseInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#settings-dose")
  );
  doseInput.value =
    settings?.defaultDoseGrams != null ? String(settings.defaultDoseGrams) : "";

  const yieldInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#settings-yield")
  );
  yieldInput.value =
    settings?.defaultYieldGrams != null
      ? String(settings.defaultYieldGrams)
      : "";

  const waterTempInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#settings-water-temp")
  );
  waterTempInput.value =
    settings?.defaultWaterTempCelsius != null
      ? String(settings.defaultWaterTempCelsius)
      : "";

  const status = /** @type {HTMLElement} */ (
    container.querySelector("#settings-status")
  );

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#settings-form")
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const defaultGrinderId = String(data.get("defaultGrinderId") ?? "").trim();
    const defaultBrewerId = String(data.get("defaultBrewerId") ?? "").trim();
    const defaultDoseGrams = String(data.get("defaultDoseGrams") ?? "").trim();
    const defaultYieldGrams = String(
      data.get("defaultYieldGrams") ?? "",
    ).trim();
    const defaultWaterTempCelsius = String(
      data.get("defaultWaterTempCelsius") ?? "",
    ).trim();

    await updateSettings({
      defaultGrinderId: defaultGrinderId || undefined,
      defaultBrewerId: defaultBrewerId || undefined,
      defaultDoseGrams: defaultDoseGrams ? Number(defaultDoseGrams) : undefined,
      defaultYieldGrams: defaultYieldGrams
        ? Number(defaultYieldGrams)
        : undefined,
      defaultWaterTempCelsius: defaultWaterTempCelsius
        ? Number(defaultWaterTempCelsius)
        : undefined,
    });

    status.textContent = "Settings saved.";
  });
}
