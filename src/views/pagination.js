import { CHEVRON_LEFT, CHEVRON_RIGHT } from "./home.js";

/**
 * Renders a Previous/Next pager into `container` — carets styled like the
 * calendar nav buttons, only shown when a page exists in that direction (no
 * disabled state), with a centered "X–Y of Z" status in between. Shared by
 * every paginated list in the app (Coffee page's bags/roasters, a bag's
 * brews, ...) so they all page the same way.
 * @param {HTMLElement} container
 * @param {{ offset: number, total: number, pageSize: number, onChange: (offset: number) => void }} state
 */
export function renderPager(container, { offset, total, pageSize, onChange }) {
  container.innerHTML = "";
  if (total <= pageSize) return;

  container.className = "pagination";

  if (offset > 0) {
    const prevButton = document.createElement("button");
    prevButton.type = "button";
    prevButton.className = "calendar-nav-button";
    prevButton.setAttribute("aria-label", "Previous page");
    prevButton.innerHTML = CHEVRON_LEFT;
    prevButton.addEventListener("click", () =>
      onChange(Math.max(0, offset - pageSize)),
    );
    container.append(prevButton);
  }

  const status = document.createElement("span");
  status.className = "pagination-status";
  status.textContent = `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}`;
  container.append(status);

  if (offset + pageSize < total) {
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "calendar-nav-button";
    nextButton.setAttribute("aria-label", "Next page");
    nextButton.innerHTML = CHEVRON_RIGHT;
    nextButton.addEventListener("click", () => onChange(offset + pageSize));
    container.append(nextButton);
  }
}
