import { db, getBrewDatesInMonth, getRecentBrews } from "../db/db.js";
import {
  renderBrewSheet,
  renderBrewsForDate,
  formatBrewCardMeta,
} from "./brews.js";
import { brewerTypeIcon } from "./brewers.js";
import { signInWithPasskey } from "./cloud-setup.js";
import {
  shouldPromptReauth,
  dismissReauthPrompt,
  subscribeToSessionState,
} from "../sync/session.js";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const RECENT_BREWS_LIMIT = 5;

export const CHEVRON_LEFT = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
export const CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
const INFO_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16"></line><line x1="12" y1="8" x2="12" y2="8"></line></svg>`;

/**
 * @param {import("../models/types.js").Brew} brew
 * @param {Map<string, import("../models/types.js").Bag>} bagsById
 * @returns {string}
 */
function formatCoffeeName(brew, bagsById) {
  return bagsById.get(brew.bagId)?.name ?? "Unknown coffee";
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderHome(container, nav) {
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth();

  container.innerHTML = `
    <section class="calendar-card" id="calendar"></section>
    <div class="brew-button-frame home-brew-button-frame">
      <button type="button" id="brew-button" class="brew-button">Brew</button>
    </div>
    <div id="reauth-callout-root"></div>
    <section class="recent-brews">
      <h2>Recent brews</h2>
      <ul id="recent-brews-list" class="recent-brews-list"></ul>
    </section>
  `;

  const brewButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#brew-button")
  );
  brewButton.addEventListener("click", () => {
    nav.showModal((sheet) =>
      renderBrewSheet(sheet, nav, {
        onSaved: async () => {
          nav.hideModal();
          await Promise.all([renderMonth(), renderRecentBrews()]);
        },
      }),
    );
  });

  const reauthRoot = /** @type {HTMLElement} */ (
    container.querySelector("#reauth-callout-root")
  );

  function renderReauthCallout() {
    if (!shouldPromptReauth()) {
      reauthRoot.innerHTML = "";
      return;
    }

    reauthRoot.innerHTML = `
      <section class="reauth-callout">
        <div class="reauth-callout-header">
          <span class="reauth-callout-icon">${INFO_ICON}</span>
          <h3>Session expired</h3>
          <button type="button" id="reauth-dismiss" class="reauth-dismiss" aria-label="Dismiss">&times;</button>
        </div>
        <p>
          <button type="button" id="reauth-signin-button" class="reauth-signin-link">Sign in</button>
          again to sync your data to the cloud
        </p>
        <p id="reauth-status"></p>
      </section>
    `;

    const status = /** @type {HTMLElement} */ (
      reauthRoot.querySelector("#reauth-status")
    );
    const signInButton = /** @type {HTMLButtonElement} */ (
      reauthRoot.querySelector("#reauth-signin-button")
    );
    signInButton.addEventListener("click", async () => {
      status.textContent = "Signing in...";
      try {
        await signInWithPasskey();
        reauthRoot.innerHTML = "";
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "Sign-in failed.";
      }
    });

    const dismissButton = /** @type {HTMLButtonElement} */ (
      reauthRoot.querySelector("#reauth-dismiss")
    );
    dismissButton.addEventListener("click", () => {
      dismissReauthPrompt();
      reauthRoot.innerHTML = "";
    });
  }

  renderReauthCallout();

  // Session state resolves asynchronously after boot (refreshSessionState
  // isn't awaited, so the app can render offline-first) — this catches the
  // callout up once that check lands, without requiring a tab switch.
  const unsubscribeSession = subscribeToSessionState(() => {
    if (!reauthRoot.isConnected) {
      unsubscribeSession();
      return;
    }
    renderReauthCallout();
  });

  const calendar = /** @type {HTMLElement} */ (
    container.querySelector("#calendar")
  );

  async function renderMonth() {
    const brewDates = await getBrewDatesInMonth(year, month);
    const firstOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = firstOfMonth.getDay();
    const monthLabel = firstOfMonth.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const isCurrentMonth =
      year === today.getFullYear() && month === today.getMonth();

    calendar.innerHTML = `
      <div class="calendar-panel">
        <div id="calendar-header">
          <button type="button" id="calendar-prev" class="calendar-nav-button" aria-label="Previous month">${CHEVRON_LEFT}</button>
          <span id="calendar-month-label"></span>
          <button type="button" id="calendar-next" class="calendar-nav-button" aria-label="Next month">${CHEVRON_RIGHT}</button>
        </div>
        <div id="calendar-grid"></div>
      </div>
    `;

    const monthLabelEl = /** @type {HTMLElement} */ (
      calendar.querySelector("#calendar-month-label")
    );
    monthLabelEl.textContent = monthLabel;

    const grid = /** @type {HTMLElement} */ (
      calendar.querySelector("#calendar-grid")
    );

    for (const label of WEEKDAY_LABELS) {
      const cell = document.createElement("div");
      cell.className = "calendar-weekday";
      cell.textContent = label;
      grid.append(cell);
    }

    for (let i = 0; i < startWeekday; i++) {
      grid.append(document.createElement("div"));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      cell.className = "calendar-day";
      cell.textContent = String(day);
      cell.dataset.day = String(day);
      if (brewDates.has(day)) cell.classList.add("has-brew");
      if (isCurrentMonth && day === today.getDate()) {
        cell.classList.add("is-today");
      }
      grid.append(cell);
    }

    grid.addEventListener("click", (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      const day = target.dataset.day;
      if (!day) return;
      nav.navigate((c) =>
        renderBrewsForDate(c, nav, new Date(year, month, Number(day))),
      );
    });

    const prevButton = /** @type {HTMLButtonElement} */ (
      calendar.querySelector("#calendar-prev")
    );
    prevButton.addEventListener("click", () => {
      month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
      renderMonth();
    });

    const nextButton = /** @type {HTMLButtonElement} */ (
      calendar.querySelector("#calendar-next")
    );
    nextButton.addEventListener("click", () => {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      renderMonth();
    });
  }

  const recentBrewsList = /** @type {HTMLUListElement} */ (
    container.querySelector("#recent-brews-list")
  );

  async function renderRecentBrews() {
    const [brews, bags, brewers] = await Promise.all([
      getRecentBrews(RECENT_BREWS_LIMIT),
      db.bags.toArray(),
      db.brewers.toArray(),
    ]);
    const bagsById = new Map(bags.map((bag) => [bag.id, bag]));
    const brewersById = new Map(brewers.map((brewer) => [brewer.id, brewer]));

    recentBrewsList.innerHTML = "";

    if (brews.length === 0) {
      const empty = document.createElement("li");
      empty.className = "recent-brews-empty";
      empty.textContent = "No brews logged yet — tap Brew to log your first cup.";
      recentBrewsList.append(empty);
      return;
    }

    for (const brew of brews) {
      const item = document.createElement("li");
      item.className = "recent-brew";
      item.dataset.brewId = brew.id;

      const main = document.createElement("div");
      main.className = "recent-brew-main";

      const stars = document.createElement("span");
      stars.className = "recent-brew-stars";
      stars.textContent = "★".repeat(brew.rating) + "☆".repeat(5 - brew.rating);
      main.append(stars);

      const name = document.createElement("span");
      name.className = "recent-brew-name";
      name.textContent = formatCoffeeName(brew, bagsById);
      main.append(name);

      const date = document.createElement("span");
      date.className = "recent-brew-date";
      date.textContent = brew.brewDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      main.append(date);

      item.append(main);

      const meta = document.createElement("p");
      meta.className = "recent-brew-meta";

      const brewer = brewersById.get(brew.brewerId);
      if (brewer) {
        const typeIcon = document.createElement("span");
        typeIcon.className = "recent-brew-type-icon";
        typeIcon.innerHTML = brewerTypeIcon(brewer.type);
        meta.append(typeIcon);
      }

      const metaText = document.createElement("span");
      metaText.textContent = formatBrewCardMeta(brew);
      meta.append(metaText);

      item.append(meta);

      if (brew.notes) {
        const notes = document.createElement("p");
        notes.className = "recent-brew-notes";
        notes.textContent = brew.notes;
        item.append(notes);
      }

      recentBrewsList.append(item);
    }
  }

  recentBrewsList.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const item = target.closest("[data-brew-id]");
    const brewId = /** @type {HTMLElement | null} */ (item)?.dataset.brewId;
    if (!brewId) return;
    nav.showModal((sheet) =>
      renderBrewSheet(sheet, nav, {
        brewId,
        onSaved: async () => {
          nav.hideModal();
          await Promise.all([renderMonth(), renderRecentBrews()]);
        },
        onDeleted: async () => {
          nav.hideModal();
          await Promise.all([renderMonth(), renderRecentBrews()]);
        },
      }),
    );
  });

  await Promise.all([renderMonth(), renderRecentBrews()]);
}
