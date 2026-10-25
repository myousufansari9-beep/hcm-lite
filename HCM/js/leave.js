/* =========================================================
   HCM LITE — SHARED LEAVE MANAGEMENT MODULE

   Employee:
   - Apply for leave
   - Validate dates, overlap and quota
   - View personal leave history
   - View remaining leave balance

   Admin:
   - View all leave requests
   - Search and filter requests
   - Approve / reject pending requests
   - Require an Admin comment
   - Update dashboard pending-leave table

   Storage:
   - Uses HCMStorage.getLeaves()
   - Uses HCMStorage.saveLeaves()
   - Uses hcm_users for employee information
   - Uses hcm_company for working days and yearly quota
========================================================= */

(() => {
  "use strict";

  // -----------------------------------------------------
  // 1. DEPENDENCIES AND PAGE DETECTION
  // -----------------------------------------------------

  if (!window.HCMStorage || !window.HCMAuth) {
    console.error("[HCM Lite] leave.js requires storage.js and auth.js.");
    return;
  }

  const storage = window.HCMStorage;
  const auth = window.HCMAuth;

  const $ = (id) => document.getElementById(id);

  const isEmployeePage = Boolean(
    $("employee-leave-form") && $("employee-leave-history-body"),
  );

  const isLeaveManagementPage = Boolean(
    $("leave-requests-body") && $("leave-review-dialog"),
  );

  const isAdminDashboard = Boolean(
    $("pending-leaves-body") && !isLeaveManagementPage,
  );

  if (!isEmployeePage && !isLeaveManagementPage && !isAdminDashboard) {
    return;
  }

  const currentUser = auth.requireAuth(isEmployeePage ? "employee" : "admin");

  if (!currentUser) {
    return;
  }

  // -----------------------------------------------------
  // 2. CONSTANTS
  // -----------------------------------------------------

  const VALID_DAYS = Object.freeze([
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]);

  const DEFAULT_WORKING_DAYS = Object.freeze([
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
  ]);

  const DEFAULT_YEARLY_QUOTA = 20;

  const ACTIVE_LEAVE_STATUSES = new Set(["pending", "approved"]);

  // -----------------------------------------------------
  // 3. GENERAL HELPERS
  // -----------------------------------------------------

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
  }

  function normalizeStatus(value) {
    return normalizeText(value).toLowerCase().replace(/[_-]+/g, " ");
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

  function getUsers() {
    const users = storage.getUsers();
    return Array.isArray(users) ? users : [];
  }

  function getEmployees() {
    return getUsers().filter((user) => user && user.role === "employee");
  }

  function getLeaves() {
    const leaves = storage.getLeaves();
    return Array.isArray(leaves) ? leaves : [];
  }

  function getCompany() {
    return storage.getCompany() || {};
  }

  function getEmployeeById(employeeId) {
    return (
      getEmployees().find(
        (employee) => String(employee.id) === String(employeeId),
      ) || null
    );
  }

  // -----------------------------------------------------
  // 4. DATE HELPERS
  // Use local calendar dates to avoid UTC date shifts.
  // -----------------------------------------------------

  function parseDateKey(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(year, month - 1, day, 12, 0, 0, 0);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  function dateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function formatDate(value) {
    const date = parseDateKey(value);

    if (!date) return "—";

    return new Intl.DateTimeFormat("en-PK", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function isValidDateRange(from, to) {
    const fromDate = parseDateKey(from);
    const toDate = parseDateKey(to);

    return Boolean(fromDate && toDate && from <= to);
  }

  function getYearFromDateKey(value) {
    const date = parseDateKey(value);

    return date ? String(date.getFullYear()) : null;
  }

  // -----------------------------------------------------
  // 5. COMPANY LEAVE POLICY
  // -----------------------------------------------------

  function getPolicy() {
    const company = getCompany();

    const configuredDays = Array.isArray(company.workingDays)
      ? company.workingDays
      : DEFAULT_WORKING_DAYS;

    const workingDays = VALID_DAYS.filter((day) =>
      configuredDays.some(
        (configuredDay) =>
          String(configuredDay).toLowerCase() === day.toLowerCase(),
      ),
    );

    const rawQuota = Number(company.yearlyLeaveQuota);

    const yearlyQuota =
      company.yearlyLeaveQuota !== undefined &&
      company.yearlyLeaveQuota !== null &&
      Number.isInteger(rawQuota) &&
      rawQuota >= 0 &&
      rawQuota <= 366
        ? rawQuota
        : DEFAULT_YEARLY_QUOTA;

    return {
      workingDays: workingDays.length ? workingDays : [...DEFAULT_WORKING_DAYS],

      yearlyQuota,
    };
  }

  // -----------------------------------------------------
  // 6. COUNT WORKING DAYS
  // Supports working days configured in company settings.
  // Returns a breakdown by calendar year.
  // -----------------------------------------------------

  function calculateYearDays(from, to, workingDays = getPolicy().workingDays) {
    const fromDate = parseDateKey(from);
    const toDate = parseDateKey(to);

    if (!fromDate || !toDate || from > to) {
      return {};
    }

    const allowedDays = new Set(workingDays.map((day) => day.toLowerCase()));

    const result = {};

    const cursor = new Date(fromDate);

    while (cursor <= toDate) {
      const weekday = VALID_DAYS[(cursor.getDay() + 6) % 7];

      if (allowedDays.has(weekday.toLowerCase())) {
        const year = String(cursor.getFullYear());

        result[year] = (result[year] || 0) + 1;
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }

  function sumYearDays(yearDays) {
    return Object.values(yearDays).reduce(
      (total, days) => total + Number(days || 0),
      0,
    );
  }

  function getYearDaysForLeave(leave) {
    // Preserve the working-day calculation captured when
    // the leave was submitted. This avoids recalculating
    // historical requests if company settings later change.
    if (
      leave &&
      leave.yearDays &&
      typeof leave.yearDays === "object" &&
      !Array.isArray(leave.yearDays)
    ) {
      const entries = Object.entries(leave.yearDays);

      const validEntries = entries.every(
        ([year, days]) =>
          /^\d{4}$/.test(year) &&
          Number.isInteger(Number(days)) &&
          Number(days) >= 0,
      );

      if (validEntries && entries.length > 0) {
        return Object.fromEntries(
          entries.map(([year, days]) => [year, Number(days)]),
        );
      }
    }

    return calculateYearDays(leave?.from, leave?.to);
  }

  // -----------------------------------------------------
  // 7. OVERLAP PREVENTION
  // Pending and approved requests reserve the date range.
  // Rejected requests do not block a new application.
  // -----------------------------------------------------

  function hasOverlappingLeave(employeeId, from, to) {
    return getLeaves().some((leave) => {
      if (
        String(leave.employeeId) !== String(employeeId) ||
        !ACTIVE_LEAVE_STATUSES.has(normalizeStatus(leave.status))
      ) {
        return false;
      }

      if (!parseDateKey(leave.from) || !parseDateKey(leave.to)) {
        return false;
      }

      return from <= String(leave.to) && to >= String(leave.from);
    });
  }

  // -----------------------------------------------------
  // 8. YEARLY QUOTA CALCULATIONS
  // -----------------------------------------------------

  function getUsedDaysByYear(employeeId, statuses, excludeId = null) {
    const used = {};

    getLeaves().forEach((leave) => {
      if (
        String(leave.employeeId) !== String(employeeId) ||
        !statuses.has(normalizeStatus(leave.status)) ||
        (excludeId !== null && String(leave.id) === String(excludeId))
      ) {
        return;
      }

      const distribution = getYearDaysForLeave(leave);

      Object.entries(distribution).forEach(([year, days]) => {
        used[year] = (used[year] || 0) + Number(days || 0);
      });
    });

    return used;
  }

  function validateQuotaForApplication(employeeId, requestedYearDays) {
    const quota = getPolicy().yearlyQuota;

    // Pending requests also reserve quota to avoid oversubscription.
    const used = getUsedDaysByYear(employeeId, ACTIVE_LEAVE_STATUSES);

    for (const [year, requestedDays] of Object.entries(requestedYearDays)) {
      const alreadyUsed = used[year] || 0;

      if (alreadyUsed + requestedDays > quota) {
        return (
          `This request exceeds your yearly leave quota for ${year}. ` +
          `${alreadyUsed} day(s) are already approved or pending, ` +
          `and your yearly limit is ${quota} day(s).`
        );
      }
    }

    return "";
  }

  function validateQuotaForApproval(leave) {
    const quota = getPolicy().yearlyQuota;

    // Recheck against approved leave at the time of approval.
    // Other pending requests are excluded here; each approval
    // is checked independently against the latest approved records.
    const used = getUsedDaysByYear(
      leave.employeeId,
      new Set(["approved"]),
      leave.id,
    );

    const requestedYearDays = getYearDaysForLeave(leave);

    for (const [year, requestedDays] of Object.entries(requestedYearDays)) {
      const alreadyApproved = used[year] || 0;

      if (alreadyApproved + requestedDays > quota) {
        return (
          `This request cannot be approved because the yearly quota ` +
          `for ${year} would be exceeded. Approved leave: ` +
          `${alreadyApproved} day(s); request: ${requestedDays} day(s); ` +
          `quota: ${quota} day(s).`
        );
      }
    }

    return "";
  }

  // -----------------------------------------------------
  // 9. STATUS, BADGE AND DOM HELPERS
  // -----------------------------------------------------

  function formatStatus(status) {
    return String(status || "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function createStatusBadge(status) {
    const badge = document.createElement("span");

    const normalized = normalizeStatus(status);

    badge.className = "status-badge";

    const classMap = {
      pending: "status-pending",
      approved: "status-approved",
      rejected: "status-rejected",
    };

    if (classMap[normalized]) {
      badge.classList.add(classMap[normalized]);
    }

    badge.textContent = formatStatus(status);

    return badge;
  }

  function createCell(value, className = "") {
    const cell = document.createElement("td");

    if (className) {
      cell.className = className;
    }

    cell.textContent =
      value === undefined || value === null || value === ""
        ? "—"
        : String(value);

    return cell;
  }

  function createButton(label, className, attributes = {}) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = className;
    button.textContent = label;

    Object.entries(attributes).forEach(([key, value]) => {
      button.dataset[key] = String(value);
    });

    return button;
  }

  function createUniqueId(leaves) {
    let id = Date.now();

    while (leaves.some((leave) => String(leave.id) === String(id))) {
      id += 1;
    }

    return id;
  }

  // -----------------------------------------------------
  // 10. LEAVE FORM — EMPLOYEE
  // -----------------------------------------------------

  function initializeEmployeeLeaveForm() {
    const form = $("employee-leave-form");

    if (!form) return;

    const typeInput = $("employee-leave-type");
    const fromInput = $("employee-leave-from");
    const toInput = $("employee-leave-to");
    const reasonInput = $("employee-leave-reason");
    const message = $("employee-leave-message");

    if (!typeInput || !fromInput || !toInput || !reasonInput || !message) {
      console.error("[HCM Lite] Employee leave form has missing fields.");
      return;
    }

    function submitLeaveRequest(event) {
      event.preventDefault();

      clearMessage(message);

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const type = normalizeText(typeInput.value).toLowerCase();
      const from = fromInput.value;
      const to = toInput.value;
      const reason = normalizeText(reasonInput.value);

      if (!["casual", "sick", "annual"].includes(type)) {
        showMessage(message, "Please select a valid leave type.", "error");
        return;
      }

      if (!isValidDateRange(from, to)) {
        showMessage(
          message,
          "Please choose valid leave dates. The From Date cannot be after the To Date.",
          "error",
        );
        fromInput.focus();
        return;
      }

      if (!reason) {
        showMessage(
          message,
          "Please enter a reason for your leave request.",
          "error",
        );
        reasonInput.focus();
        return;
      }

      if (hasOverlappingLeave(currentUser.id, from, to)) {
        showMessage(
          message,
          "These dates overlap with an existing pending or approved leave request.",
          "error",
        );
        return;
      }

      const yearDays = calculateYearDays(from, to);
      const days = sumYearDays(yearDays);

      if (days <= 0) {
        showMessage(
          message,
          "The selected date range contains no configured working days. Please choose different dates or contact your Admin.",
          "error",
        );
        return;
      }

      const quotaError = validateQuotaForApplication(currentUser.id, yearDays);

      if (quotaError) {
        showMessage(message, quotaError, "error");
        return;
      }

      const existingLeaves = getLeaves();

      const leaveRequest = {
        id: createUniqueId(existingLeaves),
        employeeId: currentUser.id,
        type,
        from,
        to,
        days,
        yearDays,
        reason,
        status: "pending",
        comment: "",
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reviewedBy: null,
      };

      const saved = storage.saveLeaves([...existingLeaves, leaveRequest]);

      if (!saved) {
        showMessage(
          message,
          "Your leave request could not be saved. Check browser storage and try again.",
          "error",
        );
        return;
      }

      form.reset();

      toInput.min = fromInput.value || "";

      renderEmployeeLeaveData();

      showMessage(
        message,
        `Leave request submitted successfully for ${days} working day(s). Its current status is Pending.`,
        "success",
      );

      notifyLeaveDataChanged();
    }

    // Keep the end-date picker consistent with the start date.
    fromInput.addEventListener("change", () => {
      toInput.min = fromInput.value || "";

      if (fromInput.value && toInput.value && toInput.value < fromInput.value) {
        toInput.value = "";
      }
    });

    form.addEventListener("submit", submitLeaveRequest);

    form.addEventListener("reset", () => {
      window.setTimeout(() => {
        clearMessage(message);
        toInput.min = fromInput.value || "";
      }, 0);
    });
  }

  // -----------------------------------------------------
  // 11. EMPLOYEE LEAVE BALANCE
  // -----------------------------------------------------

  function renderEmployeeLeaveBalance() {
    const policy = getPolicy();

    const currentYear = String(new Date().getFullYear());

    const usedByYear = getUsedDaysByYear(currentUser.id, new Set(["approved"]));

    const usedDays = usedByYear[currentYear] || 0;

    const remainingDays = Math.max(0, policy.yearlyQuota - usedDays);

    setText("employee-leave-quota", `${policy.yearlyQuota} Days`);

    setText("employee-leave-used", `${usedDays} Days`);

    setText("employee-leave-balance", `${remainingDays} Days`);

    setText("employee-leave-remaining", remainingDays);
  }

  // -----------------------------------------------------
  // 12. EMPLOYEE LEAVE HISTORY
  // -----------------------------------------------------

  function renderEmployeeLeaveHistory() {
    const tbody = $("employee-leave-history-body");

    if (!tbody) return;

    const emptyState = $("employee-leave-history-empty");

    tbody
      .querySelectorAll("[data-generated-row='true']")
      .forEach((row) => row.remove());

    const personalLeaves = getLeaves()
      .filter((leave) => String(leave.employeeId) === String(currentUser.id))
      .sort((a, b) =>
        String(b.createdAt || b.from || "").localeCompare(
          String(a.createdAt || a.from || ""),
        ),
      );

    personalLeaves.forEach((leave) => {
      const row = document.createElement("tr");

      row.dataset.generatedRow = "true";

      row.append(
        createCell(formatStatus(leave.type)),
        createCell(formatDate(leave.from)),
        createCell(formatDate(leave.to)),
        createCell(leave.days),
      );

      const statusCell = document.createElement("td");

      statusCell.appendChild(createStatusBadge(leave.status));

      row.appendChild(statusCell);

      row.appendChild(createCell(leave.comment || "No comment"));

      tbody.appendChild(row);
    });

    if (emptyState) {
      emptyState.hidden = personalLeaves.length > 0;
    }

    setText(
      "employee-leave-record-count",
      `${personalLeaves.length} ${
        personalLeaves.length === 1 ? "Request" : "Requests"
      }`,
    );

    renderEmployeeLeaveBalance();
  }

  function renderEmployeeLeaveData() {
    renderEmployeeLeaveHistory();

    // Leave changes can affect the Employee Dashboard's attendance
    // summary, so refresh it if that module has exposed its API.
    if (window.HCMAttendance) {
      window.HCMAttendance.refresh();
    }
  }

  // -----------------------------------------------------
  // 13. ADMIN PROFILE AND LOGOUT
  // -----------------------------------------------------

  function getInitials(name) {
    return (
      String(name || "Admin")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("") || "A"
    );
  }

  function initializeAdminProfile() {
    const name = currentUser.name || "Admin";
    const initials = getInitials(name);

    setText("sidebar-admin-name", name);
    setText("admin-name", name);
    setText(
      "current-date",
      new Intl.DateTimeFormat("en-PK", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date()),
    );

    ["sidebar-admin-avatar", "admin-avatar"].forEach((id) => {
      const avatar = $(id);

      if (avatar) {
        avatar.textContent = initials;
      }
    });
  }

  function initializeAdminLogout() {
    // Only leaves.html needs its own logout handler.
    // admin.js and attendance.js already bind logout on their pages.
    if (!isLeaveManagementPage) return;

    const button = $("logout-button");

    if (button) {
      button.addEventListener("click", () => {
        auth.logout();
      });
    }
  }

  // -----------------------------------------------------
  // 14. ADMIN SUMMARY CARDS AND FILTERS
  // -----------------------------------------------------

  function renderAdminSummary(allLeaves) {
    const pending = allLeaves.filter(
      (leave) => normalizeStatus(leave.status) === "pending",
    ).length;

    const approved = allLeaves.filter(
      (leave) => normalizeStatus(leave.status) === "approved",
    ).length;

    const rejected = allLeaves.filter(
      (leave) => normalizeStatus(leave.status) === "rejected",
    ).length;

    setText("leaves-total-count", allLeaves.length);
    setText("leaves-pending-count", pending);
    setText("leaves-approved-count", approved);
    setText("leaves-rejected-count", rejected);

    setText("leaves-pending-sidebar-count", pending);
    setText("nav-pending-leaves-count", pending);
  }

  function getFilteredAdminLeaves(allLeaves) {
    const search = normalizeText($("leave-search")?.value).toLowerCase();

    const statusFilter = normalizeStatus(
      $("leave-status-filter")?.value || "all",
    );

    const typeFilter = normalizeStatus($("leave-type-filter")?.value || "all");

    const employeesById = new Map(
      getEmployees().map((employee) => [String(employee.id), employee]),
    );

    return allLeaves.filter((leave) => {
      const employee = employeesById.get(String(leave.employeeId));

      const name = normalizeText(employee?.name).toLowerCase();
      const email = normalizeEmail(employee?.email);
      const type = normalizeStatus(leave.type);
      const status = normalizeStatus(leave.status);

      const matchesSearch =
        !search || name.includes(search) || email.includes(search);

      const matchesStatus = statusFilter === "all" || status === statusFilter;

      const matchesType = typeFilter === "all" || type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }

  // -----------------------------------------------------
  // 15. ADMIN LEAVE MANAGEMENT TABLE
  // -----------------------------------------------------

  function renderAdminLeaveTable() {
    const tbody = $("leave-requests-body");

    if (!tbody) return;

    const emptyState = $("leave-requests-empty-state");

    tbody
      .querySelectorAll("[data-generated-row='true']")
      .forEach((row) => row.remove());

    const allLeaves = getLeaves();

    renderAdminSummary(allLeaves);

    const employeesById = new Map(
      getEmployees().map((employee) => [String(employee.id), employee]),
    );

    const filteredLeaves = getFilteredAdminLeaves(allLeaves).sort((a, b) =>
      String(b.createdAt || b.from || "").localeCompare(
        String(a.createdAt || a.from || ""),
      ),
    );

    filteredLeaves.forEach((leave) => {
      const employee = employeesById.get(String(leave.employeeId));

      const employeeName = employee ? employee.name : "Unknown employee";

      const row = document.createElement("tr");

      row.dataset.generatedRow = "true";
      row.dataset.leaveId = String(leave.id);

      row.append(
        createCell(employeeName, "leave-employee-name"),
        createCell(formatStatus(leave.type)),
        createCell(
          `${formatDate(leave.from)} – ${formatDate(leave.to)}`,
          "leave-date-range",
        ),
        createCell(leave.days),
        createCell(leave.reason, "leave-reason-cell"),
      );

      const statusCell = document.createElement("td");

      statusCell.appendChild(createStatusBadge(leave.status));

      row.appendChild(statusCell);

      row.appendChild(createCell(leave.comment || "—", "leave-comment-cell"));

      const actionsCell = document.createElement("td");

      if (normalizeStatus(leave.status) === "pending") {
        actionsCell.appendChild(
          createButton("Review", "leave-table-action leave-review-action", {
            leaveAction: "review",
            leaveId: leave.id,
          }),
        );
      } else {
        const reviewedLabel = document.createElement("span");

        reviewedLabel.className = "stat-label";
        reviewedLabel.textContent = "Reviewed";

        actionsCell.appendChild(reviewedLabel);
      }

      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });

    if (emptyState) {
      emptyState.hidden = filteredLeaves.length > 0;
    }

    setText(
      "leave-requests-count",
      `${filteredLeaves.length} ${
        filteredLeaves.length === 1 ? "Request" : "Requests"
      }`,
    );

    setText(
      "leave-requests-summary",
      `Showing ${filteredLeaves.length} of ${allLeaves.length} leave requests.`,
    );
  }

  // -----------------------------------------------------
  // 16. ADMIN DASHBOARD — PENDING REQUESTS
  // -----------------------------------------------------

  function renderAdminDashboardPendingLeaves() {
    const tbody = $("pending-leaves-body");

    if (!tbody) return;

    const emptyState = $("leave-empty-state");

    tbody
      .querySelectorAll("[data-generated-row='true']")
      .forEach((row) => row.remove());

    const pendingLeaves = getLeaves()
      .filter((leave) => normalizeStatus(leave.status) === "pending")
      .sort((a, b) =>
        String(b.createdAt || b.from || "").localeCompare(
          String(a.createdAt || a.from || ""),
        ),
      );

    const employeesById = new Map(
      getEmployees().map((employee) => [String(employee.id), employee]),
    );

    pendingLeaves.forEach((leave) => {
      const employee = employeesById.get(String(leave.employeeId));

      const row = document.createElement("tr");

      row.dataset.generatedRow = "true";

      row.append(
        createCell(employee?.name || "Unknown employee"),
        createCell(formatStatus(leave.type)),
        createCell(`${formatDate(leave.from)} – ${formatDate(leave.to)}`),
        createCell(leave.days),
      );

      const statusCell = document.createElement("td");

      statusCell.appendChild(createStatusBadge(leave.status));

      row.appendChild(statusCell);

      const actionsCell = document.createElement("td");
      const reviewLink = document.createElement("a");

      reviewLink.href = "leaves.html";
      reviewLink.className = "text-link";
      reviewLink.textContent = "Review";

      actionsCell.appendChild(reviewLink);
      row.appendChild(actionsCell);

      tbody.appendChild(row);
    });

    if (emptyState) {
      emptyState.hidden = pendingLeaves.length > 0;
    }

    setText("nav-pending-leaves-count", pendingLeaves.length);
  }

  // -----------------------------------------------------
  // 17. ADMIN REVIEW DIALOG
  // -----------------------------------------------------

  function openReviewDialog(leaveId) {
    const leave = getLeaves().find(
      (item) => String(item.id) === String(leaveId),
    );

    if (!leave || normalizeStatus(leave.status) !== "pending") {
      showMessage(
        $("leave-list-message"),
        "This request is no longer pending. Refresh the table and try again.",
        "error",
      );

      renderAdminLeaveTable();
      return;
    }

    const employee = getEmployeeById(leave.employeeId);
    const dialog = $("leave-review-dialog");

    setText("review-employee-name", employee?.name || "Unknown employee");

    setText(
      "review-leave-period",
      `${formatDate(leave.from)} – ${formatDate(leave.to)}`,
    );

    setText("review-leave-days", `${leave.days} working day(s)`);

    $("review-leave-id").value = String(leave.id);
    $("review-leave-decision").value = "";

    $("leave-review-comment").value = "";

    showMessage($("leave-review-message"), "", "success");

    if (dialog && typeof dialog.showModal === "function") {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog) {
      dialog.setAttribute("open", "");
    }
  }

  function closeReviewDialog() {
    const dialog = $("leave-review-dialog");

    if (!dialog) return;

    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  // -----------------------------------------------------
  // 18. ADMIN APPROVE / REJECT
  // -----------------------------------------------------

  function handleReviewDecision(decision) {
    const reviewMessage = $("leave-review-message");

    clearMessage(reviewMessage);

    if (!["approved", "rejected"].includes(decision)) {
      showMessage(
        reviewMessage,
        "Please choose a valid review decision.",
        "error",
      );
      return;
    }

    const leaveId = $("review-leave-id").value;
    const comment = normalizeText($("leave-review-comment").value);

    if (!leaveId) {
      showMessage(
        reviewMessage,
        "No leave request has been selected.",
        "error",
      );
      return;
    }

    if (!comment) {
      showMessage(
        reviewMessage,
        "An Admin comment is required before approving or rejecting a request.",
        "error",
      );

      $("leave-review-comment").focus();
      return;
    }

    const leaves = getLeaves();

    const index = leaves.findIndex(
      (leave) => String(leave.id) === String(leaveId),
    );

    if (index < 0) {
      showMessage(
        reviewMessage,
        "The selected request no longer exists.",
        "error",
      );
      return;
    }

    const selectedLeave = leaves[index];

    if (normalizeStatus(selectedLeave.status) !== "pending") {
      showMessage(
        reviewMessage,
        "This request has already been reviewed.",
        "error",
      );
      return;
    }

    // Recheck quota at approval time in case company settings or
    // other approved requests have changed since submission.
    if (decision === "approved") {
      const quotaError = validateQuotaForApproval(selectedLeave);

      if (quotaError) {
        showMessage(reviewMessage, quotaError, "error");
        return;
      }
    }

    const updatedLeave = {
      ...selectedLeave,
      status: decision,
      comment,
      reviewedAt: new Date().toISOString(),
      reviewedBy: currentUser.id,
    };

    const updatedLeaves = [...leaves];

    updatedLeaves[index] = updatedLeave;

    const saved = storage.saveLeaves(updatedLeaves);

    if (!saved) {
      showMessage(
        reviewMessage,
        "The review decision could not be saved. Please try again.",
        "error",
      );
      return;
    }

    closeReviewDialog();

    if (isLeaveManagementPage) {
      renderAdminLeaveTable();
    }

    if (isAdminDashboard) {
      renderAdminDashboardPendingLeaves();
    }

    if (window.HCMAttendance) {
      window.HCMAttendance.refresh();
    }

    showMessage(
      $("leave-list-message"),
      `Leave request ${decision} successfully.`,
      "success",
    );

    notifyLeaveDataChanged();

    console.log("[HCM Lite] Leave request reviewed.", {
      leaveId,
      decision,
      reviewedBy: currentUser.id,
    });
  }

  // -----------------------------------------------------
  // 19. ADMIN PAGE EVENTS
  // -----------------------------------------------------

  function initializeAdminLeaveManagement() {
    initializeAdminProfile();
    initializeAdminLogout();

    const searchInput = $("leave-search");
    const statusFilter = $("leave-status-filter");
    const typeFilter = $("leave-type-filter");
    const clearFiltersButton = $("clear-leave-filters");

    const tbody = $("leave-requests-body");

    const dialog = $("leave-review-dialog");

    const closeButton = $("cancel-leave-review-button");

    const approveButton = $("approve-leave-button");
    const rejectButton = $("reject-leave-button");

    const reviewForm = $("leave-review-form");

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        renderAdminLeaveTable();
      });
    }

    if (statusFilter) {
      statusFilter.addEventListener("change", () => {
        renderAdminLeaveTable();
      });
    }

    if (typeFilter) {
      typeFilter.addEventListener("change", () => {
        renderAdminLeaveTable();
      });
    }

    if (clearFiltersButton) {
      clearFiltersButton.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";

        if (statusFilter) statusFilter.value = "all";

        if (typeFilter) typeFilter.value = "all";

        clearMessage($("leave-list-message"));

        renderAdminLeaveTable();
      });
    }

    if (tbody) {
      tbody.addEventListener("click", (event) => {
        const button = event.target.closest(
          "button[data-leave-action='review'][data-leave-id]",
        );

        if (!button || !tbody.contains(button)) {
          return;
        }

        openReviewDialog(button.dataset.leaveId);
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", closeReviewDialog);
    }

    if (dialog) {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          closeReviewDialog();
        }
      });
    }

    if (reviewForm) {
      reviewForm.addEventListener("submit", (event) => {
        event.preventDefault();
      });
    }

    if (approveButton) {
      approveButton.addEventListener("click", () => {
        $("review-leave-decision").value = "approved";
        handleReviewDecision("approved");
      });
    }

    if (rejectButton) {
      rejectButton.addEventListener("click", () => {
        $("review-leave-decision").value = "rejected";
        handleReviewDecision("rejected");
      });
    }

    renderAdminLeaveTable();
  }

  // -----------------------------------------------------
  // 20. SHARED DATA-CHANGE NOTIFICATION
  // -----------------------------------------------------

  function notifyLeaveDataChanged() {
    window.dispatchEvent(
      new CustomEvent("hcm:leaves-updated", {
        detail: {
          employeeId: currentUser.id,
          role: currentUser.role,
        },
      }),
    );
  }

  // -----------------------------------------------------
  // 21. CROSS-TAB SYNCHRONIZATION
  // -----------------------------------------------------

  window.addEventListener("storage", (event) => {
    const watchedKeys = ["hcm_leaves", "hcm_users", "hcm_company"];

    if (event.key === null || watchedKeys.includes(event.key)) {
      refreshCurrentPage();
    }
  });

  // -----------------------------------------------------
  // 22. REFRESH CURRENT PAGE
  // -----------------------------------------------------

  function refreshCurrentPage() {
    if (isEmployeePage) {
      renderEmployeeLeaveData();
    }

    if (isLeaveManagementPage) {
      renderAdminLeaveTable();
    }

    if (isAdminDashboard) {
      renderAdminDashboardPendingLeaves();

      if (window.HCMAttendance) {
        window.HCMAttendance.refresh();
      }
    }
  }

  // -----------------------------------------------------
  // 23. INITIALIZE
  // -----------------------------------------------------

  function init() {
    if (isEmployeePage) {
      initializeEmployeeLeaveForm();
      renderEmployeeLeaveData();
    }

    if (isLeaveManagementPage) {
      initializeAdminLeaveManagement();
    }

    if (isAdminDashboard) {
      renderAdminDashboardPendingLeaves();
    }

    console.log(`[HCM Lite] Leave module initialized for ${currentUser.role}.`);
  }

  init();

  // -----------------------------------------------------
  // 24. PUBLIC API
  // -----------------------------------------------------

  window.HCMLeave = Object.freeze({
    refresh: refreshCurrentPage,
    calculateYearDays,
    getYearDaysForLeave,
    getUsedDaysByYear,
    hasOverlappingLeave,
  });
})();
