import { getBrewDatesInMonth } from "../db/db.js";
import { renderBrewForm, renderBrewsForDate } from "./brews.js";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderHome(container, nav) {
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth();

  container.innerHTML = `
    <h1>caffe</h1>
    <button type="button" id="brew-button">Brew</button>
    <div id="calendar"></div>
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
      <div id="calendar-header">
        <button type="button" id="calendar-prev">‹</button>
        <span id="calendar-month-label"></span>
        <button type="button" id="calendar-next">›</button>
      </div>
      <div id="calendar-grid"></div>
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

  await renderMonth();
}
