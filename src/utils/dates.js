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
 * Formats a Date as a local-time `<input type="date">` value, e.g. "2026-07-29".
 * @param {Date} date
 * @returns {string}
 */
export function dateToInputValue(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Today's date as a local-time `<input type="date">` value.
 * @returns {string}
 */
export function todayDateInputValue() {
  return dateToInputValue(new Date());
}

/**
 * Midnight of the given date, local time — matches the resolution of dates
 * parsed from `<input type="date">` fields (see parseDateInputValue).
 * @param {Date} date
 * @returns {Date}
 */
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Midnight today, local time. See startOfDay — used so timestamps recorded
 * "now" (e.g. marking something cleaned) compare correctly against dates a
 * user picked from a date field instead of always looking later in the day
 * than same-day entries.
 * @returns {Date}
 */
export function startOfToday() {
  return startOfDay(new Date());
}
