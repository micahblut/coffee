/**
 * Parses a `<input type="date">` value (e.g. "2026-07-29") as a local-time
 * Date, avoiding the UTC-midnight shift that `new Date(value)` produces.
 * @param {string} value
 * @returns {Date}
 */
export function parseDateInputValue(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Today's date as a local-time `<input type="date">` value.
 * @returns {string}
 */
export function todayDateInputValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
