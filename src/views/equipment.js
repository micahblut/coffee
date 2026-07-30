import { renderGrinders } from "./grinders.js";
import { renderBrewers } from "./brewers.js";

/**
 * Landing screen for the bottom nav's "Equipment" tab — links out to the
 * existing Grinders and Brewers sections rather than duplicating them.
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 */
export async function renderEquipmentHome(container, nav) {
  container.innerHTML = `
    <h1>Equipment</h1>
    <div class="equipment-links">
      <button type="button" id="equipment-grinders" class="equipment-link">Grinders</button>
      <button type="button" id="equipment-brewers" class="equipment-link">Brewers</button>
    </div>
  `;

  const grindersButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#equipment-grinders")
  );
  grindersButton.addEventListener("click", () => {
    nav.navigate((c) => renderGrinders(c, nav));
  });

  const brewersButton = /** @type {HTMLButtonElement} */ (
    container.querySelector("#equipment-brewers")
  );
  brewersButton.addEventListener("click", () => {
    nav.navigate((c) => renderBrewers(c, nav));
  });
}
