/* =========================================================
   HCM LITE — EMPLOYEE MANAGEMENT MODULE

   Features:
   - Admin authentication
   - Add employee and create login account
   - Required field and email validation
   - Duplicate email prevention
   - Positive salary validation
   - Edit employee details
   - Preserve password when editing if left blank
   - Delete employee account
   - Search by name, email, or department
   - Filter by department
   - Clear filters
   - Update employee statistics
   - Persist changes with localStorage
========================================================= */

(() => {
  "use strict";

  // -----------------------------------------------------
  // 1. CHECK REQUIRED MODULES AND ADMIN ACCESS
  // -----------------------------------------------------

  if (!window.HCMStorage || !window.HCMAuth) {
    console.error("[HCM Lite] storage.js or auth.js has not loaded.");
    return;
  }

  const storage = window.HCMStorage;
  const auth = window.HCMAuth;

  const admin = auth.requireAuth("admin");

  if (!admin) {
    return;
  }

  // -----------------------------------------------------
  // 2. DOM ELEMENTS
  // -----------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const form = $("employee-form");
  const employeeIdInput = $("employee-id");
  const nameInput = $("employee-name");
  const emailInput = $("employee-email");
  const passwordInput = $("employee-password");
  const departmentInput = $("employee-department");
  const salaryInput = $("employee-salary");

  const formHeading = $("employee-form-heading");
  const formDescription = $("employee-form-description");
  const formMessage = $("employee-form-message");
  const listMessage = $("employee-list-message");

  const submitButton = $("employee-submit-button");
  const cancelEditButton = $("cancel-edit-button");
  const passwordHelp = $("password-help");

  const searchInput = $("employee-search");
  const departmentFilter = $("department-filter");
  const clearFiltersButton = $("clear-filters-button");

  const tableBody = $("employees-table-body");

  if (
    !form ||
    !employeeIdInput ||
    !nameInput ||
    !emailInput ||
    !passwordInput ||
    !departmentInput ||
    !salaryInput ||
    !submitButton ||
    !searchInput ||
    !departmentFilter ||
    !clearFiltersButton ||
    !tableBody
  ) {
    console.error(
      "[HCM Lite] Employee page is missing one or more required HTML elements.",
    );
    return;
  }

  // -----------------------------------------------------
  // 3. GENERAL HELPERS
  // -----------------------------------------------------

  function normalizeEmail(email) {
    return String(email || "")
      .trim()
      .toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function normalizeDepartment(department) {
    return String(department || "")
      .trim()
      .toLowerCase();
  }

  function getEmployees() {
    const users = storage.getUsers();

    if (!Array.isArray(users)) {
      return [];
    }

    // Admin accounts must never appear in the employee directory.
    return users.filter((user) => user && user.role === "employee");
  }

  function formatCurrency(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
      return "PKR 0";
    }

    return new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency: "PKR",
      maximumFractionDigits: 2,
    }).format(value);
  }

  function formatDate(date = new Date()) {
    return new Intl.DateTimeFormat("en-PK", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent = String(value);
    }
  }

  function showMessage(element, message, type = "error") {
    if (!element) return;

    element.textContent = message;

    element.classList.remove(
      "success",
      "error",
      "message-success",
      "message-error",
    );

    if (message) {
      element.classList.add(type);
    }

    element.setAttribute("role", type === "error" ? "alert" : "status");
  }

  function clearMessage(element) {
    if (!element) return;

    element.textContent = "";
    element.classList.remove(
      "success",
      "error",
      "message-success",
      "message-error",
    );
  }

  function createEmployeeId(users) {
    let id = Date.now();

    // Prevent ID collisions with existing accounts.
    while (users.some((user) => String(user?.id) === String(id))) {
      id += 1;
    }

    return id;
  }

  // -----------------------------------------------------
  // 4. ADMIN PROFILE AND LOGOUT
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

  function initializeProfile() {
    const name = admin.name || "Admin";
    const initials = getInitials(name);

    setText("sidebar-admin-name", name);
    setText("admin-name", name);
    setText("current-date", formatDate());

    document
      .querySelectorAll(".sidebar-user .user-avatar, .topbar-avatar")
      .forEach((avatar) => {
        avatar.textContent = initials;
      });
  }

  function initializeLogout() {
    const logoutButton = $("logout-button");

    if (!logoutButton) return;

    logoutButton.addEventListener("click", () => {
      auth.logout();
    });
  }

  // -----------------------------------------------------
  // 5. SEARCH AND DEPARTMENT FILTER
  // -----------------------------------------------------

  function populateDepartmentFilter() {
    const previousValue = departmentFilter.value;

    const departments = [
      ...new Set(
        getEmployees()
          .map((employee) => String(employee.department || "").trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));

    departmentFilter.replaceChildren();

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All Departments";

    departmentFilter.appendChild(allOption);

    departments.forEach((department) => {
      const option = document.createElement("option");

      option.value = department;
      option.textContent = department;

      departmentFilter.appendChild(option);
    });

    // Preserve the selected department if it still exists.
    if (departments.includes(previousValue)) {
      departmentFilter.value = previousValue;
    } else {
      departmentFilter.value = "";
    }
  }

  function getFilteredEmployees(employees) {
    const searchTerm = searchInput.value.trim().toLowerCase();

    const selectedDepartment = normalizeDepartment(departmentFilter.value);

    return employees.filter((employee) => {
      const name = String(employee.name || "").toLowerCase();
      const email = normalizeEmail(employee.email);
      const department = String(employee.department || "").toLowerCase();

      const matchesSearch =
        !searchTerm ||
        name.includes(searchTerm) ||
        email.includes(searchTerm) ||
        department.includes(searchTerm);

      const matchesDepartment =
        !selectedDepartment ||
        normalizeDepartment(employee.department) === selectedDepartment;

      return matchesSearch && matchesDepartment;
    });
  }

  // -----------------------------------------------------
  // 6. EMPLOYEE STATISTICS
  // -----------------------------------------------------

  function renderStatistics(employees, filteredEmployees) {
    const departments = new Set(
      employees
        .map((employee) => normalizeDepartment(employee.department))
        .filter(Boolean),
    );

    const monthlyPayroll = employees.reduce((total, employee) => {
      const salary = Number(employee.salary);

      return total + (Number.isFinite(salary) && salary > 0 ? salary : 0);
    }, 0);

    setText("employees-total-count", employees.length);
    setText("departments-count", departments.size);
    setText("filtered-employees-count", filteredEmployees.length);
    setText("monthly-payroll-total", formatCurrency(monthlyPayroll));

    setText(
      "employee-table-count",
      `${filteredEmployees.length} ${
        filteredEmployees.length === 1 ? "employee" : "employees"
      }`,
    );
  }

  // -----------------------------------------------------
  // 7. SAFE TABLE CELL CREATION
  // -----------------------------------------------------

  function createCell(value, className = "") {
    const cell = document.createElement("td");

    if (className) {
      cell.className = className;
    }

    // textContent prevents employee input from being interpreted as HTML.
    cell.textContent =
      value === undefined || value === null || value === ""
        ? "—"
        : String(value);

    return cell;
  }

  function createActionButton(label, action, employeeId, className) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = `action-button ${className}`;

    button.textContent = label;
    button.dataset.action = action;
    button.dataset.employeeId = String(employeeId);

    return button;
  }

  // -----------------------------------------------------
  // 8. RENDER EMPLOYEE TABLE
  // -----------------------------------------------------

  function renderEmployeeTable(employees) {
    const filteredEmployees = getFilteredEmployees(employees);

    // Remove only rows generated by this JavaScript.
    tableBody
      .querySelectorAll("[data-generated-row='true']")
      .forEach((row) => row.remove());

    const emptyState = $("employees-empty-state");

    if (emptyState) {
      emptyState.hidden = filteredEmployees.length > 0;
    }

    // Alphabetical ordering makes the directory easier to scan.
    const sortedEmployees = [...filteredEmployees].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
    );

    sortedEmployees.forEach((employee) => {
      const row = document.createElement("tr");

      row.dataset.generatedRow = "true";

      row.appendChild(createCell(employee.name, "employee-name-cell"));

      row.appendChild(createCell(employee.email, "employee-email-cell"));

      row.appendChild(
        createCell(employee.department, "employee-department-cell"),
      );

      row.appendChild(
        createCell(formatCurrency(employee.salary), "employee-salary-cell"),
      );

      const actionsCell = document.createElement("td");

      const actionsContainer = document.createElement("div");
      actionsContainer.className = "employee-row-actions";

      actionsContainer.appendChild(
        createActionButton("Edit", "edit", employee.id, "edit-button"),
      );

      actionsContainer.appendChild(
        createActionButton("Delete", "delete", employee.id, "delete-button"),
      );

      actionsCell.appendChild(actionsContainer);
      row.appendChild(actionsCell);

      tableBody.appendChild(row);
    });

    setText(
      "employee-directory-summary",
      `Showing ${filteredEmployees.length} of ${employees.length} employees.`,
    );

    renderStatistics(employees, filteredEmployees);

    return filteredEmployees;
  }

  // -----------------------------------------------------
  // 9. REFRESH THE EMPLOYEE DIRECTORY
  // -----------------------------------------------------

  function renderPage() {
    populateDepartmentFilter();

    const employees = getEmployees();

    renderEmployeeTable(employees);
  }

  // -----------------------------------------------------
  // 10. RESET FORM AND EDIT MODE
  // -----------------------------------------------------

  function resetEmployeeForm() {
    form.reset();

    employeeIdInput.value = "";

    // Password is mandatory for a new employee.
    passwordInput.required = true;

    passwordInput.placeholder = "Create employee login password";

    if (passwordHelp) {
      passwordHelp.textContent =
        "Required for a new employee account. When editing, leave blank to keep the existing password.";
    }

    if (formHeading) {
      formHeading.textContent = "Add New Employee";
    }

    if (formDescription) {
      formDescription.textContent =
        "Enter employee details to create their company account.";
    }

    submitButton.textContent = "Add Employee";

    cancelEditButton.hidden = true;

    clearMessage(formMessage);
  }

  function clearFilters(shouldRender = true) {
    searchInput.value = "";
    departmentFilter.value = "";

    clearMessage(listMessage);

    if (shouldRender) {
      renderPage();
    }
  }

  // -----------------------------------------------------
  // 11. FORM VALIDATION
  // -----------------------------------------------------

  function validateEmployeeForm({
    name,
    email,
    password,
    department,
    salaryValue,
    editing,
  }) {
    if (!name || !email || !department || salaryValue.trim() === "") {
      return "Please complete all required employee fields.";
    }

    if (!isValidEmail(email)) {
      return "Please enter a valid email address.";
    }

    if (!editing && !password) {
      return "A password is required for a new employee account.";
    }

    if (!editing && password.trim().length === 0) {
      return "Password cannot contain only spaces.";
    }

    // For an edit, blank password means preserve the existing password.
    if (editing && password.length > 0 && password.trim().length === 0) {
      return "Password cannot contain only spaces.";
    }

    const salary = Number(salaryValue);

    if (!Number.isFinite(salary) || salary <= 0) {
      return "Monthly salary must be a number greater than zero.";
    }

    return "";
  }

  // -----------------------------------------------------
  // 12. ADD OR UPDATE AN EMPLOYEE
  // -----------------------------------------------------

  function handleEmployeeSubmit(event) {
    event.preventDefault();

    clearMessage(formMessage);
    clearMessage(listMessage);

    // Enforce native HTML constraints as well.
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const editingId = employeeIdInput.value.trim();
    const editing = Boolean(editingId);

    const name = nameInput.value.trim();
    const email = normalizeEmail(emailInput.value);
    const password = passwordInput.value;
    const department = departmentInput.value.trim();
    const salaryValue = salaryInput.value;

    const validationError = validateEmployeeForm({
      name,
      email,
      password,
      department,
      salaryValue,
      editing,
    });

    if (validationError) {
      showMessage(formMessage, validationError, "error");
      return;
    }

    const salary = Number(salaryValue);

    let users = storage.getUsers();

    if (!Array.isArray(users)) {
      showMessage(
        formMessage,
        "Unable to read user data. Please check browser storage.",
        "error",
      );
      return;
    }

    let existingEmployee = null;

    if (editing) {
      existingEmployee = users.find(
        (user) =>
          user && String(user.id) === editingId && user.role === "employee",
      );

      if (!existingEmployee) {
        showMessage(
          formMessage,
          "This employee no longer exists. Refresh the directory and try again.",
          "error",
        );

        resetEmployeeForm();
        renderPage();
        return;
      }
    }

    // Email must be unique across Admin and Employee accounts.
    // During editing, the current employee's own email is allowed.
    const duplicateEmail = users.some((user) => {
      if (!user) return false;

      const sameEmail = normalizeEmail(user.email) === email;

      const isDifferentAccount = String(user.id) !== editingId;

      return sameEmail && isDifferentAccount;
    });

    if (duplicateEmail) {
      showMessage(
        formMessage,
        "This email address is already registered. Use a different email.",
        "error",
      );

      emailInput.focus();
      return;
    }

    let updatedUsers;
    let successMessage;

    if (editing) {
      const updatedEmployee = {
        ...existingEmployee,
        name,
        email,
        department,
        salary,
      };

      // Keep the current password unless a new password is supplied.
      if (password.length > 0) {
        updatedEmployee.password = password;
      }

      updatedUsers = users.map((user) =>
        String(user.id) === editingId ? updatedEmployee : user,
      );

      successMessage = `${name}'s details have been updated successfully.`;
    } else {
      const newEmployee = {
        id: createEmployeeId(users),
        name,
        email,
        password,
        role: "employee",
        department,
        salary,
      };

      // The login account is created in the same users array.
      updatedUsers = [...users, newEmployee];

      successMessage = `${name} has been added successfully. Their employee login account has been created.`;
    }

    // Persist all changes; don't report success if saving fails.
    const saved = storage.saveUsers(updatedUsers);

    if (!saved) {
      showMessage(
        formMessage,
        "Could not save employee data. Please check browser storage and try again.",
        "error",
      );
      return;
    }

    resetEmployeeForm();

    // Remove filters so the newly added or edited employee is visible.
    clearFilters(false);

    renderPage();

    showMessage(formMessage, successMessage, "success");
  }

  // -----------------------------------------------------
  // 13. EDIT AN EMPLOYEE
  // -----------------------------------------------------

  function startEditing(employeeId) {
    const employee = getEmployees().find(
      (item) => String(item.id) === String(employeeId),
    );

    if (!employee) {
      showMessage(
        listMessage,
        "Employee not found. Refresh the directory and try again.",
        "error",
      );
      return;
    }

    clearMessage(listMessage);
    clearMessage(formMessage);

    employeeIdInput.value = String(employee.id);

    nameInput.value = employee.name || "";
    emailInput.value = employee.email || "";
    departmentInput.value = employee.department || "";
    salaryInput.value = employee.salary ?? "";

    // Empty password keeps the existing password during edit.
    passwordInput.value = "";
    passwordInput.required = false;

    passwordInput.placeholder = "Leave blank to keep existing password";

    if (passwordHelp) {
      passwordHelp.textContent =
        "Optional while editing. Enter a new password only if you want to change it.";
    }

    if (formHeading) {
      formHeading.textContent = "Edit Employee";
    }

    if (formDescription) {
      formDescription.textContent =
        "Update this employee's details and save your changes.";
    }

    submitButton.textContent = "Update Employee";

    cancelEditButton.hidden = false;

    $("employee-form-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    nameInput.focus();
  }

  // -----------------------------------------------------
  // 14. DELETE AN EMPLOYEE
  // -----------------------------------------------------

  function deleteEmployee(employeeId) {
    const users = storage.getUsers();

    const employee = users.find(
      (user) =>
        user &&
        String(user.id) === String(employeeId) &&
        user.role === "employee",
    );

    if (!employee) {
      showMessage(
        listMessage,
        "Employee not found. Refresh the directory and try again.",
        "error",
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete employee "${employee.name}" and their login account?\n\n` +
        "This removes the employee account from the current user list.",
    );

    if (!confirmed) {
      return;
    }

    const updatedUsers = users.filter(
      (user) => String(user.id) !== String(employee.id),
    );

    const saved = storage.saveUsers(updatedUsers);

    if (!saved) {
      showMessage(
        listMessage,
        "Could not delete the employee. Please try again.",
        "error",
      );
      return;
    }

    // Historical attendance and leave records are not deleted here.
    // They remain stored with their employee IDs.

    if (String(employeeIdInput.value) === String(employee.id)) {
      resetEmployeeForm();
    }

    renderPage();

    showMessage(
      listMessage,
      `${employee.name}'s employee account has been deleted.`,
      "success",
    );
  }

  // -----------------------------------------------------
  // 15. TABLE ACTIONS — EVENT DELEGATION
  // -----------------------------------------------------

  function handleTableClick(event) {
    const button = event.target.closest(
      "button[data-action][data-employee-id]",
    );

    if (!button || !tableBody.contains(button)) {
      return;
    }

    const employeeId = button.dataset.employeeId;
    const action = button.dataset.action;

    if (action === "edit") {
      startEditing(employeeId);
    } else if (action === "delete") {
      deleteEmployee(employeeId);
    }
  }

  // -----------------------------------------------------
  // 16. REGISTER EVENT LISTENERS
  // -----------------------------------------------------

  function initializeEvents() {
    form.addEventListener("submit", handleEmployeeSubmit);

    searchInput.addEventListener("input", () => {
      clearMessage(listMessage);
      renderPage();
    });

    departmentFilter.addEventListener("change", () => {
      clearMessage(listMessage);
      renderPage();
    });

    clearFiltersButton.addEventListener("click", () => {
      clearFilters();
    });

    cancelEditButton.addEventListener("click", () => {
      resetEmployeeForm();
    });

    tableBody.addEventListener("click", handleTableClick);

    const logoutButton = $("logout-button");

    if (logoutButton) {
      logoutButton.addEventListener("click", () => {
        auth.logout();
      });
    }
  }

  // -----------------------------------------------------
  // 17. INITIALIZE EMPLOYEE PAGE
  // -----------------------------------------------------

  function init() {
    try {
      initializeProfile();
      initializeEvents();
      resetEmployeeForm();
      renderPage();

      console.log("[HCM Lite] Employee management initialized.");
    } catch (error) {
      console.error(
        "[HCM Lite] Failed to initialize employee management.",
        error,
      );

      showMessage(
        formMessage,
        "Employee management could not start. Check the Console for errors.",
        "error",
      );
    }
  }

  init();
})();
