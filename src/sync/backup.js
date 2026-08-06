import { exportAllData, importAllData } from "../db/db.js";
import { pushBackup, pullBackup } from "../api/client.js";

export async function backupNow() {
  const data = await exportAllData();
  return pushBackup(data);
}

export async function restoreFromCloud() {
  const data = await pullBackup();
  return importAllData(data);
}
