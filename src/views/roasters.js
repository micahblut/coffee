import {
  db,
  newId,
  countBagsForRoaster,
  getRoasterBagsRankedByRating,
} from "../db/db.js";
import { renderBagDetail, renderBagForm } from "./bags.js";
import { renderPager } from "./pagination.js";

// Matches the page size used for every list on the Coffee page.
const PAGE_SIZE = 5;

const PENCIL_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;

/**
 * @param {number} rating
 * @returns {string}
 */
function formatRatingStars(rating) {
  const rounded = Math.round(rating);
  return `${"★".repeat(rounded)}${"☆".repeat(5 - rounded)} ${rating.toFixed(1)}`;
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {{
 *   roasterId?: string,
 *   isModal?: boolean,
 *   onSaved?: (roaster: import("../models/types.js").Roaster) => void | Promise<void>,
 * }} [options]
 */
export async function renderRoasterForm(container, nav, options = {}) {
  const { roasterId, isModal, onSaved } = options;
  const existing = roasterId ? await db.roasters.get(roasterId) : undefined;

  // Editing an existing roaster from a sheet (the Coffee page's tap-to-edit
  // flow) skips the Cancel button in favor of the sheet's drag-to-dismiss
  // gesture — deleting a roaster now lives on the Roaster View page itself
  // instead.
  const isEditSheet = isModal && roasterId;

  container.innerHTML = `
    <h1>${roasterId ? "Edit roaster" : "Add roaster"}</h1>
    <form id="roaster-form">
      <div>
        <label for="roaster-name">Name</label>
        <input id="roaster-name" name="name" type="text" autocomplete="off" required />
      </div>
      <div>
        <label for="roaster-website">Website</label>
        <input id="roaster-website" name="website" type="url" placeholder="https://" autocomplete="off" />
      </div>
      ${
        isEditSheet
          ? `
        <div class="sheet-actions">
          <button type="submit" class="brew-button">Save roaster</button>
        </div>
      `
          : `
        <button type="submit">${roasterId ? "Save roaster" : "Add roaster"}</button>
        <button type="button" id="roaster-form-cancel">Cancel</button>
      `
      }
    </form>
  `;

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#roaster-form")
  );
  const nameInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#roaster-name")
  );
  const websiteInput = /** @type {HTMLInputElement} */ (
    container.querySelector("#roaster-website")
  );
  nameInput.value = existing?.name ?? "";
  websiteInput.value = existing?.website ?? "";

  const cancelButton = /** @type {HTMLButtonElement | null} */ (
    container.querySelector("#roaster-form-cancel")
  );
  cancelButton?.addEventListener("click", () => {
    if (isModal) nav.hideModal();
    else nav.goBack();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const website = String(data.get("website") ?? "").trim();
    if (!name) return;

    const fields = { name, website: website || undefined };

    /** @type {import("../models/types.js").Roaster} */
    let saved;
    if (roasterId) {
      await db.roasters.update(roasterId, fields);
      saved = { id: roasterId, ...fields };
    } else {
      saved = { id: newId(), ...fields };
      await db.roasters.add(saved);
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
 * The Roaster View — mirrors the Bag View: an embossed card with the
 * roaster's own details, a paginated "Favorite bags" list (the roaster's
 * full set of bags ranked by average brew rating, mirroring the Coffee
 * page's Favorite Roasters ranking so an unrated bag still shows up rather than
 * being invisible), and a standalone Delete button at the bottom. Reached by
 * pushing a real page via nav.navigate rather than a sheet, same rationale
 * as the Bag View.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {string} roasterId
 */
export async function renderRoasterDetail(container, nav, roasterId) {
  const [roaster, totalBags] = await Promise.all([
    db.roasters.get(roasterId),
    countBagsForRoaster(roasterId),
  ]);
  if (!roaster) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = "Roaster not found.";
    container.append(message);
    return;
  }

  const hasBags = totalBags > 0;
  const isLink = roaster.website && /^https?:\/\//i.test(roaster.website);

  container.innerHTML = `
    <h1>${roaster.name}</h1>
    <section class="detail-card">
      <div class="detail-panel">
        <div class="detail-header">
          <div>
            <p class="detail-name">${roaster.name}</p>
            ${
              roaster.website
                ? isLink
                  ? `<a href="${roaster.website}" target="_blank" rel="noopener noreferrer" class="coffee-item-link">${roaster.website}</a>`
                  : `<p class="coffee-item-link">${roaster.website}</p>`
                : ""
            }
          </div>
          <button type="button" id="roaster-detail-edit" class="detail-edit-button" aria-label="Edit roaster">${PENCIL_ICON}</button>
        </div>
      </div>
    </section>
    ${
      hasBags
        ? `
    <section class="coffee-section">
      <h2>Favorite bags</h2>
      <ul id="roaster-detail-bags-list" class="coffee-list"></ul>
      <div id="roaster-detail-bags-pagination"></div>
    </section>
    `
        : `
    <div class="brew-button-frame">
      <button type="button" id="roaster-detail-add-bag" class="brew-button">Add bag</button>
    </div>
    `
    }
    <button type="button" id="roaster-detail-delete" class="detail-delete-button">Delete roaster</button>
  `;

  const editButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#roaster-detail-edit")
  );
  editButton.addEventListener("click", () => {
    nav.showModal((sheet) =>
      renderRoasterForm(sheet, nav, {
        roasterId,
        isModal: true,
        onSaved: async () => {
          nav.hideModal();
          await renderRoasterDetail(container, nav, roasterId);
        },
      }),
    );
  });

  const deleteButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#roaster-detail-delete")
  );
  deleteButton.addEventListener("click", async () => {
    if (!(await nav.confirm("Delete this roaster?", { confirmLabel: "Delete" })))
      return;
    await db.roasters.delete(roasterId);
    await nav.goBack();
  });

  if (!hasBags) {
    const addBagButton = /** @type {HTMLButtonElement} */ (
      container.querySelector("#roaster-detail-add-bag")
    );
    addBagButton.addEventListener("click", () => {
      nav.showModal((sheet) =>
        renderBagForm(sheet, nav, {
          isModal: true,
          onSaved: async () => {
            nav.hideModal();
            await renderRoasterDetail(container, nav, roasterId);
          },
        }),
      );
    });
    return;
  }

  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#roaster-detail-bags-list")
  );
  const pagination = /** @type {HTMLElement} */ (
    container.querySelector("#roaster-detail-bags-pagination")
  );

  let offset = 0;

  async function renderBags() {
    const [entries, total] = await Promise.all([
      getRoasterBagsRankedByRating(roasterId, { offset, limit: PAGE_SIZE }),
      countBagsForRoaster(roasterId),
    ]);

    list.innerHTML = "";

    for (const { bag, averageRating } of entries) {
      const item = document.createElement("li");
      item.className = "coffee-item";
      item.dataset.bagId = bag.id;

      const main = document.createElement("div");
      main.className = "coffee-item-main";

      const stars = document.createElement("span");
      stars.className = "coffee-item-stars";
      stars.textContent = formatRatingStars(averageRating);
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
      list.append(item);
    }

    renderPager(pagination, {
      offset,
      total,
      pageSize: PAGE_SIZE,
      onChange: (newOffset) => {
        offset = newOffset;
        renderBags();
      },
    });
  }

  list.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest("[data-bag-id]");
    const bagId = /** @type {HTMLElement | null} */ (item)?.dataset.bagId;
    if (!bagId) return;
    nav.navigate((c) => renderBagDetail(c, nav, bagId));
  });

  await renderBags();
}
