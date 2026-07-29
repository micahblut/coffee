import { db, newId } from "../db/db.js";

/**
 * @param {HTMLElement} container
 */
export async function renderRoasters(container) {
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
      <button type="submit">Add roaster</button>
    </form>
    <ul id="roaster-list"></ul>
  `;

  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#roaster-form")
  );
  const list = /** @type {HTMLUListElement} */ (
    container.querySelector("#roaster-list")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const website = String(data.get("website") ?? "").trim();
    if (!name) return;

    await db.roasters.add({
      id: newId(),
      name,
      website: website || undefined,
    });

    form.reset();
    await renderList();
  });

  list.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const roasterId = target.dataset.deleteId;
    if (!roasterId) return;

    if (!confirm("Delete this roaster?")) return;
    await db.roasters.delete(roasterId);
    await renderList();
  });

  async function renderList() {
    const roasters = await db.roasters.orderBy("name").toArray();
    list.innerHTML = "";

    for (const roaster of roasters) {
      const item = document.createElement("li");

      const name = document.createElement("strong");
      name.textContent = roaster.name;
      item.append(name);

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
