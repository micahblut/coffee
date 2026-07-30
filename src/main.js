import { db } from "./db/db.js";
import { renderHome } from "./views/home.js";
import { renderRoastersList } from "./views/roasters.js";
import { renderBagsList } from "./views/bags.js";
import { renderGrinders } from "./views/grinders.js";
import { renderBrewers } from "./views/brewers.js";
import { renderBrewsList } from "./views/brews.js";
import { renderData } from "./views/data.js";
import { renderSettings } from "./views/settings.js";

/**
 * @typedef {(container: HTMLElement) => void | Promise<void>} ViewRender
 * @typedef {Object} Nav
 * @property {(render: ViewRender) => Promise<void>} navigate
 * @property {() => Promise<void>} goBack
 * @property {(render: ViewRender) => Promise<void>} showModal
 * @property {() => void} hideModal
 */

const app = /** @type {HTMLElement} */ (document.getElementById("app"));

const VIEWS = {
  home: { label: "Home", render: renderHome },
  roasters: { label: "Roasters", render: renderRoastersList },
  bags: { label: "Bags", render: renderBagsList },
  grinders: { label: "Grinders", render: renderGrinders },
  brewers: { label: "Brewers", render: renderBrewers },
  brews: { label: "Brews", render: renderBrewsList },
  data: { label: "Data", render: renderData },
  settings: { label: "Settings", render: renderSettings },
};

async function main() {
  try {
    await db.open();
  } catch {
    app.textContent = "Failed to open the local database.";
    return;
  }

  app.innerHTML = `
    <nav id="nav"></nav>
    <div id="back-bar"></div>
    <div id="content"></div>
    <div id="modal-root" hidden></div>
  `;
  const navEl = /** @type {HTMLElement} */ (app.querySelector("#nav"));
  const backBar = /** @type {HTMLElement} */ (app.querySelector("#back-bar"));
  const content = /** @type {HTMLElement} */ (app.querySelector("#content"));
  const modalRoot = /** @type {HTMLElement} */ (
    app.querySelector("#modal-root")
  );

  /** @type {ViewRender[]} */
  let stack = [];
  /** @type {HTMLElement[]} */
  let modalContainers = [];

  async function renderCurrent() {
    backBar.innerHTML = "";
    if (stack.length > 1) {
      const backButton = document.createElement("button");
      backButton.type = "button";
      backButton.textContent = "← Back";
      backButton.addEventListener("click", () => nav.goBack());
      backBar.append(backButton);
    }

    content.innerHTML = "";
    const render = stack[stack.length - 1];
    await render(content);
  }

  /** @type {Nav} */
  const nav = {
    async navigate(render) {
      stack.push(render);
      await renderCurrent();
    },
    async goBack() {
      if (stack.length > 1) stack.pop();
      await renderCurrent();
    },
    // Each modal level gets its own persistent container, appended (never
    // replacing what's already there) so a form underneath is never torn
    // down or re-rendered — closing a modal (save or cancel) simply reveals
    // it exactly as the user left it, no state to reconstruct.
    async showModal(render) {
      const el = document.createElement("div");
      el.className = "modal";
      modalRoot.append(el);
      modalContainers.push(el);
      modalRoot.hidden = false;
      await render(el);
    },
    hideModal() {
      const el = modalContainers.pop();
      el?.remove();
      if (modalContainers.length === 0) modalRoot.hidden = true;
    },
  };

  /**
   * @param {(container: HTMLElement, nav: Nav) => void | Promise<void>} render
   */
  function switchTab(render) {
    for (const el of modalContainers) el.remove();
    modalContainers = [];
    modalRoot.hidden = true;
    stack = [(container) => render(container, nav)];
    renderCurrent();
  }

  for (const view of Object.values(VIEWS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = view.label;
    button.addEventListener("click", () => switchTab(view.render));
    navEl.append(button);
  }

  switchTab(VIEWS.home.render);
}

main();
