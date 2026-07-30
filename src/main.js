import { db } from "./db/db.js";
import { renderHome, CHEVRON_LEFT } from "./views/home.js";
import { renderSettings } from "./views/settings.js";
import { renderEquipmentHome } from "./views/equipment.js";
import { renderCoffeeHome } from "./views/coffee.js";

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

// Keyed by bottom-nav tab (Home is also reachable via the app header).
// Roasters, bags, grinders, and brewers are managed entirely through the
// Coffee/Equipment tabs and their own detail pages now, so they no longer
// need root-level views of their own.
const VIEWS = {
  home: renderHome,
  settings: renderSettings,
  equipment: renderEquipmentHome,
  coffee: renderCoffeeHome,
};

const BOTTOM_NAV_ITEMS = /** @type {const} */ ([
  {
    key: "home",
    label: "Home",
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7"></path><path d="M4 10v10a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V10"></path></svg>`,
  },
  {
    key: "coffee",
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
      <div id="back-bar"></div>
      <div id="content"></div>
      <div id="modal-root"></div>
    </div>
    <nav id="bottom-nav"></nav>
  `;
  const appHeader = /** @type {HTMLButtonElement} */ (
    app.querySelector("#app-header")
  );
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

  const SHEET_DRAG_DISMISS_THRESHOLD = 80;

  /**
   * Animates a sheet+backdrop pair closed and removes it once the closing
   * transition finishes. Used both by the drag gesture below (which sets
   * its own inline transform mid-drag, so the transition has to be driven
   * explicitly rather than via the "open" class) and effectively mirrored
   * by hideModal for the button-triggered path.
   * @param {HTMLElement} backdrop
   * @param {HTMLElement} sheet
   */
  function dismissSheet(backdrop, sheet) {
    const index = modalContainers.indexOf(backdrop);
    if (index !== -1) modalContainers.splice(index, 1);
    backdrop.classList.remove("open");
    sheet.style.transition = "transform 0.25s ease";
    sheet.style.transform = "translateY(100%)";
    backdrop.addEventListener("transitionend", () => backdrop.remove(), {
      once: true,
    });
  }

  /**
   * Lets the user drag the sheet's handle down to dismiss it, matching the
   * native bottom-sheet gesture — drag past the threshold and it closes
   * like a Close/Cancel tap would; drag less than that and it snaps back.
   * @param {HTMLElement} backdrop
   * @param {HTMLElement} sheet
   * @param {HTMLElement} handle
   */
  function setupSheetDrag(backdrop, sheet, handle) {
    let dragging = false;
    let startY = 0;

    handle.addEventListener("pointerdown", (event) => {
      dragging = true;
      startY = event.clientY;
      sheet.style.transition = "none";
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const deltaY = Math.max(0, event.clientY - startY);
      sheet.style.transform = `translateY(${deltaY}px)`;
    });

    function endDrag(/** @type {PointerEvent} */ event) {
      if (!dragging) return;
      dragging = false;
      const deltaY = Math.max(0, event.clientY - startY);

      if (deltaY > SHEET_DRAG_DISMISS_THRESHOLD) {
        dismissSheet(backdrop, sheet);
        return;
      }

      sheet.style.transition = "transform 0.25s ease";
      sheet.style.transform = "translateY(0)";
      sheet.addEventListener(
        "transitionend",
        () => {
          // Hand control back to the CSS classes now that the sheet has
          // settled at the same position they'd put it at anyway.
          sheet.style.transition = "";
          sheet.style.transform = "";
        },
        { once: true },
      );
    }

    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  async function renderCurrent() {
    backBar.innerHTML = "";
    if (stack.length > 1) {
      // Floated left so it sits inline with whatever heading the view
      // renders as its first element, rather than stacking above it as its
      // own row.
      const backButton = document.createElement("button");
      backButton.type = "button";
      backButton.className = "back-button";
      backButton.setAttribute("aria-label", "Back");
      backButton.innerHTML = CHEVRON_LEFT;
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
    // Each modal level gets its own persistent backdrop+sheet pair, appended
    // (never replacing what's already there) so a form underneath is never
    // torn down or re-rendered — closing a modal (save or cancel) simply
    // reveals it exactly as the user left it, no state to reconstruct.
    async showModal(render) {
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      const sheet = document.createElement("div");
      sheet.className = "modal-sheet";
      const handle = document.createElement("div");
      handle.className = "sheet-handle";
      const sheetContent = document.createElement("div");
      sheetContent.className = "sheet-content";
      sheet.append(handle, sheetContent);
      backdrop.append(sheet);
      modalRoot.append(backdrop);
      modalContainers.push(backdrop);
      // Force a layout flush so the pre-transition (off-screen) state paints
      // before "open" is added — otherwise the browser can coalesce both
      // states into one frame and skip the slide-up transition entirely.
      void backdrop.offsetHeight;
      backdrop.classList.add("open");
      setupSheetDrag(backdrop, sheet, handle);
      await render(sheetContent);
    },
    hideModal() {
      const backdrop = modalContainers.pop();
      if (!backdrop) return;
      backdrop.classList.remove("open");
      backdrop.addEventListener("transitionend", () => backdrop.remove(), {
        once: true,
      });
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
    stack = [(container) => VIEWS[key](container, nav)];
    renderCurrent();
    for (const button of bottomNavEl.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.tabKey === key);
    }
  }

  appHeader.addEventListener("click", () => switchTab("home"));

  // Persistent bottom nav — the Coffee/Equipment/Settings tabs from the
  // home screen sketch.
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
