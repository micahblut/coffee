import {
  db,
  getSettings,
  updateSettings,
  exportAllData,
  importAllData,
} from "../db/db.js";
import { todayDateInputValue } from "../utils/dates.js";
import { renderCloudSetupModal, signInWithPasskey, unlockCloudBackup } from "./cloud-setup.js";
import { isSignedIn, getUserId, clearSessionState } from "../sync/session.js";
import {
  startAutoSync,
  stopAutoSync,
  getSyncStatus,
  syncNow,
  subscribeToSyncStatus,
} from "../sync/auto-sync.js";
import {
  restoreFromCloud,
  getCachedBackupFormat,
  acknowledgeRemoteRevision,
} from "../sync/backup.js";
import { logout, deleteAccount } from "../api/client.js";

const COPY_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const KEY_ICON = `<svg class="sync-key-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>`;

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
            <label for="settings-grind-size">Default grind size</label>
            <input id="settings-grind-size" name="defaultGrindSize" type="number" step="any" autocomplete="off" />
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
          <div>
            <label for="settings-extraction-time">Default extraction time (seconds)</label>
            <input id="settings-extraction-time" name="defaultExtractionTimeSeconds" type="number" min="0" autocomplete="off" />
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

  const grindSizeInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#settings-grind-size")
  );
  grindSizeInput.value =
    settings?.defaultGrindSize != null ? String(settings.defaultGrindSize) : "";

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

  const extractionTimeInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#settings-extraction-time")
  );
  extractionTimeInput.value =
    settings?.defaultExtractionTimeSeconds != null
      ? String(settings.defaultExtractionTimeSeconds)
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
    const defaultGrindSize = String(data.get("defaultGrindSize") ?? "").trim();
    const defaultDoseGrams = String(data.get("defaultDoseGrams") ?? "").trim();
    const defaultYieldGrams = String(
      data.get("defaultYieldGrams") ?? "",
    ).trim();
    const defaultWaterTempCelsius = String(
      data.get("defaultWaterTempCelsius") ?? "",
    ).trim();
    const defaultExtractionTimeSeconds = String(
      data.get("defaultExtractionTimeSeconds") ?? "",
    ).trim();

    await updateSettings({
      defaultGrinderId: defaultGrinderId || undefined,
      defaultBrewerId: defaultBrewerId || undefined,
      defaultGrindSize: defaultGrindSize ? Number(defaultGrindSize) : undefined,
      defaultDoseGrams: defaultDoseGrams ? Number(defaultDoseGrams) : undefined,
      defaultYieldGrams: defaultYieldGrams
        ? Number(defaultYieldGrams)
        : undefined,
      defaultWaterTempCelsius: defaultWaterTempCelsius
        ? Number(defaultWaterTempCelsius)
        : undefined,
      defaultExtractionTimeSeconds: defaultExtractionTimeSeconds
        ? Number(defaultExtractionTimeSeconds)
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

/**
 * HTML (not plain text) so an encrypted backup can show a trailing key icon
 * next to its timestamp — the only reason this isn't just textContent.
 */
function cloudStatusHtml() {
  const { status, lastSyncedAt } = getSyncStatus();
  const keyIconHtml = getCachedBackupFormat() === "encrypted" ? ` ${KEY_ICON}` : "";
  switch (status) {
    case "syncing":
      return "Syncing…";
    case "pending":
      return "Sync pending…";
    case "error":
      return "Sync failed — will retry on next change.";
    case "locked":
      return "Cloud backup is locked on this device.";
    case "conflict":
      return "Sync paused — another device updated this backup. Back up again to keep this device's version, or restore from cloud to use theirs.";
    case "synced":
      return lastSyncedAt
        ? `Synced at ${formatSyncedAt(lastSyncedAt)}${keyIconHtml}`
        : "Synced.";
    default:
      return lastSyncedAt
        ? `Last synced at ${formatSyncedAt(lastSyncedAt)}${keyIconHtml}`
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
    <button type="button" id="cloud-unlock-button" class="brew-button" hidden>Unlock cloud backup</button>
    <button type="button" id="cloud-backup-now-button" class="brew-button">Back up data</button>
    <button type="button" id="cloud-restore-button" class="brew-button">Restore from cloud</button>
    <div class="cloud-user-id">
      <span id="cloud-user-id-text" class="cloud-user-id-text"></span>
      <button type="button" id="cloud-copy-uid-button" class="cloud-copy-uid-button" aria-label="Copy user ID">
        ${COPY_ICON}
      </button>
    </div>
    <p id="cloud-copy-uid-status"></p>
    <button type="button" id="cloud-sign-out-button" class="detail-delete-button">Sign out</button>
  `;

  const statusText = /** @type {HTMLElement} */ (
    card.querySelector("#cloud-status-text")
  );
  const unlockButton = /** @type {HTMLButtonElement} */ (
    card.querySelector("#cloud-unlock-button")
  );

  function updateCloudStatus() {
    statusText.innerHTML = cloudStatusHtml();
    unlockButton.hidden = getSyncStatus().status !== "locked";
  }
  updateCloudStatus();

  const userIdText = /** @type {HTMLElement} */ (
    card.querySelector("#cloud-user-id-text")
  );
  userIdText.textContent = `User ID: ${getUserId() ?? ""}`;

  const copyUidStatus = /** @type {HTMLElement} */ (
    card.querySelector("#cloud-copy-uid-status")
  );
  const copyUidButton = /** @type {HTMLButtonElement} */ (
    card.querySelector("#cloud-copy-uid-button")
  );
  copyUidButton.addEventListener("click", async () => {
    const userId = getUserId();
    if (!userId) return;
    try {
      await navigator.clipboard.writeText(userId);
      copyUidStatus.textContent = "Copied to clipboard.";
    } catch {
      copyUidStatus.textContent = "Couldn't copy — select and copy it manually.";
    }
  });

  // Re-rendering this card (sign-in, sign-out, setup) replaces statusText
  // with a fresh node, which detaches this one — that's the unsubscribe
  // signal, so a stale listener never lingers past its own card render.
  const unsubscribe = subscribeToSyncStatus(() => {
    if (!statusText.isConnected) {
      unsubscribe();
      return;
    }
    updateCloudStatus();
  });

  unlockButton.addEventListener("click", async () => {
    statusText.textContent = "Unlocking...";
    try {
      await unlockCloudBackup();
      updateCloudStatus();
    } catch (error) {
      statusText.textContent =
        error instanceof Error ? error.message : "Couldn't unlock.";
    }
  });

  const backupNowButton = /** @type {HTMLButtonElement} */ (
    card.querySelector("#cloud-backup-now-button")
  );
  backupNowButton.addEventListener("click", async () => {
    statusText.textContent = "Backing up...";
    try {
      // A conflict means this device's last push was rejected because
      // another device changed the cloud backup first — clicking this
      // button again is treated as an explicit "keep this device's
      // version" choice, so learn the cloud's current revision first and
      // then push over it, rather than retrying with the stale one.
      if (getSyncStatus().status === "conflict") await acknowledgeRemoteRevision();
      await syncNow();
      statusText.innerHTML = cloudStatusHtml();
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
