import { db } from "./db/db.js";

const app = /** @type {HTMLElement} */ (document.getElementById("app"));

async function render() {
  let dbStatus = "connecting";
  try {
    await db.open();
    dbStatus = "ready";
  } catch {
    dbStatus = "error";
  }

  app.innerHTML = `
    <h1>caffe</h1>
    <p>Coffee logbook. Database: ${dbStatus}</p>
  `;
}

render();
