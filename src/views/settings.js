import {
  db,
  getSettings,
  updateSettings,
  exportAllData,
  importAllData,
} from "../db/db.js";
import { todayDateInputValue } from "../utils/dates.js";

/**
 * @param {string} filename
 * @param {unknown} data
 */
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

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
    <section class="settings-section">
      <h2>Daily brew settings</h2>
      <div class="settings-card">
        <p>Set any defaults to pre-fill the brew form - you can always change them when logging a brew.</p>
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
          <button type="submit" class="brew-button">Save settings</button>
        </form>
        <p id="settings-status"></p>
      </div>
    </section>
    <section class="settings-section">
      <h2>Data</h2>
      <div class="settings-card">
        <h3>Export</h3>
        <p>Download all of your roasters, bags, grinders, brewers, and brews as a JSON file.</p>
        <button type="button" id="export-button" class="brew-button">Export data</button>
        <h3>Import</h3>
        <p>Restoring from a file replaces everything currently stored in this browser.</p>
        <button type="button" id="import-button" class="brew-button">Import data</button>
        <input type="file" id="import-input" accept="application/json" hidden />
        <p id="data-status"></p>
      </div>
    </section>
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

  const dataStatus = /** @type {HTMLElement} */ (
    container.querySelector("#data-status")
  );

  const exportButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#export-button")
  );
  exportButton.addEventListener("click", async () => {
    const data = await exportAllData();
    downloadJson(`caffe-export-${todayDateInputValue()}.json`, data);
    dataStatus.textContent = "Export downloaded.";
  });

  const importButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#import-button")
  );
  const importInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#import-input")
  );
  importButton.addEventListener("click", () => importInput.click());

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      dataStatus.textContent = "That file isn't valid JSON.";
      importInput.value = "";
      return;
    }

    try {
      await importAllData(data);
      dataStatus.textContent = "Import complete.";
    } catch (error) {
      dataStatus.textContent =
        error instanceof Error ? error.message : "Import failed.";
    }
    importInput.value = "";
  });
}
