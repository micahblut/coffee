import {
  db,
  newId,
  getBrewsForBag,
  countBrewsForBag,
  getBrewRatingsByDaysSinceRoast,
} from "../db/db.js";
import {
  parseDateInputValue,
  dateToInputValue,
  todayDateInputValue,
} from "../utils/dates.js";
import { renderRoasterForm } from "./roasters.js";
import { renderBrewSheet } from "./brews.js";
import { renderPager } from "./pagination.js";

const BAG_TYPES = ["Espresso", "Filter"];
const ROAST_PROCESSES = ["Washed", "Natural", "Honey", "Anaerobic", "Other"];
// Matches the page size used for every list on the Coffee page.
const PAGE_SIZE = 5;

const PENCIL_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;

/**
 * @param {number} rating
 * @returns {string}
 */
function formatAverageRatingStars(rating) {
  const rounded = Math.round(rating);
  return `${"★".repeat(rounded)}${"☆".repeat(5 - rounded)} ${rating.toFixed(1)}`;
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 170;
const CHART_MARGIN = { top: 14, right: 12, bottom: 36, left: 20 };

/**
 * Picks a "nice" tick step (1/2/5 × a power of ten) for an axis spanning
 * `min`..`max`, aiming for roughly `targetCount` ticks — the same rounding
 * rationale most charting libraries use for axis ticks, hand-rolled here to
 * avoid pulling one in. Ticks are clamped to non-negative days, since a
 * negative "days since roast" tick would only ever be the chart's own
 * lead-in padding, not a real data point.
 * @param {number} min
 * @param {number} max
 * @param {number} [targetCount]
 * @returns {number[]}
 */
function niceDayTicks(min, max, targetCount = 4) {
  const range = Math.max(1, max - min);
  const rawStep = range / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const niceFactor = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1;
  const step = Math.max(1, Math.round(niceFactor * magnitude));

  const ticks = [];
  for (
    let t = Math.ceil(Math.max(0, min) / step) * step;
    t <= max;
    t += step
  ) {
    ticks.push(t);
  }
  return ticks;
}

/**
 * A hand-rolled SVG scatter plot (no charting library, to keep the app's
 * dependency footprint at zero) of a bag's brews — rating on the y axis,
 * days since roast on the x axis. Deliberately not averaged or fitted with a
 * trend line: a bag's first brew or two are often still-dialing-in test
 * shots, and smoothing them away would hide that from the chart.
 * @param {{ daysSinceRoast: number, rating: number }[]} points
 * @returns {string}
 */
function renderFreshnessChartSvg(points) {
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const axisY = CHART_HEIGHT - CHART_MARGIN.bottom;

  const daysValues = points.map((p) => p.daysSinceRoast);
  const firstBrewDays = Math.min(...daysValues);
  const lastBrewDays = Math.max(...daysValues);
  // Starts a day before the first brew (rather than at 0) so a bag that sat
  // for a while before its first brew doesn't leave a big empty stretch of
  // axis before any data appears.
  const xMin = firstBrewDays - 1;
  const xMax = Math.max(lastBrewDays, xMin + 1);
  const xRange = xMax - xMin;

  /** @param {number} rating */
  const yFor = (rating) =>
    CHART_MARGIN.top + plotHeight - ((rating - 1) / 4) * plotHeight;
  /** @param {number} days */
  const xFor = (days) =>
    CHART_MARGIN.left + ((days - xMin) / xRange) * plotWidth;

  const gridlines = [1, 2, 3, 4, 5]
    .map((rating) => {
      const y = yFor(rating);
      return `
        <line class="bag-detail-chart-grid" x1="${CHART_MARGIN.left}" y1="${y}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y2="${y}" />
        <text class="bag-detail-chart-tick" x="${CHART_MARGIN.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle">${rating}</text>
      `;
    })
    .join("");

  const xTicks = niceDayTicks(xMin, xMax)
    .map((day) => {
      const x = xFor(day);
      return `
        <line class="bag-detail-chart-tick-mark" x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 4}" />
        <text class="bag-detail-chart-tick" x="${x}" y="${axisY + 14}" text-anchor="middle">${day}</text>
      `;
    })
    .join("");

  const dots = points
    .map(
      (p) =>
        `<circle class="bag-detail-chart-dot" cx="${xFor(p.daysSinceRoast)}" cy="${yFor(p.rating)}" r="3.5" />`,
    )
    .join("");

  return `
    <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" class="bag-detail-chart-svg" role="img" aria-label="Star rating by days since roasting">
      ${gridlines}
      <line class="bag-detail-chart-axis" x1="${CHART_MARGIN.left}" y1="${CHART_MARGIN.top}" x2="${CHART_MARGIN.left}" y2="${axisY}" />
      <line class="bag-detail-chart-axis" x1="${CHART_MARGIN.left}" y1="${axisY}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y2="${axisY}" />
      ${xTicks}
      ${dots}
      <text class="bag-detail-chart-axis-label" x="${CHART_MARGIN.left + plotWidth / 2}" y="${CHART_HEIGHT - 4}">Days since roasting</text>
    </svg>
  `;
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {{
 *   bagId?: string,
 *   isModal?: boolean,
 *   onSaved?: (bag: import("../models/types.js").Bag) => void | Promise<void>,
 * }} [options]
 */
export async function renderBagForm(container, nav, options = {}) {
  const { bagId, isModal, onSaved } = options;
  const [roasters, existing] = await Promise.all([
    db.roasters.orderBy("name").toArray(),
    bagId ? db.bags.get(bagId) : undefined,
  ]);

  // Editing an existing bag from a sheet (the Coffee page's tap-to-edit
  // flow) skips the Cancel button in favor of the sheet's drag-to-dismiss
  // gesture — deleting a bag now lives on the Bag View page itself instead.
  const isEditSheet = isModal && bagId;

  container.innerHTML = `
    <h1>${bagId ? "Edit bag" : "Add bag"}</h1>
    <form id="bag-form">
      <div>
        <label for="bag-name">Name</label>
        <input id="bag-name" name="name" type="text" placeholder="e.g. Sunrise Espresso Blend" autocomplete="off" required />
      </div>
      <div>
        <label for="bag-roaster">Roaster</label>
        <select id="bag-roaster" name="roasterId" required></select>
        <button type="button" id="add-roaster-inline">+ Add new roaster</button>
      </div>
      <div>
        <label for="bag-roast-date">Roast date</label>
        <input id="bag-roast-date" name="roastDate" type="date" max="${todayDateInputValue()}" autocomplete="off" required />
      </div>
      <div>
        <label for="bag-type">Type</label>
        <select id="bag-type" name="type" required>
          ${BAG_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="bag-origin">Origin</label>
        <input id="bag-origin" name="origin" type="text" placeholder="e.g. Ethiopia, Yirgacheffe" autocomplete="off" />
      </div>
      <div>
        <label for="bag-process">Process</label>
        <select id="bag-process" name="process">
          <option value="">—</option>
          ${ROAST_PROCESSES.map((process) => `<option value="${process}">${process}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="bag-weight">Weight (g)</label>
        <input id="bag-weight" name="weightGrams" type="number" min="0" autocomplete="off" />
      </div>
      ${
        isEditSheet
          ? `
        <div class="sheet-actions">
          <button type="submit" class="brew-button">Save bag</button>
        </div>
      `
          : `
        <button type="submit">${bagId ? "Save bag" : "Add bag"}</button>
        <button type="button" id="bag-form-cancel">Cancel</button>
      `
      }
    </form>
  `;

  const roasterSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#bag-roaster")
  );
  for (const roaster of roasters) {
    const option = document.createElement("option");
    option.value = roaster.id;
    option.textContent = roaster.name;
    roasterSelect.append(option);
  }

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#bag-form")
  );
  const nameInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#bag-name")
  );
  const roastDateInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#bag-roast-date")
  );
  const typeSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#bag-type")
  );
  const originInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#bag-origin")
  );
  const processSelect = /** @type {HTMLSelectElement} */ (
    container.querySelector("#bag-process")
  );
  const weightInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#bag-weight")
  );

  nameInput.value = existing?.name ?? "";
  if (existing) roasterSelect.value = existing.roasterId;
  roastDateInput.value = existing ? dateToInputValue(existing.roastDate) : "";
  if (existing) typeSelect.value = existing.type;
  originInput.value = existing?.origin ?? "";
  if (existing?.process) processSelect.value = existing.process;
  weightInput.value =
    existing?.weightGrams != null ? String(existing.weightGrams) : "";

  const cancelButton = /** @type {HTMLButtonElement | null} */ (
    container.querySelector("#bag-form-cancel")
  );
  cancelButton?.addEventListener("click", () => {
    if (isModal) nav.hideModal();
    else nav.goBack();
  });

  const addRoasterButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-roaster-inline")
  );
  addRoasterButton.addEventListener("click", () => {
    nav.showModal((modalContainer) =>
      renderRoasterForm(modalContainer, nav, {
        isModal: true,
        onSaved: (roaster) => {
          const option = document.createElement("option");
          option.value = roaster.id;
          option.textContent = roaster.name;
          roasterSelect.append(option);
          roasterSelect.value = roaster.id;
          nav.hideModal();
        },
      }),
    );
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const roasterId = String(data.get("roasterId") ?? "");
    const roastDate = String(data.get("roastDate") ?? "");
    const type = String(data.get("type") ?? "");
    const origin = String(data.get("origin") ?? "").trim();
    const process = String(data.get("process") ?? "").trim();
    const weightGrams = String(data.get("weightGrams") ?? "").trim();
    if (!name || !roasterId || !roastDate || !type) return;
    if (roastDate > todayDateInputValue()) return;

    const fields = {
      name,
      roasterId,
      roastDate: parseDateInputValue(roastDate),
      type: /** @type {import("../models/types.js").BagType} */ (type),
      origin: origin || undefined,
      process: /** @type {import("../models/types.js").RoastProcess | undefined} */ (
        process || undefined
      ),
      weightGrams: weightGrams ? Number(weightGrams) : undefined,
    };

    /** @type {import("../models/types.js").Bag} */
    let saved;
    if (bagId) {
      await db.bags.update(bagId, fields);
      saved = { id: bagId, createdAt: existing?.createdAt ?? new Date(), ...fields };
    } else {
      saved = { id: newId(), createdAt: new Date(), ...fields };
      await db.bags.add(saved);
    }

    if (onSaved) {
      await onSaved(saved);
    } else if (isModal) {
      nav.hideModal();
    } else {
      await nav.goBack();
    }
  });
}

/**
 * The Bag View — a bag's own details (embossed card, matching the home
 * screen calendar), a freshness scatter chart, and its brew history
 * (styled like the home screen's Recent Brews, paginated the same way the
 * Coffee page's lists are). Reached by pushing a real page via nav.navigate
 * rather than a sheet — a graph and a paginated list don't fit a sheet, and
 * this keeps a brew tapped from here from opening a second sheet on top of
 * one already open.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {string} bagId
 */
export async function renderBagDetail(container, nav, bagId) {
  const [bag, ratingPoints] = await Promise.all([
    db.bags.get(bagId),
    getBrewRatingsByDaysSinceRoast(bagId),
  ]);
  if (!bag) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = "Bag not found.";
    container.append(message);
    return;
  }

  const hasBrews = ratingPoints.length > 0;
  const averageRating = hasBrews
    ? ratingPoints.reduce((sum, p) => sum + p.rating, 0) / ratingPoints.length
    : null;
  const metaLine = [bag.origin, bag.process].filter(Boolean).join(" · ");

  container.innerHTML = `
    <h1>${bag.name}</h1>
    <section class="detail-card">
      <div class="detail-panel">
        <div class="detail-header">
          <div>
            <p class="detail-name">${bag.name}${bag.weightGrams ? ` — ${bag.weightGrams}g` : ""}</p>
            ${averageRating != null ? `<p class="bag-detail-stars">${formatAverageRatingStars(averageRating)}</p>` : ""}
            ${metaLine ? `<p class="bag-detail-meta">${metaLine}</p>` : ""}
          </div>
          <button type="button" id="bag-detail-edit" class="detail-edit-button" aria-label="Edit bag">${PENCIL_ICON}</button>
        </div>
      </div>
    </section>
    ${
      hasBrews
        ? `
    <section class="bag-detail-chart-card">
      <div class="bag-detail-chart-panel">
        <h3>Rating by freshness</h3>
        <div id="bag-detail-chart"></div>
      </div>
    </section>
    <section class="recent-brews">
      <h2>Brews</h2>
      <ul id="bag-detail-brews-list" class="recent-brews-list"></ul>
      <div id="bag-detail-brews-pagination"></div>
    </section>
    `
        : `
    <div class="brew-button-frame">
      <button type="button" id="bag-detail-brew-button" class="brew-button">Brew</button>
    </div>
    `
    }
    <button type="button" id="bag-detail-delete" class="detail-delete-button">Delete bag</button>
  `;

  const editButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#bag-detail-edit")
  );
  editButton.addEventListener("click", () => {
    nav.showModal((sheet) =>
      renderBagForm(sheet, nav, {
        bagId,
        isModal: true,
        onSaved: async () => {
          nav.hideModal();
          await renderBagDetail(container, nav, bagId);
        },
      }),
    );
  });

  const deleteButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#bag-detail-delete")
  );
  deleteButton.addEventListener("click", async () => {
    if (!(await nav.confirm("Delete this bag?", { confirmLabel: "Delete" })))
      return;
    await db.bags.delete(bagId);
    await nav.goBack();
  });

  if (!hasBrews) {
    const brewButton = /** @type {HTMLButtonElement} */ (
      container.querySelector("#bag-detail-brew-button")
    );
    brewButton.addEventListener("click", () => {
      nav.showModal((sheet) =>
        renderBrewSheet(sheet, nav, {
          prefillBagId: bagId,
          onSaved: async () => {
            nav.hideModal();
            await renderBagDetail(container, nav, bagId);
          },
        }),
      );
    });
    return;
  }

  const chart = /** @type {HTMLElement} */ (
    container.querySelector("#bag-detail-chart")
  );
  chart.innerHTML = renderFreshnessChartSvg(ratingPoints);

  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#bag-detail-brews-list")
  );
  const pagination = /** @type {HTMLElement} */ (
    container.querySelector("#bag-detail-brews-pagination")
  );

  let offset = 0;

  async function renderBrews() {
    const [brews, total] = await Promise.all([
      getBrewsForBag(bagId, { offset, limit: PAGE_SIZE }),
      countBrewsForBag(bagId),
    ]);

    list.innerHTML = "";

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
      meta.textContent = `Grind ${brew.grindSize} · ${brew.extractionTimeSeconds}s`;
      item.append(meta);

      if (brew.notes) {
        const notes = document.createElement("p");
        notes.className = "recent-brew-notes";
        notes.textContent = brew.notes;
        item.append(notes);
      }

      list.append(item);
    }

    renderPager(pagination, {
      offset,
      total,
      pageSize: PAGE_SIZE,
      onChange: (newOffset) => {
        offset = newOffset;
        renderBrews();
      },
    });
  }

  list.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest("[data-brew-id]");
    const brewId = /** @type {HTMLElement | null} */ (item)?.dataset.brewId;
    if (!brewId) return;
    nav.showModal((sheet) =>
      renderBrewSheet(sheet, nav, {
        brewId,
        onSaved: async () => {
          nav.hideModal();
          await renderBagDetail(container, nav, bagId);
        },
      }),
    );
  });

  await renderBrews();
}
