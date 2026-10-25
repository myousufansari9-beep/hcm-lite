/* =========================================================
   HCM LITE — AUTHENTICATION MODULE
   Responsibilities:
   - First-time company/Admin setup
   - Login and logout
   - Session lookup
   - Role-based dashboard redirection
   - Reusable protected-page guard

   IMPORTANT:
   This is a browser-only hackathon demo. localStorage is not
   secure authentication and must not be used for real passwords.
========================================================= */

(() => {
  "use strict";

  // -----------------------------------------------------
  // 1. Configuration
  // -----------------------------------------------------

  const DASHBOARD_PATHS = Object.freeze({
    admin: "pages/admin.html",
    employee: "pages/employee.html",
  });

  const ALLOWED_ROLES = Object.freeze(["admin", "employee"]);

  // These elements exist on index.html. On other pages they
  // may not exist, because this file also exposes reusable guards.
  const setupSection = document.getElementById("setup-section");
  const loginSection = document.getElementById("login-section");
  const setupForm = document.getElementById("setup-form");
  const loginForm = document.getElementById("login-form");
  const setupError = document.getElementById("setup-error");
  const loginError = document.getElementById("login-error");

  // -----------------------------------------------------
  // 2. Small helper functions
  // -----------------------------------------------------

  function getStorage() {
    if (!window.HCMStorage) {
      throw new Error(
        "HCMStorage is unavailable. Check that js/storage.js loads before js/auth.js.",
      );
    }

    return window.HCMStorage;
  }

  function normalizeEmail(email) {
    return String(email || "")
      .trim()
      .toLowerCase();
  }

  function isValidEmail(email) {
    // Basic client-side format check, not a guarantee the address exists.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function showMessage(element, message, type = "error") {
    if (!element) return;

    element.textContent = message;
    element.style.color = type === "success" ? "#15803d" : "";
    element.setAttribute("role", type === "success" ? "status" : "alert");
  }

  function clearMessage(element) {
    if (!element) return;

    element.textContent = "";
    element.style.color = "";
    element.setAttribute("role", "alert");
  }

  function setSubmitButtonState(form, isBusy, busyText) {
    if (!form) return () => {};

    const button = form.querySelector('button[type="submit"]');
    if (!button) return () => {};

    const originalText = button.textContent;
    button.disabled = isBusy;

    if (isBusy) {
      button.textContent = busyText;
    }

    return () => {
      button.disabled = false;
      button.textContent = originalText;
    };
  }

  function createUniqueId(existingUsers) {
    let id = Date.now();

    while (existingUsers.some((user) => String(user.id) === String(id))) {
      id += 1;
    }

    return id;
  }

  function isValidAdmin(user) {
    return Boolean(
      user &&
      user.role === "admin" &&
      user.id !== undefined &&
      user.id !== null &&
      typeof user.name === "string" &&
      user.name.trim() &&
      typeof user.email === "string" &&
      isValidEmail(normalizeEmail(user.email)) &&
      typeof user.password === "string" &&
      user.password.length > 0,
    );
  }

  function isSetupComplete() {
    const storage = getStorage();
    const company = storage.getCompany();
    const users = storage.getUsers();

    return Boolean(
      company &&
      typeof company.name === "string" &&
      company.name.trim() &&
      Array.isArray(users) &&
      users.some(isValidAdmin),
    );
  }

  function isInPagesDirectory() {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    return pathParts.length >= 2 && pathParts[pathParts.length - 2] === "pages";
  }

  function getIndexPath() {
    return isInPagesDirectory() ? "../index.html" : "index.html";
  }

  function getDashboardPath(role) {
    if (!ALLOWED_ROLES.includes(role)) return getIndexPath();

    // From index.html, dashboard files are inside pages/.
    // From a page inside pages/, they are sibling files.
    if (isInPagesDirectory()) {
      return role === "admin" ? "admin.html" : "employee.html";
    }

    return DASHBOARD_PATHS[role];
  }

  // -----------------------------------------------------
  // 3. Setup/login form visibility
  // -----------------------------------------------------

  function showSetupForm() {
    if (setupSection) setupSection.hidden = false;
    if (loginSection) loginSection.hidden = true;
    clearMessage(loginError);
  }

  function showLoginForm(message = "", type = "error") {
    if (setupSection) setupSection.hidden = true;
    if (loginSection) loginSection.hidden = false;
    clearMessage(setupError);

    if (message) {
      showMessage(loginError, message, type);
    } else {
      clearMessage(loginError);
    }

    const emailInput = document.getElementById("login-email");
    if (emailInput) emailInput.focus();
  }

  // -----------------------------------------------------
  // 4. Current user and session helpers
  // -----------------------------------------------------

  function getCurrentUser() {
    const storage = getStorage();
    const session = storage.getSession();

    if (!session || session.userId === undefined || session.userId === null) {
      return null;
    }

    if (!ALLOWED_ROLES.includes(session.role)) {
      storage.clearSession();
      return null;
    }

    const users = storage.getUsers();
    const user = users.find(
      (item) => String(item.id) === String(session.userId),
    );

    // A session is valid only if the user still exists and the role matches.
    if (!user || user.role !== session.role) {
      storage.clearSession();
      return null;
    }

    return user;
  }

  function redirectByRole(role) {
    if (!ALLOWED_ROLES.includes(role)) {
      console.error("[HCM Lite] Cannot redirect: unknown user role.");
      window.location.assign(getIndexPath());
      return false;
    }

    window.location.assign(getDashboardPath(role));
    return true;
  }

  function requireAuth(requiredRole = null) {
    const user = getCurrentUser();

    if (!user) {
      window.location.assign(getIndexPath());
      return null;
    }

    if (requiredRole && !ALLOWED_ROLES.includes(requiredRole)) {
      console.error(`[HCM Lite] Invalid required role: ${requiredRole}`);
      window.location.assign(getIndexPath());
      return null;
    }

    if (requiredRole && user.role !== requiredRole) {
      // Send the user to their own dashboard, not the restricted page.
      window.location.assign(getDashboardPath(user.role));
      return null;
    }

    return user;
  }

  function logout() {
    const storage = getStorage();
    const cleared = storage.clearSession();

    if (!cleared) {
      const messageElement = loginError || setupError;
      showMessage(
        messageElement,
        "Logout could not clear the session. Please check browser storage and try again.",
      );
      return false;
    }

    window.location.assign(getIndexPath());
    return true;
  }

  // -----------------------------------------------------
  // 5. First-time company/Admin setup
  // -----------------------------------------------------

  function handleSetupSubmit(event) {
    event.preventDefault();
    clearMessage(setupError);

    const storage = getStorage();

    // Prevent a second setup after the company and Admin already exist.
    if (isSetupComplete()) {
      showLoginForm(
        "Company setup is already complete. Please log in.",
        "success",
      );
      return;
    }

    const companyName =
      document.getElementById("company-name")?.value.trim() || "";
    const adminName = document.getElementById("admin-name")?.value.trim() || "";
    const adminEmail = normalizeEmail(
      document.getElementById("admin-email")?.value,
    );
    const adminPassword =
      document.getElementById("admin-password")?.value || "";

    // Basic validation. Required attributes in HTML provide a first layer;
    // these checks also protect this handler if browser validation is bypassed.
    if (!companyName || !adminName || !adminEmail || !adminPassword) {
      showMessage(setupError, "Please complete all setup fields.");
      return;
    }

    if (!isValidEmail(adminEmail)) {
      showMessage(setupError, "Please enter a valid email address.");
      return;
    }

    const existingUsers = storage.getUsers();
    const duplicateEmail = existingUsers.some(
      (user) => normalizeEmail(user.email) === adminEmail,
    );

    if (duplicateEmail) {
      showMessage(
        setupError,
        "This email is already registered. Use a different email or clear incomplete test data.",
      );
      return;
    }

    // If setup data is only partially present, the UI gives clear recovery guidance.
    const restoreUsers = existingUsers.slice();
    const previousCompany = storage.getCompany();
    const restoreButton = setSubmitButtonState(
      setupForm,
      true,
      "Setting up...",
    );

    try {
      const adminUser = {
        id: createUniqueId(existingUsers),
        name: adminName,
        email: adminEmail,
        // Plain-text password is only for this local hackathon demo.
        // Never use this approach in a real application.
        password: adminPassword,
        role: "admin",
        department: "",
        salary: 0,
      };

      const company = {
        name: companyName,
        officeStartTime: "09:00",
        graceMinutes: 15,
        yearlyLeaveQuota: 20,
        workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      };

      // Save users first. If company save fails, attempt to roll users back.
      const usersSaved = storage.saveUsers([...existingUsers, adminUser]);
      if (!usersSaved) {
        showMessage(
          setupError,
          "Could not save the Admin account. Check browser storage and try again.",
        );
        return;
      }

      const companySaved = storage.saveCompany(company);
      if (!companySaved) {
        const rollbackSucceeded = storage.saveUsers(restoreUsers);
        if (!rollbackSucceeded) {
          showMessage(
            setupError,
            "Setup could not finish, and automatic rollback failed. Clear HCM Lite storage and try again.",
          );
        } else {
          showMessage(
            setupError,
            "Could not save company details. Please try again.",
          );
        }

        return;
      }

      // Setup deliberately does not log in automatically. This makes the
      // setup and login flows independently testable.
      showLoginForm("Company setup successful. Please log in.", "success");
      if (loginForm) loginForm.reset();
    } catch (error) {
      console.error("[HCM Lite] Setup failed.", error);

      // Best-effort recovery for unexpected errors.
      storage.saveUsers(restoreUsers);
      if (previousCompany) {
        storage.saveCompany(previousCompany);
      }

      showMessage(
        setupError,
        "An unexpected error occurred during setup. Please try again.",
      );
    } finally {
      restoreButton();
    }
  }

  // -----------------------------------------------------
  // 6. Login
  // -----------------------------------------------------

  function handleLoginSubmit(event) {
    event.preventDefault();
    clearMessage(loginError);

    const storage = getStorage();

    if (!isSetupComplete()) {
      showSetupForm();
      showMessage(
        setupError,
        "Company setup is not complete. Please complete the setup first.",
      );
      return;
    }

    const email = normalizeEmail(document.getElementById("login-email")?.value);
    const password = document.getElementById("login-password")?.value || "";

    if (!email || !password) {
      showMessage(loginError, "Please enter both email and password.");
      return;
    }

    if (!isValidEmail(email)) {
      showMessage(loginError, "Please enter a valid email address.");
      return;
    }

    const restoreButton = setSubmitButtonState(
      loginForm,
      true,
      "Logging in...",
    );

    try {
      const users = storage.getUsers();
      const matchedUser = users.find(
        (user) =>
          normalizeEmail(user.email) === email &&
          user.password === password &&
          ALLOWED_ROLES.includes(user.role),
      );

      if (!matchedUser) {
        showMessage(
          loginError,
          "Incorrect email or password. Please try again.",
        );
        return;
      }

      const session = {
        userId: matchedUser.id,
        role: matchedUser.role,
      };

      const sessionSaved = storage.setSession(session);
      if (!sessionSaved) {
        showMessage(
          loginError,
          "Login could not be saved. Check browser storage and try again.",
        );
        return;
      }

      redirectByRole(matchedUser.role);
    } catch (error) {
      console.error("[HCM Lite] Login failed.", error);
      showMessage(
        loginError,
        "An unexpected error occurred during login. Please try again.",
      );
    } finally {
      restoreButton();
    }
  }

  // -----------------------------------------------------
  // 7. Initialize index.html
  // -----------------------------------------------------

  function initAuthPage() {
    // Do nothing on other pages. They can call requireAuth() themselves.
    if (!setupForm || !loginForm || !setupSection || !loginSection) {
      return;
    }

    setupForm.addEventListener("submit", handleSetupSubmit);
    loginForm.addEventListener("submit", handleLoginSubmit);

    try {
      if (isSetupComplete()) {
        const currentUser = getCurrentUser();

        // Keep an existing valid session active across refreshes.
        if (currentUser) {
          redirectByRole(currentUser.role);
          return;
        }

        showLoginForm();
      } else {
        showSetupForm();

        const company = getStorage().getCompany();
        const users = getStorage().getUsers();
        const hasPartialData = Boolean(company || users.length > 0);

        if (hasPartialData) {
          showMessage(
            setupError,
            "Existing HCM Lite data looks incomplete. For a clean test, clear hcm_company, hcm_users, hcm_attendance, hcm_leaves, and hcm_session in DevTools > Application > Local Storage, then reload.",
          );
        }
      }
    } catch (error) {
      console.error("[HCM Lite] Could not initialize authentication.", error);
      showMessage(
        setupError || loginError,
        "Authentication could not start. Check that js/storage.js loads before js/auth.js.",
      );
    }
  }

  // -----------------------------------------------------
  // 8. Public API for other pages
  // -----------------------------------------------------

  window.HCMAuth = Object.freeze({
    initAuthPage,
    showSetupForm,
    showLoginForm,
    getCurrentUser,
    redirectByRole,
    requireAuth,
    logout,
  });

  // With defer scripts, the DOM has been parsed by the time this file runs.
  // The state check also supports loading this script without defer.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuthPage, { once: true });
  } else {
    initAuthPage();
  }
})();
