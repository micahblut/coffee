/**
 * @typedef {"Espresso" | "Filter"} BagType
 */

/**
 * @typedef {"Washed" | "Natural" | "Honey" | "Anaerobic" | "Other"} RoastProcess
 */

/**
 * @typedef {Object} Roaster
 * @property {string} id
 * @property {string} name
 * @property {string} [website]
 */

/**
 * @typedef {Object} Bag
 * @property {string} id
 * @property {string} name
 * @property {string} roasterId
 * @property {Date} roastDate
 * @property {BagType} type
 * @property {string} [origin]
 * @property {RoastProcess} [process]
 * @property {number} [weightGrams]
 */

/**
 * @typedef {Object} Grinder
 * @property {string} id
 * @property {string} name
 * @property {Date} [lastCleanedDate]
 */

/**
 * Singleton row (fixed id "settings") holding app-wide preferences.
 * @typedef {Object} Settings
 * @property {"settings"} id
 * @property {string} [defaultGrinderId]
 */

/**
 * @typedef {Object} Brew
 * @property {string} id
 * @property {string} bagId
 * @property {string} grinderId
 * @property {Date} brewDate
 * @property {number} grindSize
 * @property {number} [doseGrams]
 * @property {number} [yieldGrams]
 * @property {number} extractionTimeSeconds
 * @property {number} [waterTempCelsius]
 * @property {1 | 2 | 3 | 4 | 5} rating
 * @property {string} [notes]
 */

export {};
