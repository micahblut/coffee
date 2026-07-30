import { exportAllData, importAllData } from "../db/db.js";
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
export async function renderData(container, nav) {
  container.innerHTML = `
    <h1>Data</h1>
    <section>
      <h2>Export</h2>
      <p>Download all of your roasters, bags, grinders, brewers, and brews as a JSON file.</p>
      <button type="button" id="export-button">Export data</button>
    </section>
    <section>
      <h2>Import</h2>
      <p>Restoring from a file replaces everything currently stored in this browser.</p>
      <input type="file" id="import-input" accept="application/json" />
    </section>
    <p id="data-status"></p>
  `;

  const status = /** @type {HTMLElement} */ (
    container.querySelector("#data-status")
  );

  const exportButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#export-button")
  );
  exportButton.addEventListener("click", async () => {
    const data = await exportAllData();
    downloadJson(`caffe-export-${todayDateInputValue()}.json`, data);
    status.textContent = "Export downloaded.";
  });

  const importInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#import-input")
  );
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      status.textContent = "That file isn't valid JSON.";
      importInput.value = "";
      return;
    }

    const shouldImport = await nav.confirm(
      "This replaces all roasters, bags, grinders, brewers, and brews currently stored in this browser with the contents of this file. Continue?",
      { confirmLabel: "Continue" },
    );
    if (!shouldImport) {
      importInput.value = "";
      return;
    }

    try {
      await importAllData(data);
      status.textContent = "Import complete.";
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Import failed.";
    }
    importInput.value = "";
  });
}
