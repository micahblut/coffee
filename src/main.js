import { db } from "./db/db.js";
import { renderRoasters } from "./views/roasters.js";
import { renderBags } from "./views/bags.js";
import { renderGrinders } from "./views/grinders.js";
import { renderBrews } from "./views/brews.js";

const app = /** @type {HTMLElement} */ (document.getElementById("app"));

const VIEWS = {
  roasters: { label: "Roasters", render: renderRoasters },
  bags: { label: "Bags", render: renderBags },
  grinders: { label: "Grinders", render: renderGrinders },
  brews: { label: "Brews", render: renderBrews },
};

async function main() {
  try {
    await db.open();
  } catch {
    app.textContent = "Failed to open the local database.";
    return;
  }

  app.innerHTML = `<nav id="nav"></nav><div id="content"></div>`;
  const nav = /** @type {HTMLElement} */ (app.querySelector("#nav"));
  const content = /** @type {HTMLElement} */ (app.querySelector("#content"));

  for (const view of Object.values(VIEWS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = view.label;
    button.addEventListener("click", () => view.render(content));
    nav.append(button);
  }

  await VIEWS.roasters.render(content);
}

main();
