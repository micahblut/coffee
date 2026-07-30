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
 * @property {Date} createdAt when this bag record was added to the app —
 *   distinct from roastDate, used to rank "recently started" bags
 */

/**
 * @typedef {Object} Grinder
 * @property {string} id
 * @property {string} name
 * @property {Date} [lastCleanedDate]
 * @property {number} [cleaningIntervalGrinds] remind to clean after this
 *   many brews since lastCleanedDate
 * @property {number} [cleaningIntervalWeeks] remind to clean after this
 *   many weeks since lastCleanedDate, as a backstop for lightly-used grinders
 */

/**
 * @typedef {Object} Brewer
 * @property {string} id
 * @property {string} name
 * @property {Date} [lastCleanedDate]
 * @property {number} [cleaningIntervalBrews] remind to clean after this
 *   many brews since lastCleanedDate
 * @property {number} [cleaningIntervalWeeks] remind to clean after this
 *   many weeks since lastCleanedDate, as a backstop for lightly-used brewers
 */

/**
 * Singleton row (fixed id "settings") holding app-wide preferences.
 * @typedef {Object} Settings
 * @property {"settings"} id
 * @property {string} [defaultGrinderId]
 * @property {string} [defaultBrewerId]
 * @property {number} [defaultDoseGrams]
 * @property {number} [defaultYieldGrams]
 * @property {number} [defaultWaterTempCelsius]
 */

/**
 * @typedef {Object} Brew
 * @property {string} id
 * @property {string} bagId
 * @property {string} grinderId
 * @property {string} brewerId
 * @property {Date} brewDate
 * @property {number} grindSize
 * @property {number} [doseGrams]
 * @property {number} [yieldGrams]
 * @property {number} extractionTimeSeconds
 * @property {number} [waterTempCelsius]
 * @property {1 | 2 | 3 | 4 | 5} rating
 * @property {string} [notes]
 * @property {Date} createdAt when this brew record was logged — distinct
 *   from brewDate (which the user can backdate), used to rank bag recency
 */

export {};
