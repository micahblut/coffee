import { db, getBagsPageWithRatings, getRoastersRankedByRating } from "../db/db.js";
import { renderBagForm, renderBagDetail } from "./bags.js";
import { renderRoasterForm, renderRoasterDetail } from "./roasters.js";
import { renderPager } from "./pagination.js";

// Both lists here are the full catalog (all bags, all roasters) rather than
// a bounded preview — "Add bag"/"Add roaster" need to land somewhere
// visible, so these paginate the same way the legacy Bags/Roasters detail
// pages already do, rather than lazy-loading or showing everything at once.
const PAGE_SIZE = 5;

/**
 * @param {number} rating
 * @returns {string}
 */
function formatRatingStars(rating) {
  const rounded = Math.round(rating);
  return `${"★".repeat(rounded)}${"☆".repeat(5 - rounded)} ${rating.toFixed(1)}`;
}

/**
 * @param {number | null} averageRating
 * @returns {string}
 */
function formatBagStars(averageRating) {
  return averageRating == null ? "Not yet rated" : formatRatingStars(averageRating);
}

/**
 * The Coffee page — Recent Bags and Favorite Roasters, each the full catalog
 * (paginated), styled as a mat of cards like Recent Brews on the home
 * screen. Distinct from the home screen, which stays reachable via the app
 * header.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderCoffeeHome(container, nav) {
  container.innerHTML = `
    <h1>Coffee</h1>
    <section class="coffee-section">
      <h2>Recent bags</h2>
      <ul id="recent-bags-list" class="coffee-list"></ul>
      <div id="recent-bags-pagination"></div>
      <div class="brew-button-frame">
        <button type="button" id="add-bag-button" class="brew-button">Add bag</button>
      </div>
    </section>
    <section class="coffee-section">
      <h2>Favorite roasters</h2>
      <ul id="top-roasters-list" class="coffee-list"></ul>
      <div id="top-roasters-pagination"></div>
      <div class="brew-button-frame">
        <button type="button" id="add-roaster-button" class="brew-button">Add roaster</button>
      </div>
    </section>
  `;

  const recentBagsList = /** @type {HTMLUListElement} */ (
    container.querySelector("#recent-bags-list")
  );
  const recentBagsPagination = /** @type {HTMLElement} */ (
    container.querySelector("#recent-bags-pagination")
  );
  const topRoastersList = /** @type {HTMLUListElement} */ (
    container.querySelector("#top-roasters-list")
  );
  const topRoastersPagination = /** @type {HTMLElement} */ (
    container.querySelector("#top-roasters-pagination")
  );

  let bagsOffset = 0;
  let roastersOffset = 0;

  async function renderRecentBags() {
    const [entries, total] = await Promise.all([
      getBagsPageWithRatings({ offset: bagsOffset, limit: PAGE_SIZE }),
      db.bags.count(),
    ]);
    recentBagsList.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "coffee-empty";
      empty.textContent = "No bags yet — tap Add bag to log your first one.";
      recentBagsList.append(empty);
      recentBagsPagination.innerHTML = "";
      return;
    }

    for (const { bag, averageRating } of entries) {
      const item = document.createElement("li");
      item.className = "coffee-item";
      item.dataset.bagId = bag.id;

      const main = document.createElement("div");
      main.className = "coffee-item-main";

      const stars = document.createElement("span");
      stars.className = "coffee-item-stars";
      stars.textContent = formatBagStars(averageRating);
      main.append(stars);

      const name = document.createElement("span");
      name.className = "coffee-item-name";
      name.textContent = bag.name;
      main.append(name);

      const date = document.createElement("span");
      date.className = "coffee-item-date";
      date.textContent = bag.roastDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      main.append(date);

      item.append(main);
      recentBagsList.append(item);
    }

    renderPager(recentBagsPagination, {
      offset: bagsOffset,
      total,
      pageSize: PAGE_SIZE,
      onChange: (offset) => {
        bagsOffset = offset;
        renderRecentBags();
      },
    });
  }

  async function renderTopRoasters() {
    const [entries, total] = await Promise.all([
      getRoastersRankedByRating({ offset: roastersOffset, limit: PAGE_SIZE }),
      db.roasters.count(),
    ]);
    topRoastersList.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "coffee-empty";
      empty.textContent = "No roasters yet — tap Add roaster to log your first one.";
      topRoastersList.append(empty);
      topRoastersPagination.innerHTML = "";
      return;
    }

    for (const { roaster, averageRating } of entries) {
      const item = document.createElement("li");
      item.className = "coffee-item";
      item.dataset.roasterId = roaster.id;

      const main = document.createElement("div");
      main.className = "coffee-item-main";

      const stars = document.createElement("span");
      stars.className = "coffee-item-stars";
      stars.textContent = formatRatingStars(averageRating);
      main.append(stars);

      const name = document.createElement("span");
      name.className = "coffee-item-name";
      name.textContent = roaster.name;
      main.append(name);

      item.append(main);

      if (roaster.website) {
        const isLink = /^https?:\/\//i.test(roaster.website);
        const link = document.createElement(isLink ? "a" : "p");
        link.className = "coffee-item-link";
        link.textContent = roaster.website;
        if (link instanceof HTMLAnchorElement) {
          link.href = roaster.website;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        item.append(link);
      }

      topRoastersList.append(item);
    }

    renderPager(topRoastersPagination, {
      offset: roastersOffset,
      total,
      pageSize: PAGE_SIZE,
      onChange: (offset) => {
        roastersOffset = offset;
        renderTopRoasters();
      },
    });
  }

  const addBagButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-bag-button")
  );
  addBagButton.addEventListener("click", () => {
    nav.showModal((sheet) =>
      renderBagForm(sheet, nav, {
        isModal: true,
        onSaved: async () => {
          nav.hideModal();
          bagsOffset = 0;
          await renderRecentBags();
        },
      }),
    );
  });

  recentBagsList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest("[data-bag-id]");
    const bagId = /** @type {HTMLElement | null} */ (item)?.dataset.bagId;
    if (!bagId) return;

    // A bag's full detail (freshness chart, brew history) doesn't fit a
    // sheet, and editing/deleting lives behind its pencil icon now — so this
    // pushes a real page (with its own Back) instead of opening a modal.
    nav.navigate((c) => renderBagDetail(c, nav, bagId));
  });

  const addRoasterButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-roaster-button")
  );
  addRoasterButton.addEventListener("click", () => {
    nav.showModal((sheet) =>
      renderRoasterForm(sheet, nav, {
        isModal: true,
        onSaved: async () => {
          nav.hideModal();
          roastersOffset = 0;
          await renderTopRoasters();
        },
      }),
    );
  });

  topRoastersList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    // The website link opens the URL itself — it isn't the "open this
    // roaster" tap target, even though it lives inside the row.
    if (target.closest("a")) return;

    const item = target.closest("[data-roaster-id]");
    const roasterId = /** @type {HTMLElement | null} */ (item)?.dataset
      .roasterId;
    if (!roasterId) return;

    // A roaster's full detail (favorite bags) doesn't fit a sheet, and
    // editing/deleting lives behind its pencil icon now — so this pushes a
    // real page (with its own Back) instead of opening a modal.
    nav.navigate((c) => renderRoasterDetail(c, nav, roasterId));
  });

  await Promise.all([renderRecentBags(), renderTopRoasters()]);
}
