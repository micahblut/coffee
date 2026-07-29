import { db } from "./db/db.js";
import { renderRoasters } from "./views/roasters.js";
import { renderBags } from "./views/bags.js";
import { renderGrinders } from "./views/grinders.js";
import { renderBrews } from "./views/brews.js";
import { renderData } from "./views/data.js";

/**
 * @typedef {(container: HTMLElement) => void | Promise<void>} ViewRender
 * @typedef {(render: ViewRender) => Promise<void>} Navigate
 */

const app = /** @type {HTMLElement} */ (document.getElementById("app"));

const VIEWS = {
  roasters: { label: "Roasters", render: renderRoasters },
  bags: { label: "Bags", render: renderBags },
  grinders: { label: "Grinders", render: renderGrinders },
  brews: { label: "Brews", render: renderBrews },
  data: { label: "Data", render: renderData },
};

async function main() {
  try {
    await db.open();
  } catch {
    app.textContent = "Failed to open the local database.";
    return;
  }

  app.innerHTML = `<nav id="nav"></nav><div id="back-bar"></div><div id="content"></div>`;
  const nav = /** @type {HTMLElement} */ (app.querySelector("#nav"));
  const backBar = /** @type {HTMLElement} */ (app.querySelector("#back-bar"));
  const content = /** @type {HTMLElement} */ (app.querySelector("#content"));

  /** @type {ViewRender[]} */
  let stack = [];

  async function renderCurrent() {
    backBar.innerHTML = "";
    if (stack.length > 1) {
      const backButton = document.createElement("button");
      backButton.type = "button";
      backButton.textContent = "← Back";
      backButton.addEventListener("click", () => {
        stack.pop();
        renderCurrent();
      });
      backBar.append(backButton);
    }

    content.innerHTML = "";
    const render = stack[stack.length - 1];
    await render(content);
  }

  /** @type {Navigate} */
  async function navigate(render) {
    stack.push(render);
    await renderCurrent();
  }

  /**
   * @param {(container: HTMLElement, navigate: Navigate) => void | Promise<void>} render
   */
  function switchTab(render) {
    stack = [(container) => render(container, navigate)];
    renderCurrent();
  }

  for (const view of Object.values(VIEWS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = view.label;
    button.addEventListener("click", () => switchTab(view.render));
    nav.append(button);
  }

  switchTab(VIEWS.roasters.render);
}

main();
