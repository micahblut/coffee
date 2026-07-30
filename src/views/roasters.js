import { db, newId, getBagsForRoaster, countBagsForRoaster } from "../db/db.js";
import { renderBagDetail, formatBagDetails } from "./bags.js";

const PAGE_SIZE = 10;

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
      <button type="submit">${roasterId ? "Save roaster" : "Add roaster"}</button>
      <button type="button" id="roaster-form-cancel">Cancel</button>
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

  const cancelButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#roaster-form-cancel")
  );
  cancelButton.addEventListener("click", () => {
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
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderRoastersList(container, nav) {
  container.innerHTML = `
    <h1>Roasters</h1>
    <button type="button" id="add-roaster">Add roaster</button>
    <ul id="roaster-list"></ul>
  `;

  const addButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#add-roaster")
  );
  addButton.addEventListener("click", () => {
    nav.navigate((c) => renderRoasterForm(c, nav));
  });

  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#roaster-list")
  );

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    const viewId = target.dataset.viewId;
    if (viewId) {
      await nav.navigate((c) => renderRoasterDetail(c, nav, viewId));
      return;
    }

    const editId = target.dataset.editId;
    if (editId) {
      await nav.navigate((c) => renderRoasterForm(c, nav, { roasterId: editId }));
      return;
    }

    const deleteId = target.dataset.deleteId;
    if (!deleteId) return;

    if (!(await nav.confirm("Delete this roaster?", { confirmLabel: "Delete" })))
      return;
    await db.roasters.delete(deleteId);
    await renderList();
  });

  async function renderList() {
    const roasters = await db.roasters.orderBy("name").toArray();
    list.innerHTML = "";

    for (const roaster of roasters) {
      const item = document.createElement("li");

      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.textContent = roaster.name;
      nameButton.dataset.viewId = roaster.id;
      item.append(nameButton);

      if (roaster.website && /^https?:\/\//i.test(roaster.website)) {
        item.append(" — ");
        const link = document.createElement("a");
        link.href = roaster.website;
        link.textContent = roaster.website;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        item.append(link);
      } else if (roaster.website) {
        item.append(` — ${roaster.website}`);
      }

      item.append(" — ");
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.dataset.editId = roaster.id;
      item.append(editButton);

      item.append(" ");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.dataset.deleteId = roaster.id;
      item.append(deleteButton);

      list.append(item);
    }
  }

  await renderList();
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {string} roasterId
 */
export async function renderRoasterDetail(container, nav, roasterId) {
  const roaster = await db.roasters.get(roasterId);
  if (!roaster) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = "Roaster not found.";
    container.append(message);
    return;
  }

  container.innerHTML = `
    <h1 id="roaster-detail-title"></h1>
    <p id="roaster-detail-website"></p>
    <h2>Bags</h2>
    <ul id="roaster-detail-bags"></ul>
    <div id="roaster-detail-pagination"></div>
  `;

  const title = /** @type {HTMLElement} */ (
    container.querySelector("#roaster-detail-title")
  );
  title.textContent = roaster.name;

  const websiteEl = /** @type {HTMLElement} */ (
    container.querySelector("#roaster-detail-website")
  );
  if (roaster.website && /^https?:\/\//i.test(roaster.website)) {
    const link = document.createElement("a");
    link.href = roaster.website;
    link.textContent = roaster.website;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    websiteEl.append(link);
  } else if (roaster.website) {
    websiteEl.textContent = roaster.website;
  }

  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#roaster-detail-bags")
  );
  const pagination = /** @type {HTMLElement} */ (
    container.querySelector("#roaster-detail-pagination")
  );

  let offset = 0;

  async function renderPage() {
    const [bags, total] = await Promise.all([
      getBagsForRoaster(roasterId, { offset, limit: PAGE_SIZE }),
      countBagsForRoaster(roasterId),
    ]);

    list.innerHTML = "";

    if (bags.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No bags from this roaster yet.";
      list.append(empty);
    }

    for (const bag of bags) {
      const item = document.createElement("li");

      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.textContent = bag.name;
      nameButton.addEventListener("click", () => {
        nav.navigate((c) => renderBagDetail(c, nav, bag.id));
      });
      item.append(nameButton);

      item.append(` — ${formatBagDetails(bag)}`);
      list.append(item);
    }

    pagination.innerHTML = "";
    if (total > PAGE_SIZE) {
      const prevButton = document.createElement("button");
      prevButton.type = "button";
      prevButton.textContent = "Previous";
      prevButton.disabled = offset === 0;
      prevButton.addEventListener("click", () => {
        offset = Math.max(0, offset - PAGE_SIZE);
        renderPage();
      });

      const status = document.createElement("span");
      status.textContent = ` ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total} `;

      const nextButton = document.createElement("button");
      nextButton.type = "button";
      nextButton.textContent = "Next";
      nextButton.disabled = offset + PAGE_SIZE >= total;
      nextButton.addEventListener("click", () => {
        offset += PAGE_SIZE;
        renderPage();
      });

      pagination.append(prevButton, status, nextButton);
    }
  }

  await renderPage();
}
