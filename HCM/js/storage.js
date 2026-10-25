/* =========================================
   HCM LITE — STORAGE MODULE
   Handles browser localStorage operations
========================================= */

(() => {
  "use strict";

  // 1. Centralized storage keys
  const STORAGE_KEYS = Object.freeze({
    COMPANY: "hcm_company",
    USERS: "hcm_users",
    ATTENDANCE: "hcm_attendance",
    LEAVES: "hcm_leaves",
    SESSION: "hcm_session",
  });

  // 2. Check whether a value is a non-array object
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // 3. Read data from localStorage
  function readData(key, fallback = null) {
    try {
      const storedValue = window.localStorage.getItem(key);

      // Return fallback when key does not exist
      if (storedValue === null) {
        return fallback;
      }

      // Convert JSON string into JavaScript data
      return JSON.parse(storedValue);
    } catch (error) {
      console.error(`[HCM Lite] Failed to read "${key}".`, error);

      return fallback;
    }
  }

  // 4. Write data to localStorage
  function writeData(key, value) {
    try {
      const jsonValue = JSON.stringify(value);

      // Prevent saving values that cannot be serialized
      if (typeof jsonValue !== "string") {
        throw new TypeError("Value could not be converted to JSON.");
      }

      window.localStorage.setItem(key, jsonValue);

      return true;
    } catch (error) {
      console.error(`[HCM Lite] Failed to save "${key}".`, error);

      return false;
    }
  }

  // 5. Remove a specific key from localStorage
  function removeData(key) {
    try {
      window.localStorage.removeItem(key);

      return true;
    } catch (error) {
      console.error(`[HCM Lite] Failed to remove "${key}".`, error);

      return false;
    }
  }

  // 6. Read an array safely
  function readArray(key) {
    const value = readData(key, []);

    if (Array.isArray(value)) {
      return value;
    }

    console.warn(`[HCM Lite] "${key}" does not contain an array.`);

    return [];
  }

  // 7. Read an object safely
  function readRecord(key) {
    const value = readData(key, null);

    if (isRecord(value)) {
      return value;
    }

    if (value !== null) {
      console.warn(`[HCM Lite] "${key}" does not contain an object.`);
    }

    return null;
  }

  // 8. Save an object safely
  function saveRecord(key, value) {
    if (!isRecord(value)) {
      console.error(`[HCM Lite] Invalid object supplied for "${key}".`);

      return false;
    }

    return writeData(key, value);
  }

  // 9. Save an array safely
  function saveArray(key, value) {
    if (!Array.isArray(value)) {
      console.error(`[HCM Lite] An array is required for "${key}".`);

      return false;
    }

    return writeData(key, value);
  }

  // =========================================
  // COMPANY DATA
  // =========================================

  function getCompany() {
    return readRecord(STORAGE_KEYS.COMPANY);
  }

  function saveCompany(company) {
    return saveRecord(STORAGE_KEYS.COMPANY, company);
  }

  // =========================================
  // USERS DATA
  // Admin and Employee accounts
  // =========================================

  function getUsers() {
    return readArray(STORAGE_KEYS.USERS);
  }

  function saveUsers(users) {
    return saveArray(STORAGE_KEYS.USERS, users);
  }

  // =========================================
  // ATTENDANCE DATA
  // =========================================

  function getAttendance() {
    return readArray(STORAGE_KEYS.ATTENDANCE);
  }

  function saveAttendance(records) {
    return saveArray(STORAGE_KEYS.ATTENDANCE, records);
  }

  // =========================================
  // LEAVE DATA
  // =========================================

  function getLeaves() {
    return readArray(STORAGE_KEYS.LEAVES);
  }

  function saveLeaves(records) {
    return saveArray(STORAGE_KEYS.LEAVES, records);
  }

  // =========================================
  // USER SESSION
  // Currently logged-in user
  // =========================================

  function getSession() {
    return readRecord(STORAGE_KEYS.SESSION);
  }

  function setSession(session) {
    return saveRecord(STORAGE_KEYS.SESSION, session);
  }

  function clearSession() {
    return removeData(STORAGE_KEYS.SESSION);
  }

  // =========================================
  // PUBLIC API
  // Other JavaScript files use HCMStorage
  // =========================================

  window.HCMStorage = Object.freeze({
    getCompany,
    saveCompany,

    getUsers,
    saveUsers,

    getAttendance,
    saveAttendance,

    getLeaves,
    saveLeaves,

    getSession,
    setSession,
    clearSession,
  });
})();
