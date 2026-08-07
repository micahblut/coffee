import {
  db,
  getSettings,
  updateSettings,
  exportAllData,
  importAllData,
} from "../db/db.js";
import { todayDateInputValue } from "../utils/dates.js";
import { renderCloudSetupModal, signInWithPasskey } from "./cloud-setup.js";
import { isSignedIn, clearSessionState } from "../sync/session.js";
import {
  startAutoSync,
  stopAutoSync,
  getSyncStatus,
  syncNow,
  subscribeToSyncStatus,
} from "../sync/auto-sync.js";
import { restoreFromCloud } from "../sync/backup.js";
import { logout, deleteAccount } from "../api/client.js";

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
    <details class="settings-section" open>
      <summary>Daily brew settings</summary>
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
    </details>
    <details class="settings-section">
      <summary>Data</summary>
      <div class="settings-card">
        <h3>Export</h3>
        <p>Download all of your roasters, bags, grinders, brewers, and brews as a JSON file.</p>
        <button type="button" id="export-button" class="brew-button">Export data</button>
        <h3>Import</h3>
        <p>Restoring from a file replaces everything currently stored in this browser.</p>
        <button type="button" id="import-button" class="brew-button">Import data</button>
        <input type="file" id="import-input" accept="application/json" hidden />
        <h3>Delete</h3>
        <p>Deleting your data will remove all on-device and any cloud data. Make sure to export before deleting.</p>
        <button type="button" id="delete-data-button" class="brew-button">Delete data</button>
        <p id="data-status"></p>
      </div>
    </details>
    <details class="settings-section">
      <summary>Cloud backup (optional)</summary>
      <div class="settings-card" id="cloud-backup-card"></div>
    </details>
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

  const deleteDataButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#delete-data-button")
  );
  deleteDataButton.addEventListener("click", async () => {
    const confirmed = await nav.confirm(
      "If you delete without exporting, there is no way to recover your data.",
      { confirmLabel: "Delete data" },
    );
    if (!confirmed) return;

    dataStatus.textContent = "Deleting...";
    try {
      if (isSignedIn()) {
        stopAutoSync();
        await deleteAccount();
        clearSessionState();
      }
      await db.delete();
      window.location.reload();
    } catch (error) {
      dataStatus.textContent =
        error instanceof Error ? error.message : "Delete failed.";
    }
  });

  const cloudCard = /** @type {HTMLElement} */ (
    container.querySelector("#cloud-backup-card")
  );
  renderCloudBackupCard(cloudCard, nav);
}

/**
 * @param {Date} date
 */
function formatSyncedAt(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function cloudStatusText() {
  const { status, lastSyncedAt } = getSyncStatus();
  switch (status) {
    case "syncing":
      return "Syncing…";
    case "pending":
      return "Sync pending…";
    case "error":
      return "Sync failed — will retry on next change.";
    case "synced":
      return lastSyncedAt ? `Synced at ${formatSyncedAt(lastSyncedAt)}.` : "Synced.";
    default:
      return lastSyncedAt
        ? `Last synced at ${formatSyncedAt(lastSyncedAt)}.`
        : "Not backed up yet.";
  }
}

/**
 * @param {HTMLElement} card
 * @param {import("../main.js").Nav} nav
 */
function renderCloudBackupCard(card, nav) {
  if (!isSignedIn()) {
    card.innerHTML = `
      <p>Back up your data so it's safe if you switch devices.</p>
      <button type="button" id="cloud-setup-button" class="brew-button">Set up cloud backup</button>
      <p>Already set up on another device?</p>
      <button type="button" id="cloud-signin-button" class="brew-button">Sign in with passkey</button>
      <p id="cloud-signin-status"></p>
    `;
    const setupButton = /** @type {HTMLButtonElement} */ (
      card.querySelector("#cloud-setup-button")
    );
    setupButton.addEventListener("click", () => {
      nav.showModal((sheet) =>
        renderCloudSetupModal(sheet, nav, {
          onRegistered: () => {
            nav.hideModal();
            renderCloudBackupCard(card, nav);
          },
        }),
      );
    });

    const signInStatus = /** @type {HTMLElement} */ (
      card.querySelector("#cloud-signin-status")
    );
    const signInButton = /** @type {HTMLButtonElement} */ (
      card.querySelector("#cloud-signin-button")
    );
    signInButton.addEventListener("click", async () => {
      signInStatus.textContent = "Signing in...";
      try {
        await signInWithPasskey();
        renderCloudBackupCard(card, nav);
      } catch (error) {
        signInStatus.textContent =
          error instanceof Error ? error.message : "Sign-in failed.";
      }
    });
    return;
  }

  card.innerHTML = `
    <p id="cloud-status-text"></p>
    <button type="button" id="cloud-backup-now-button" class="brew-button">Back up data</button>
    <button type="button" id="cloud-restore-button" class="brew-button">Restore from cloud</button>
    <button type="button" id="cloud-sign-out-button" class="detail-delete-button">Sign out</button>
  `;

  const statusText = /** @type {HTMLElement} */ (
    card.querySelector("#cloud-status-text")
  );
  statusText.textContent = cloudStatusText();

  // Re-rendering this card (sign-in, sign-out, setup) replaces statusText
  // with a fresh node, which detaches this one — that's the unsubscribe
  // signal, so a stale listener never lingers past its own card render.
  const unsubscribe = subscribeToSyncStatus(() => {
    if (!statusText.isConnected) {
      unsubscribe();
      return;
    }
    statusText.textContent = cloudStatusText();
  });

  const backupNowButton = /** @type {HTMLButtonElement} */ (
    card.querySelector("#cloud-backup-now-button")
  );
  backupNowButton.addEventListener("click", async () => {
    statusText.textContent = "Backing up...";
    try {
      await syncNow();
      statusText.textContent = cloudStatusText();
    } catch (error) {
      statusText.textContent =
        error instanceof Error ? error.message : "Backup failed.";
    }
  });

  const restoreButton = /** @type {HTMLButtonElement} */ (
    card.querySelector("#cloud-restore-button")
  );
  restoreButton.addEventListener("click", async () => {
    const confirmed = await nav.confirm(
      "Restoring replaces everything currently stored on this device with your cloud backup.",
      { confirmLabel: "Restore" },
    );
    if (!confirmed) return;

    statusText.textContent = "Restoring...";
    try {
      await restoreFromCloud();
      statusText.textContent = "Restore complete.";
    } catch (error) {
      statusText.textContent =
        error instanceof Error ? error.message : "Restore failed.";
    }
  });

  const signOutButton = /** @type {HTMLButtonElement} */ (
    card.querySelector("#cloud-sign-out-button")
  );
  signOutButton.addEventListener("click", async () => {
    stopAutoSync();
    try {
      await logout();
    } catch {
      // Session cookie may already be gone server-side — sign out locally regardless.
    }
    clearSessionState();
    renderCloudBackupCard(card, nav);
  });
}
