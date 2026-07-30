import { db, getBrewDatesInMonth, getRecentBrews } from "../db/db.js";
import { renderBrewForm, renderBrewsForDate } from "./brews.js";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const RECENT_BREWS_LIMIT = 10;

const CHEVRON_LEFT = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
const CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

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
    <div class="brew-button-frame">
      <button type="button" id="brew-button" class="brew-button">Brew</button>
    </div>
    <section class="recent-brews">
      <h2>Recent brews</h2>
      <ul id="recent-brews-list" class="recent-brews-list"></ul>
    </section>
  `;

  const brewButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#brew-button")
  );
  brewButton.addEventListener("click", () => {
    nav.navigate((c) => renderBrewForm(c, nav));
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
    const [brews, bags] = await Promise.all([
      getRecentBrews(RECENT_BREWS_LIMIT),
      db.bags.toArray(),
    ]);
    const bagsById = new Map(bags.map((bag) => [bag.id, bag]));

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
    nav.navigate((c) => renderBrewForm(c, nav, { brewId }));
  });

  await Promise.all([renderMonth(), renderRecentBrews()]);
}
