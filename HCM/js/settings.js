/* =========================================================
   HCM LITE — COMPANY SETTINGS MODULE

   Features:
   1. Admin-only access
   2. Display company information
   3. Load previously saved settings
   4. Validate office start time
   5. Validate grace period
   6. Validate annual leave quota
   7. Validate working days
   8. Save settings to localStorage
   9. Reload saved settings
   10. Admin profile, date and logout
========================================================= */

(() => {
  "use strict";

  // -----------------------------------------------------
  // 1. CHECK REQUIRED MODULES
  // -----------------------------------------------------

  if (!window.HCMStorage || !window.HCMAuth) {
    console.error("[HCM Lite] storage.js or auth.js has not loaded.");
    return;
  }

  const storage = window.HCMStorage;
  const auth = window.HCMAuth;

  // Only an authenticated Admin may use this page.
  const admin = auth.requireAuth("admin");

  if (!admin) {
    return;
  }

  // -----------------------------------------------------
  // 2. DOM ELEMENTS
  // -----------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const settingsForm = $("settings-form");

  const companyNameDisplay = $("settings-company-name");

  const officeStartInput = $("office-start-time");
  const graceMinutesInput = $("grace-minutes");
  const yearlyLeaveQuotaInput = $("yearly-leave-quota");

  const workingDaysFieldset = $("working-days-fieldset");
  const workingDaysError = $("working-days-error");

  const settingsMessage = $("settings-message");

  const saveButton = $("save-settings-button");
  const reloadButton = $("reload-settings-button");

  const companyNameValue = $("settings-company-name");

  if (
    !settingsForm ||
    !officeStartInput ||
    !graceMinutesInput ||
    !yearlyLeaveQuotaInput ||
    !workingDaysFieldset ||
    !workingDaysError ||
    !settingsMessage ||
    !saveButton ||
    !reloadButton ||
    !companyNameValue
  ) {
    console.error("[HCM Lite] Required settings HTML elements are missing.");
    return;
  }

  // -----------------------------------------------------
  // 3. DEFAULT SETTINGS
  // -----------------------------------------------------

  const DEFAULT_SETTINGS = Object.freeze({
    officeStartTime: "09:00",
    graceMinutes: 15,
    yearlyLeaveQuota: 20,

    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  });

  const VALID_DAYS = Object.freeze([
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]);

  // -----------------------------------------------------
  // 4. HELPER FUNCTIONS
  // -----------------------------------------------------

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent = String(value);
    }
  }

  function showMessage(message, type = "error") {
    settingsMessage.textContent = message;

    settingsMessage.classList.remove(
      "success",
      "error",
      "message-success",
      "message-error",
      "is-success",
      "is-error",
    );

    if (message) {
      settingsMessage.classList.add(type);
    }

    settingsMessage.setAttribute("role", type === "error" ? "alert" : "status");
  }

  function clearMessage() {
    showMessage("", "success");
  }

  function showWorkingDaysError(message = "") {
    workingDaysError.textContent = message;
  }

  function getCurrentCompany() {
    return storage.getCompany();
  }

  function isValidCompany(company) {
    return Boolean(
      company &&
      typeof company.name === "string" &&
      company.name.trim().length > 0,
    );
  }

  function getWorkingDayCheckboxes() {
    return Array.from(
      settingsForm.querySelectorAll(
        'input[name="workingDays"][type="checkbox"]',
      ),
    );
  }

  function getSelectedWorkingDays() {
    return getWorkingDayCheckboxes()
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value);
  }

  function setSaveButtonState(isSaving) {
    saveButton.disabled = isSaving;
    saveButton.textContent = isSaving ? "Saving Settings..." : "Save Settings";
  }

  // -----------------------------------------------------
  // 5. ADMIN PROFILE AND DATE
  // -----------------------------------------------------

  function getInitials(name) {
    return (
      String(name || "Admin")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "A"
    );
  }

  function initializeAdminProfile() {
    const name = admin.name || "Admin";
    const initials = getInitials(name);

    setText("sidebar-admin-name", name);
    setText("admin-name", name);

    const dateElement = $("current-date");

    if (dateElement) {
      dateElement.textContent = new Intl.DateTimeFormat("en-PK", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date());
    }

    const avatarIds = ["sidebar-admin-avatar", "admin-avatar"];

    avatarIds.forEach((id) => {
      const avatar = $(id);

      if (avatar) {
        avatar.textContent = initials;
      }
    });
  }

  // -----------------------------------------------------
  // 6. COMPANY INFORMATION
  // -----------------------------------------------------

  function renderCompanyInformation(company) {
    if (!isValidCompany(company)) {
      companyNameDisplay.textContent = "Company setup not found";

      return false;
    }

    companyNameDisplay.textContent = company.name.trim();

    return true;
  }

  // -----------------------------------------------------
  // 7. LOAD SAVED SETTINGS
  // -----------------------------------------------------

  function loadSavedSettings(showFeedback = false) {
    clearMessage();
    showWorkingDaysError("");

    const company = getCurrentCompany();

    // Do not create a company automatically from this page.
    if (!isValidCompany(company)) {
      renderCompanyInformation(null);

      showMessage(
        "Company details could not be loaded. Check that first-time setup is complete and the company record exists.",
        "error",
      );

      saveButton.disabled = true;

      return false;
    }

    saveButton.disabled = false;

    renderCompanyInformation(company);

    // Use saved values. Defaults apply only to missing properties.
    officeStartInput.value =
      typeof company.officeStartTime === "string"
        ? company.officeStartTime
        : DEFAULT_SETTINGS.officeStartTime;

    graceMinutesInput.value =
      company.graceMinutes !== undefined && company.graceMinutes !== null
        ? String(company.graceMinutes)
        : String(DEFAULT_SETTINGS.graceMinutes);

    yearlyLeaveQuotaInput.value =
      company.yearlyLeaveQuota !== undefined &&
      company.yearlyLeaveQuota !== null
        ? String(company.yearlyLeaveQuota)
        : String(DEFAULT_SETTINGS.yearlyLeaveQuota);

    // Restore working-day selections.
    const savedDays = Array.isArray(company.workingDays)
      ? company.workingDays
      : DEFAULT_SETTINGS.workingDays;

    getWorkingDayCheckboxes().forEach((checkbox) => {
      checkbox.checked = savedDays.includes(checkbox.value);
    });

    if (showFeedback) {
      showMessage("Saved company settings have been reloaded.", "success");
    }

    return true;
  }

  // -----------------------------------------------------
  // 8. VALIDATE NUMERIC INPUTS
  // -----------------------------------------------------

  function validateIntegerInput(input, label, min, max) {
    const rawValue = input.value.trim();
    const number = Number(rawValue);

    let error = "";

    if (rawValue === "") {
      error = `${label} is required.`;
    } else if (!Number.isInteger(number)) {
      error = `${label} must be a whole number.`;
    } else if (number < min || number > max) {
      error = `${label} must be between ${min} and ${max}.`;
    }

    if (error) {
      input.setCustomValidity(error);
      input.reportValidity();
      input.setCustomValidity("");

      showMessage(error, "error");
      input.focus();

      return null;
    }

    return number;
  }

  // -----------------------------------------------------
  // 9. VALIDATE OFFICE START TIME
  // -----------------------------------------------------

  function validateOfficeStartTime() {
    const value = officeStartInput.value.trim();

    if (
      !value ||
      !/^\d{2}:\d{2}$/.test(value) ||
      !officeStartInput.checkValidity()
    ) {
      const error = "Please select a valid office start time.";

      officeStartInput.setCustomValidity(error);
      officeStartInput.reportValidity();
      officeStartInput.setCustomValidity("");

      showMessage(error, "error");
      officeStartInput.focus();

      return false;
    }

    return true;
  }

  // -----------------------------------------------------
  // 10. VALIDATE WORKING DAYS
  // -----------------------------------------------------

  function validateWorkingDays() {
    const checkboxes = getWorkingDayCheckboxes();
    const selectedDays = getSelectedWorkingDays();

    if (checkboxes.length !== VALID_DAYS.length) {
      showWorkingDaysError(
        "The working-day options are incomplete. Please check the page HTML.",
      );

      return null;
    }

    const allValuesAreValid = checkboxes.every((checkbox) =>
      VALID_DAYS.includes(checkbox.value),
    );

    if (!allValuesAreValid) {
      showWorkingDaysError("One or more working-day values are invalid.");

      return null;
    }

    if (selectedDays.length === 0) {
      showWorkingDaysError("Please select at least one working day.");

      const firstCheckbox = checkboxes[0];

      if (firstCheckbox) {
        firstCheckbox.focus();
      }

      showMessage("At least one working day must be selected.", "error");

      return null;
    }

    showWorkingDaysError("");

    // Checkbox values are returned in the HTML's weekday order.
    return selectedDays;
  }

  // -----------------------------------------------------
  // 11. SAVE SETTINGS
  // -----------------------------------------------------

  function handleSettingsSubmit(event) {
    event.preventDefault();

    clearMessage();
    showWorkingDaysError("");

    const existingCompany = getCurrentCompany();

    if (!isValidCompany(existingCompany)) {
      loadSavedSettings();

      showMessage(
        "Company details are missing. Please complete or restore company setup before saving settings.",
        "error",
      );

      return;
    }

    // Validate office timing first.
    if (!validateOfficeStartTime()) {
      return;
    }

    // Grace period: whole number from 0 to 1440.
    const graceMinutes = validateIntegerInput(
      graceMinutesInput,
      "Grace period",
      0,
      1440,
    );

    if (graceMinutes === null) {
      return;
    }

    // Yearly leave quota: whole number from 0 to 366.
    const yearlyLeaveQuota = validateIntegerInput(
      yearlyLeaveQuotaInput,
      "Yearly leave quota",
      0,
      366,
    );

    if (yearlyLeaveQuota === null) {
      return;
    }

    // Validate the required working-day selection.
    const workingDays = validateWorkingDays();

    if (!workingDays) {
      return;
    }

    // Check any remaining native HTML constraints.
    if (!settingsForm.checkValidity()) {
      settingsForm.reportValidity();

      showMessage("Please correct the invalid settings fields.", "error");

      return;
    }

    // Keep existing company information and update only the settings.
    // This prevents unrelated company properties from being discarded.
    const updatedCompany = {
      ...existingCompany,

      officeStartTime: officeStartInput.value,
      graceMinutes,
      yearlyLeaveQuota,
      workingDays,
    };

    setSaveButtonState(true);

    try {
      const saved = storage.saveCompany(updatedCompany);

      if (!saved) {
        showMessage(
          "Settings could not be saved. Check browser storage and try again.",
          "error",
        );

        return;
      }

      // Read back the saved record to verify persistence.
      const savedCompany = storage.getCompany();

      if (
        !isValidCompany(savedCompany) ||
        savedCompany.officeStartTime !== updatedCompany.officeStartTime ||
        Number(savedCompany.graceMinutes) !== graceMinutes ||
        Number(savedCompany.yearlyLeaveQuota) !== yearlyLeaveQuota ||
        !Array.isArray(savedCompany.workingDays) ||
        savedCompany.workingDays.length !== workingDays.length ||
        !workingDays.every((day) => savedCompany.workingDays.includes(day))
      ) {
        showMessage(
          "The settings were written, but verification failed. Reload saved settings and check the stored company record.",
          "error",
        );

        return;
      }

      renderCompanyInformation(savedCompany);

      showMessage("Company settings saved successfully.", "success");

      console.log("[HCM Lite] Company settings saved and verified.", {
        officeStartTime: savedCompany.officeStartTime,
        graceMinutes: savedCompany.graceMinutes,
        yearlyLeaveQuota: savedCompany.yearlyLeaveQuota,
        workingDays: savedCompany.workingDays,
      });
    } catch (error) {
      console.error("[HCM Lite] Failed to save company settings.", error);

      showMessage(
        "An unexpected error occurred while saving settings. Check the Console for details.",
        "error",
      );
    } finally {
      setSaveButtonState(false);
    }
  }

  // -----------------------------------------------------
  // 12. RELOAD SAVED SETTINGS BUTTON
  // -----------------------------------------------------

  function handleReloadSettings() {
    const confirmed = window.confirm(
      "Reload saved company settings?\n\n" +
        "Any unsaved changes currently entered in the form will be discarded.",
    );

    if (!confirmed) {
      return;
    }

    loadSavedSettings(true);
  }

  // -----------------------------------------------------
  // 13. CLEAR STALE FEEDBACK WHEN USER EDITS FIELDS
  // -----------------------------------------------------

  function initializeFeedbackEvents() {
    [officeStartInput, graceMinutesInput, yearlyLeaveQuotaInput].forEach(
      (input) => {
        input.addEventListener("input", () => {
          input.setCustomValidity("");
          clearMessage();
        });

        input.addEventListener("change", () => {
          input.setCustomValidity("");
          clearMessage();
        });
      },
    );

    getWorkingDayCheckboxes().forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        showWorkingDaysError("");
        clearMessage();
      });
    });
  }

  // -----------------------------------------------------
  // 14. LOGOUT FUNCTIONALITY
  // -----------------------------------------------------

  function initializeLogout() {
    const logoutButton = $("logout-button");

    if (!logoutButton) {
      console.warn("[HCM Lite] Logout button was not found.");

      return;
    }

    logoutButton.addEventListener("click", () => {
      auth.logout();
    });
  }

  // -----------------------------------------------------
  // 15. INITIALIZE SETTINGS PAGE
  // -----------------------------------------------------

  function initSettingsPage() {
    initializeAdminProfile();

    settingsForm.addEventListener("submit", handleSettingsSubmit);

    reloadButton.addEventListener("click", handleReloadSettings);

    initializeFeedbackEvents();
    initializeLogout();

    const loaded = loadSavedSettings();

    if (loaded) {
      console.log("[HCM Lite] Settings page initialized successfully.");
    } else {
      console.error("[HCM Lite] Settings could not be initialized.");
    }
  }

  // -----------------------------------------------------
  // 16. START
  // -----------------------------------------------------

  initSettingsPage();
})();
