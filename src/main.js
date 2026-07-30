import { db } from "./db/db.js";
import { renderHome } from "./views/home.js";
import { renderRoastersList } from "./views/roasters.js";
import { renderBagsList } from "./views/bags.js";
import { renderGrinders } from "./views/grinders.js";
import { renderBrewers } from "./views/brewers.js";
import { renderBrewsList } from "./views/brews.js";
import { renderData } from "./views/data.js";
import { renderSettings } from "./views/settings.js";
import { renderEquipmentHome } from "./views/equipment.js";

/**
 * @typedef {(container: HTMLElement) => void | Promise<void>} ViewRender
 * @typedef {Object} Nav
 * @property {(render: ViewRender) => Promise<void>} navigate
 * @property {() => Promise<void>} goBack
 * @property {(render: ViewRender) => Promise<void>} showModal
 * @property {() => void} hideModal
 * @property {(message: string, options?: { confirmLabel?: string, cancelLabel?: string }) => Promise<boolean>} confirm
 */

const app = /** @type {HTMLElement} */ (document.getElementById("app"));

const VIEWS = {
  // hideFromTopNav: the app header (built below) is the tap target back to
  // home now, so it doesn't also need a slot in the top nav row.
  home: { label: "Home", render: renderHome, hideFromTopNav: true },
  roasters: {
    label: "Roasters",
    render: renderRoastersList,
    hideFromTopNav: false,
  },
  bags: { label: "Bags", render: renderBagsList, hideFromTopNav: false },
  grinders: {
    label: "Grinders",
    render: renderGrinders,
    hideFromTopNav: false,
  },
  brewers: {
    label: "Brewers",
    render: renderBrewers,
    hideFromTopNav: false,
  },
  brews: { label: "Brews", render: renderBrewsList, hideFromTopNav: false },
  data: { label: "Data", render: renderData, hideFromTopNav: false },
  settings: {
    label: "Settings",
    render: renderSettings,
    hideFromTopNav: false,
  },
  // Reachable from the bottom nav's "Equipment" tab, not the legacy top nav
  // row — it just links out to the Grinders/Brewers tabs above.
  equipment: {
    label: "Equipment",
    render: renderEquipmentHome,
    hideFromTopNav: true,
  },
};

const BOTTOM_NAV_ITEMS = /** @type {const} */ ([
  {
    key: "home",
    label: "Coffee",
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h14v5a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8Z"></path><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"></path><path d="M6 2v2M10 2v2M14 2v2"></path></svg>`,
  },
  {
    key: "equipment",
    label: "Equipment",
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4L15 12l-3-3 2.7-2.7Z"></path></svg>`,
  },
  {
    key: "settings",
    label: "Settings",
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1Z"></path></svg>`,
  },
]);

async function main() {
  try {
    await db.open();
  } catch {
    app.textContent = "Failed to open the local database.";
    return;
  }

  app.innerHTML = `
    <button type="button" id="app-header">Caffè Quaderno</button>
    <div id="app-frame">
      <nav id="nav"></nav>
      <div id="back-bar"></div>
      <div id="content"></div>
      <div id="modal-root" hidden></div>
    </div>
    <nav id="bottom-nav"></nav>
  `;
  const appHeader = /** @type {HTMLButtonElement} */ (
    app.querySelector("#app-header")
  );
  const navEl = /** @type {HTMLElement} */ (app.querySelector("#nav"));
  const backBar = /** @type {HTMLElement} */ (app.querySelector("#back-bar"));
  const content = /** @type {HTMLElement} */ (app.querySelector("#content"));
  const modalRoot = /** @type {HTMLElement} */ (
    app.querySelector("#modal-root")
  );
  const bottomNavEl = /** @type {HTMLElement} */ (
    app.querySelector("#bottom-nav")
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
    // Renders a Yes/No dialog in the same modal layer used everywhere else,
    // so every "are you sure?" prompt (deletes, destructive imports, etc.)
    // looks and behaves consistently instead of relying on the browser's
    // own confirm() styling.
    async confirm(message, options = {}) {
      const { confirmLabel = "OK", cancelLabel = "Cancel" } = options;
      return new Promise((resolve) => {
        nav.showModal((container) => {
          container.innerHTML = `
            <p id="confirm-message"></p>
            <button type="button" id="confirm-cancel"></button>
            <button type="button" id="confirm-ok"></button>
          `;

          const messageEl = /** @type {HTMLElement} */ (
            container.querySelector("#confirm-message")
          );
          messageEl.textContent = message;

          const cancelButton = /** @type {HTMLButtonElement} */ (
            container.querySelector("#confirm-cancel")
          );
          cancelButton.textContent = cancelLabel;
          cancelButton.addEventListener("click", () => {
            nav.hideModal();
            resolve(false);
          });

          const okButton = /** @type {HTMLButtonElement} */ (
            container.querySelector("#confirm-ok")
          );
          okButton.textContent = confirmLabel;
          okButton.addEventListener("click", () => {
            nav.hideModal();
            resolve(true);
          });
        });
      });
    },
  };

  /** @type {keyof typeof VIEWS} */
  let activeTabKey = "home";

  /**
   * @param {keyof typeof VIEWS} key
   */
  function switchTab(key) {
    activeTabKey = key;
    for (const el of modalContainers) el.remove();
    modalContainers = [];
    modalRoot.hidden = true;
    stack = [(container) => VIEWS[key].render(container, nav)];
    renderCurrent();
    for (const button of bottomNavEl.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.tabKey === key);
    }
  }

  for (const [key, view] of Object.entries(VIEWS)) {
    if (view.hideFromTopNav) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = view.label;
    button.addEventListener("click", () =>
      switchTab(/** @type {keyof typeof VIEWS} */ (key)),
    );
    navEl.append(button);
  }

  appHeader.addEventListener("click", () => switchTab("home"));

  // Persistent bottom nav — the Coffee/Equipment/Settings tabs from the
  // home screen sketch, kept alongside the legacy top nav row above rather
  // than replacing it (that's a bigger IA change for a later pass).
  for (const item of BOTTOM_NAV_ITEMS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tabKey = item.key;
    button.innerHTML = `<span class="bottom-nav-icon">${item.icon}</span><span>${item.label}</span>`;
    button.addEventListener("click", () =>
      switchTab(/** @type {keyof typeof VIEWS} */ (item.key)),
    );
    bottomNavEl.append(button);
  }

  // Traps the hardware/browser back action so it always returns to Home
  // instead of leaving the app (or doing nothing) — except when already at
  // the Home root, where letting the real back action through matches the
  // normal "back exits the app" expectation at the top of a navigation stack.
  history.pushState({ caffeGuard: true }, "", location.href);
  window.addEventListener("popstate", () => {
    const atHomeRoot =
      activeTabKey === "home" &&
      stack.length === 1 &&
      modalContainers.length === 0;
    if (atHomeRoot) return;

    switchTab("home");
    history.pushState({ caffeGuard: true }, "", location.href);
  });

  switchTab("home");
}

main();
