import { db, newId, getBagsForRoaster, countBagsForRoaster } from "../db/db.js";
import { renderBagDetail, formatBagDetails } from "./bags.js";

const PAGE_SIZE = 10;

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Navigate} navigate
 */
export async function renderRoasters(container, navigate) {
  container.innerHTML = `
    <h1>Roasters</h1>
    <form id="roaster-form">
      <div>
        <label for="roaster-name">Name</label>
        <input id="roaster-name" name="name" type="text" required />
      </div>
      <div>
        <label for="roaster-website">Website</label>
        <input id="roaster-website" name="website" type="url" placeholder="https://" />
      </div>
      <button type="submit" id="roaster-submit">Add roaster</button>
      <button type="button" id="roaster-cancel" hidden>Cancel</button>
    </form>
    <ul id="roaster-list"></ul>
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
  const submitButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#roaster-submit")
  );
  const cancelButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#roaster-cancel")
  );
  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#roaster-list")
  );

  /** @type {string | null} */
  let editingId = null;

  function resetToCreateMode() {
    editingId = null;
    form.reset();
    submitButton.textContent = "Add roaster";
    cancelButton.hidden = true;
  }

  cancelButton.addEventListener("click", resetToCreateMode);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const website = String(data.get("website") ?? "").trim();
    if (!name) return;

    if (editingId) {
      await db.roasters.update(editingId, { name, website: website || undefined });
    } else {
      await db.roasters.add({ id: newId(), name, website: website || undefined });
    }

    resetToCreateMode();
    await renderList();
  });

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    if (target.dataset.viewId) {
      const roaster = await db.roasters.get(target.dataset.viewId);
      if (!roaster) return;
      await navigate((c) => renderRoasterDetail(c, navigate, roaster.id));
      return;
    }

    if (target.dataset.editId) {
      const roaster = await db.roasters.get(target.dataset.editId);
      if (!roaster) return;

      editingId = roaster.id;
      nameInput.value = roaster.name;
      websiteInput.value = roaster.website ?? "";
      submitButton.textContent = "Save roaster";
      cancelButton.hidden = false;
      return;
    }

    const roasterId = target.dataset.deleteId;
    if (!roasterId) return;

    if (!confirm("Delete this roaster?")) return;
    await db.roasters.delete(roasterId);
    if (editingId === roasterId) resetToCreateMode();
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
 * @param {import("../main.js").Navigate} navigate
 * @param {string} roasterId
 */
export async function renderRoasterDetail(container, navigate, roasterId) {
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
        navigate((c) => renderBagDetail(c, navigate, bag.id));
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
