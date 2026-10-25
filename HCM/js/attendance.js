/* =========================================================
   HCM LITE — ATTENDANCE MODULE

   Shared by:
   - Admin Dashboard
   - Employee Dashboard

   Features:
   - One check-in per employee per day
   - Check-out only after check-in
   - Late detection using company settings
   - Half-day detection for work under 5 hours
   - Attendance history for the logged-in employee
   - Today's attendance table for Admin
   - Present, late, on-leave and absent summaries
   - Persistent records using HCMStorage
   - Cross-tab refresh when localStorage changes
========================================================= */

(() => {
  "use strict";

  // -----------------------------------------------------
  // 1. DEPENDENCIES AND PAGE DETECTION
  // -----------------------------------------------------

  if (!window.HCMStorage || !window.HCMAuth) {
    console.error("[HCM Lite] attendance.js requires storage.js and auth.js.");
    return;
  }

  const storage = window.HCMStorage;
  const auth = window.HCMAuth;

  const $ = (id) => document.getElementById(id);

  const isEmployeePage = Boolean(
    $("employee-check-in-button") && $("employee-check-out-button"),
  );

  const isAdminPage = Boolean($("attendance-table-body") && !isEmployeePage);

  // This module is intended for the two dashboard pages only.
  if (!isEmployeePage && !isAdminPage) {
    return;
  }

  const currentUser = auth.requireAuth(isEmployeePage ? "employee" : "admin");

  if (!currentUser) {
    return;
  }

  // -----------------------------------------------------
  // 2. CONSTANTS AND SETTINGS
  // -----------------------------------------------------

  const MIN_HALF_DAY_MINUTES = 5 * 60;

  const DEFAULT_COMPANY_SETTINGS = {
    officeStartTime: "09:00",
    graceMinutes: 15,
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  };

  // -----------------------------------------------------
  // 3. GENERAL HELPERS
  // -----------------------------------------------------

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function normalizeStatus(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ");
  }

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent = String(value);
    }
  }

  function getUsers() {
    const users = storage.getUsers();
    return Array.isArray(users) ? users : [];
  }

  function getEmployees() {
    return getUsers().filter((user) => user && user.role === "employee");
  }

  function getAttendanceRecords() {
    const records = storage.getAttendance();
    return Array.isArray(records) ? records : [];
  }

  function getCompanySettings() {
    const company = storage.getCompany() || {};

    const officeStartTime =
      typeof company.officeStartTime === "string" &&
      timeToMinutes(company.officeStartTime) !== null
        ? company.officeStartTime
        : DEFAULT_COMPANY_SETTINGS.officeStartTime;

    const configuredGrace = Number(company.graceMinutes);

    const graceMinutes =
      company.graceMinutes !== null &&
      company.graceMinutes !== undefined &&
      Number.isInteger(configuredGrace) &&
      configuredGrace >= 0 &&
      configuredGrace <= 1440
        ? configuredGrace
        : DEFAULT_COMPANY_SETTINGS.graceMinutes;

    const workingDays =
      Array.isArray(company.workingDays) && company.workingDays.length > 0
        ? company.workingDays
        : DEFAULT_COMPANY_SETTINGS.workingDays;

    return {
      ...company,
      officeStartTime,
      graceMinutes,
      workingDays,
    };
  }

  function isWorkingDay(date = new Date()) {
    const settings = getCompanySettings();

    const weekday = date.toLocaleDateString("en-US", {
      weekday: "long",
    });

    return settings.workingDays.some(
      (day) => String(day).toLowerCase() === weekday.toLowerCase(),
    );
  }

  // -----------------------------------------------------
  // 4. TIME PARSING AND FORMATTING
  // -----------------------------------------------------

  function timeToMinutes(value) {
    const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);

    if (!match) {
      return null;
    }

    return Number(match[1]) * 60 + Number(match[2]);
  }

  function formatTime(value) {
    if (!value) {
      return "—";
    }

    const minutes = timeToMinutes(String(value));

    if (minutes === null) {
      return String(value);
    }

    const hours24 = Math.floor(minutes / 60);
    const minutesPart = minutes % 60;

    const hours12 = hours24 % 12 || 12;
    const period = hours24 >= 12 ? "PM" : "AM";

    return `${hours12}:${String(minutesPart).padStart(2, "0")} ${period}`;
  }

  function formatDuration(totalMinutes) {
    if (!Number.isFinite(totalMinutes) || totalMinutes < 0) {
      return "0h 0m";
    }

    const minutes = Math.floor(totalMinutes);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return `${hours}h ${remainingMinutes}m`;
  }

  function formatStoredDate(value) {
    if (!value) {
      return "—";
    }

    const parts = String(value).slice(0, 10).split("-");

    if (parts.length !== 3) {
      return String(value);
    }

    const [year, month, day] = parts.map(Number);

    const date = new Date(year, month - 1, day, 12);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("en-PK", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function parseLocalDateTime(dateValue, timeValue) {
    const dateMatch = String(dateValue || "").match(
      /^(\d{4})-(\d{2})-(\d{2})$/,
    );

    const timeMinutes = timeToMinutes(timeValue);

    if (!dateMatch || timeMinutes === null) {
      return null;
    }

    const [, year, month, day] = dateMatch.map(Number);

    const hours = Math.floor(timeMinutes / 60);
    const minutes = timeMinutes % 60;

    const date = new Date(year, month - 1, day, hours, minutes, 0, 0);

    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  function getCheckInTimestamp(record) {
    if (Number.isFinite(record.checkInAt)) {
      return record.checkInAt;
    }

    return parseLocalDateTime(record.date, record.checkIn);
  }

  function getCheckOutTimestamp(record) {
    if (Number.isFinite(record.checkOutAt)) {
      return record.checkOutAt;
    }

    if (!record.checkOut) {
      return null;
    }

    return parseLocalDateTime(record.date, record.checkOut);
  }

  // -----------------------------------------------------
  // 5. ATTENDANCE BUSINESS RULES
  // -----------------------------------------------------

  function isLateCheckIn(checkInTime) {
    const settings = getCompanySettings();

    const actualMinutes = timeToMinutes(checkInTime);
    const officeStart = timeToMinutes(settings.officeStartTime);

    if (actualMinutes === null || officeStart === null) {
      return false;
    }

    const cutoffMinutes = officeStart + settings.graceMinutes;

    // The PDF says late when check-in is AFTER the grace cutoff.
    return actualMinutes > cutoffMinutes;
  }

  function isRecordLate(record) {
    if (typeof record.isLate === "boolean") {
      return record.isLate;
    }

    if (Number.isFinite(record.lateMinutes) && record.lateMinutes > 0) {
      return true;
    }

    if (normalizeStatus(record.status) === "late") {
      return true;
    }

    if (record.checkIn) {
      return isLateCheckIn(record.checkIn);
    }

    return false;
  }

  function calculateWorkedMinutes(record, nowTimestamp = Date.now()) {
    if (!record || !record.checkIn) {
      return 0;
    }

    const checkInTimestamp = getCheckInTimestamp(record);

    if (checkInTimestamp === null) {
      return 0;
    }

    const checkOutTimestamp = getCheckOutTimestamp(record);

    // If the employee has not checked out, show elapsed time for
    // today's active shift without saving it as completed hours.
    if (!record.checkOut && record.date === localDateKey()) {
      return Math.max(0, Math.floor((nowTimestamp - checkInTimestamp) / 60000));
    }

    if (checkOutTimestamp === null) {
      return 0;
    }

    if (checkOutTimestamp <= checkInTimestamp) {
      return 0;
    }

    return Math.floor((checkOutTimestamp - checkInTimestamp) / 60000);
  }

  function getRecordStatus(record) {
    if (!record || !record.checkIn) {
      return "absent";
    }

    const hasCheckedOut = Boolean(record.checkOut);

    if (hasCheckedOut) {
      const workedMinutes = Number.isFinite(record.workedMinutes)
        ? record.workedMinutes
        : calculateWorkedMinutes(record);

      if (record.isHalfDay === true || workedMinutes < MIN_HALF_DAY_MINUTES) {
        return "half day";
      }
    }

    return isRecordLate(record) ? "late" : "present";
  }

  function getRecordDisplayStatus(record) {
    const status = getRecordStatus(record);

    // Keep the half-day status for the business rule but preserve
    // late information separately for the Admin's Late Today counter.
    if (status === "half day" && isRecordLate(record)) {
      return "Half Day (Late)";
    }

    return status.replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function getTodayRecord(employeeId) {
    return (
      getAttendanceRecords().find(
        (record) =>
          String(record.employeeId) === String(employeeId) &&
          record.date === localDateKey(),
      ) || null
    );
  }

  // -----------------------------------------------------
  // 6. STATUS BADGE CREATION
  // -----------------------------------------------------

  function statusClassName(status) {
    const normalized = normalizeStatus(status);

    if (normalized.includes("half day")) {
      return "status-half-day";
    }

    if (normalized === "late") {
      return "status-late";
    }

    if (normalized === "on leave" || normalized === "approved") {
      return "status-approved";
    }

    if (normalized === "present") {
      return "status-present";
    }

    if (normalized === "absent") {
      return "status-absent";
    }

    if (normalized === "not checked in" || normalized === "pending") {
      return "status-pending";
    }

    return "status-pending";
  }

  function updateStatusBadge(element, label) {
    if (!element) {
      return;
    }

    [
      "status-present",
      "status-late",
      "status-half-day",
      "status-absent",
      "status-approved",
      "status-pending",
      "status-rejected",
    ].forEach((className) => {
      element.classList.remove(className);
    });

    element.classList.add(statusClassName(label));
    element.textContent = label;
  }

  function createStatusBadge(status) {
    const badge = document.createElement("span");

    badge.className = `status-badge ${statusClassName(status)}`;

    badge.textContent = String(status);

    return badge;
  }

  function createCell(value) {
    const cell = document.createElement("td");

    // Use textContent to avoid interpreting user-supplied text as HTML.
    cell.textContent =
      value === null || value === undefined || value === ""
        ? "—"
        : String(value);

    return cell;
  }

  // -----------------------------------------------------
  // 7. EMPLOYEE DASHBOARD — PROFILE
  // -----------------------------------------------------

  function getInitials(name) {
    return (
      String(name || "Employee")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "E"
    );
  }

  function renderEmployeeProfile() {
    const name = currentUser.name || "Employee";
    const department = currentUser.department || "Department";
    const initials = getInitials(name);

    setText("employee-sidebar-name", name);
    setText("employee-display-name", name);
    setText("employee-welcome-name", name);

    setText("employee-sidebar-department", department);

    setText("employee-display-department", department);

    setText(
      "employee-current-date",
      new Intl.DateTimeFormat("en-PK", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date()),
    );

    ["employee-sidebar-avatar", "employee-topbar-avatar"].forEach((id) => {
      const avatar = $(id);

      if (avatar) {
        avatar.textContent = initials;
      }
    });
  }

  // -----------------------------------------------------
  // 8. EMPLOYEE DASHBOARD — ATTENDANCE STATISTICS
  // -----------------------------------------------------

  function getMonthRecords(records) {
    const now = new Date();

    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    return records.filter(
      (record) =>
        typeof record.date === "string" &&
        record.date.slice(0, 7) === currentMonth,
    );
  }

  function isInCurrentWeek(dateString) {
    const parts = String(dateString || "").split("-");

    if (parts.length !== 3) {
      return false;
    }

    const date = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2]),
      12,
    );

    if (Number.isNaN(date.getTime())) {
      return false;
    }

    const today = new Date();

    const startOfWeek = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      0,
    );

    const dayOffset = (startOfWeek.getDay() + 6) % 7;

    startOfWeek.setDate(startOfWeek.getDate() - dayOffset);

    const endOfWeek = new Date(startOfWeek);

    endOfWeek.setDate(startOfWeek.getDate() + 7);

    return date >= startOfWeek && date < endOfWeek;
  }

  function renderEmployeeStatistics(records) {
    const monthlyRecords = getMonthRecords(records);

    const presentDays = monthlyRecords.filter((record) =>
      Boolean(record.checkIn),
    ).length;

    const lateDays = monthlyRecords.filter(
      (record) => record.checkIn && isRecordLate(record),
    ).length;

    const weeklyRecords = records.filter(
      (record) => record.checkIn && isInCurrentWeek(record.date),
    );

    const weeklyMinutes = weeklyRecords.reduce(
      (total, record) => total + calculateWorkedMinutes(record),
      0,
    );

    setText("employee-present-days", presentDays);
    setText("employee-late-days", lateDays);

    setText("employee-weekly-hours", formatDuration(weeklyMinutes));
  }

  // -----------------------------------------------------
  // 9. EMPLOYEE DASHBOARD — TODAY'S ATTENDANCE
  // -----------------------------------------------------

  function renderEmployeeToday(record) {
    const checkInButton = $("employee-check-in-button");
    const checkOutButton = $("employee-check-out-button");

    const statusBadge = $("employee-today-status");

    if (!record) {
      setText("employee-check-in-time", "—");
      setText("employee-check-out-time", "—");
      setText("employee-today-hours", "0h 0m");

      updateStatusBadge(statusBadge, "Not Checked In");

      setText(
        "employee-attendance-message",
        isWorkingDay()
          ? "You have not checked in today."
          : "Today is not configured as a working day. Attendance can still be recorded.",
      );

      if (checkInButton) {
        checkInButton.disabled = false;
      }

      if (checkOutButton) {
        checkOutButton.disabled = true;
      }

      return;
    }

    const status = getRecordStatus(record);

    setText("employee-check-in-time", formatTime(record.checkIn));

    setText("employee-check-out-time", formatTime(record.checkOut));

    const workedMinutes = calculateWorkedMinutes(record);

    setText("employee-today-hours", formatDuration(workedMinutes));

    let badgeText = getRecordDisplayStatus(record);

    if (!record.checkOut) {
      badgeText = isRecordLate(record) ? "Late" : "Present";
    }

    updateStatusBadge(statusBadge, badgeText);

    if (record.checkOut) {
      setText(
        "employee-attendance-message",
        status === "half day"
          ? "Check-out recorded. Today's work duration is under 5 hours, so the record is classified as half day."
          : "Your attendance for today is complete.",
      );

      if (checkInButton) {
        checkInButton.disabled = true;
      }

      if (checkOutButton) {
        checkOutButton.disabled = true;
      }
    } else {
      setText(
        "employee-attendance-message",
        isRecordLate(record)
          ? "Check-in recorded as late. Remember to check out when you finish work."
          : "Check-in recorded. Remember to check out when you finish work.",
      );

      if (checkInButton) {
        checkInButton.disabled = true;
      }

      if (checkOutButton) {
        checkOutButton.disabled = false;
      }
    }
  }

  // -----------------------------------------------------
  // 10. EMPLOYEE DASHBOARD — ATTENDANCE HISTORY
  // -----------------------------------------------------

  function renderEmployeeHistory(records) {
    const tbody = $("employee-attendance-body");

    if (!tbody) {
      return;
    }

    const emptyState = $("employee-attendance-empty");

    tbody
      .querySelectorAll("[data-generated-row='true']")
      .forEach((row) => row.remove());

    const sortedRecords = [...records].sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || "")),
    );

    sortedRecords.forEach((record) => {
      const row = document.createElement("tr");

      row.dataset.generatedRow = "true";

      row.append(
        createCell(formatStoredDate(record.date)),
        createCell(formatTime(record.checkIn)),
        createCell(formatTime(record.checkOut)),
        createCell(
          record.checkOut
            ? formatDuration(calculateWorkedMinutes(record))
            : record.checkIn
              ? formatDuration(calculateWorkedMinutes(record))
              : "—",
        ),
      );

      const statusCell = document.createElement("td");

      statusCell.appendChild(createStatusBadge(getRecordDisplayStatus(record)));

      row.appendChild(statusCell);

      tbody.appendChild(row);
    });

    if (emptyState) {
      emptyState.hidden = sortedRecords.length > 0;
    }

    setText(
      "employee-attendance-record-count",
      `${sortedRecords.length} ${
        sortedRecords.length === 1 ? "Record" : "Records"
      }`,
    );
  }

  function renderEmployeeDashboard() {
    const records = getAttendanceRecords().filter(
      (record) => String(record.employeeId) === String(currentUser.id),
    );

    renderEmployeeProfile();
    renderEmployeeToday(
      records.find((record) => record.date === localDateKey()) || null,
    );

    renderEmployeeStatistics(records);
    renderEmployeeHistory(records);
  }

  // -----------------------------------------------------
  // 11. ADMIN DASHBOARD — TODAY'S ATTENDANCE DATA
  // -----------------------------------------------------

  function getApprovedLeavesForToday() {
    if (!isWorkingDay()) {
      return [];
    }

    const allLeaves = storage.getLeaves();

    if (!Array.isArray(allLeaves)) {
      return [];
    }

    const today = localDateKey();

    return allLeaves.filter((leave) => {
      const status = normalizeStatus(leave.status);

      const from = String(leave.from || "").slice(0, 10);
      const to = String(leave.to || "").slice(0, 10);

      return (
        status === "approved" && from && to && from <= today && today <= to
      );
    });
  }

  function getAdminAttendanceData() {
    const today = localDateKey();

    const employees = getEmployees();

    const employeeIds = new Set(
      employees.map((employee) => String(employee.id)),
    );

    const todaysRecords = getAttendanceRecords().filter(
      (record) =>
        record.date === today && employeeIds.has(String(record.employeeId)),
    );

    const attendanceByEmployee = new Map();

    todaysRecords.forEach((record) => {
      const key = String(record.employeeId);

      // One valid attendance record per employee per day is expected.
      // Preserve the first record if legacy data contains duplicates.
      if (!attendanceByEmployee.has(key)) {
        attendanceByEmployee.set(key, record);
      }
    });

    const presentIds = new Set(
      [...attendanceByEmployee.entries()]
        .filter(([, record]) => Boolean(record.checkIn))
        .map(([id]) => id),
    );

    const lateIds = new Set(
      [...attendanceByEmployee.entries()]
        .filter(([, record]) => Boolean(record.checkIn) && isRecordLate(record))
        .map(([id]) => id),
    );

    const approvedLeaves = getApprovedLeavesForToday();

    const onLeaveIds = new Set(
      approvedLeaves
        .map((leave) => String(leave.employeeId))
        .filter((id) => employeeIds.has(id) && !presentIds.has(id)),
    );

    const absentIds = new Set();

    if (isWorkingDay()) {
      employees.forEach((employee) => {
        const id = String(employee.id);

        if (!presentIds.has(id) && !onLeaveIds.has(id)) {
          absentIds.add(id);
        }
      });
    }

    return {
      today,
      employees,
      attendanceByEmployee,
      presentIds,
      lateIds,
      onLeaveIds,
      absentIds,
    };
  }

  function renderAdminAttendanceTable(data) {
    const tbody = $("attendance-table-body");

    if (!tbody) {
      return;
    }

    const emptyState = $("attendance-empty-state");

    tbody
      .querySelectorAll("[data-generated-row='true']")
      .forEach((row) => row.remove());

    const employees = [...data.employees].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
    );

    let renderedCount = 0;

    employees.forEach((employee) => {
      const id = String(employee.id);

      const record = data.attendanceByEmployee.get(id);

      const isOnLeave = data.onLeaveIds.has(id);

      // On a non-working day, don't mark employees who have no
      // attendance record as absent. Only show recorded activity.
      if (!record && !isOnLeave && !data.absentIds.has(id)) {
        return;
      }

      let status;

      if (record && record.checkIn) {
        status = getRecordDisplayStatus(record);
      } else if (isOnLeave) {
        status = "On Leave";
      } else {
        status = "Absent";
      }

      const row = document.createElement("tr");

      row.dataset.generatedRow = "true";

      row.append(
        createCell(employee.name),
        createCell(employee.department || "—"),
        createCell(record ? formatTime(record.checkIn) : "—"),
        createCell(record ? formatTime(record.checkOut) : "—"),
      );

      const statusCell = document.createElement("td");

      statusCell.appendChild(createStatusBadge(status));

      row.appendChild(statusCell);
      tbody.appendChild(row);

      renderedCount += 1;
    });

    if (emptyState) {
      emptyState.hidden = renderedCount > 0;
    }

    setText(
      "attendance-summary",
      `${data.presentIds.size} employee(s) checked in, ` +
        `${data.lateIds.size} late arrival(s), ` +
        `${data.onLeaveIds.size} on leave` +
        (data.absentIds.size ? ` and ${data.absentIds.size} absent.` : "."),
    );
  }

  function renderAdminDashboard() {
    const data = getAdminAttendanceData();

    // Keep the Admin's employee count consistent with saved users.
    setText("total-employees-count", data.employees.length);

    setText("present-count", data.presentIds.size);

    setText("late-count", data.lateIds.size);

    setText("on-leave-count", data.onLeaveIds.size);

    renderAdminAttendanceTable(data);
  }

  // -----------------------------------------------------
  // 12. EMPLOYEE CHECK-IN
  // -----------------------------------------------------

  function handleCheckIn() {
    const messageElement = $("employee-attendance-message");

    const today = localDateKey();

    const records = getAttendanceRecords();

    const existingRecord = records.find(
      (record) =>
        String(record.employeeId) === String(currentUser.id) &&
        record.date === today,
    );

    if (existingRecord) {
      setText(
        "employee-attendance-message",
        "You already have an attendance record for today.",
      );

      refreshDashboard();
      return;
    }

    const now = new Date();

    const checkIn =
      `${String(now.getHours()).padStart(2, "0")}:` +
      `${String(now.getMinutes()).padStart(2, "0")}`;

    const late = isLateCheckIn(checkIn);

    const newRecord = {
      id: Date.now(),
      employeeId: currentUser.id,
      date: today,

      checkIn,
      checkOut: null,

      // Initial status is present or late. A completed shift
      // under five hours will later become half day.
      status: late ? "late" : "present",

      isLate: late,
      isHalfDay: false,

      checkInAt: now.getTime(),
      checkOutAt: null,

      workedMinutes: 0,
    };

    const saved = storage.saveAttendance([...records, newRecord]);

    if (!saved) {
      setText(
        "employee-attendance-message",
        "Check-in could not be saved. Please check browser storage and try again.",
      );

      return;
    }

    console.log("[HCM Lite] Employee checked in.", {
      employeeId: currentUser.id,
      date: today,
      checkIn,
      status: newRecord.status,
    });

    setText(
      "employee-attendance-message",
      late
        ? "Check-in recorded. Your arrival is marked late according to company policy."
        : "Check-in recorded successfully.",
    );

    refreshDashboard();
  }

  // -----------------------------------------------------
  // 13. EMPLOYEE CHECK-OUT
  // -----------------------------------------------------

  function handleCheckOut() {
    const records = getAttendanceRecords();

    const today = localDateKey();

    const recordIndex = records.findIndex(
      (record) =>
        String(record.employeeId) === String(currentUser.id) &&
        record.date === today,
    );

    if (recordIndex < 0) {
      setText(
        "employee-attendance-message",
        "You must check in before checking out.",
      );

      refreshDashboard();
      return;
    }

    const existingRecord = records[recordIndex];

    if (!existingRecord.checkIn) {
      setText(
        "employee-attendance-message",
        "A valid check-in record is required before check-out.",
      );

      refreshDashboard();
      return;
    }

    if (existingRecord.checkOut) {
      setText(
        "employee-attendance-message",
        "You have already checked out today.",
      );

      refreshDashboard();
      return;
    }

    const now = new Date();

    const checkOut =
      `${String(now.getHours()).padStart(2, "0")}:` +
      `${String(now.getMinutes()).padStart(2, "0")}`;

    const checkInTimestamp = getCheckInTimestamp(existingRecord);

    if (checkInTimestamp === null || now.getTime() <= checkInTimestamp) {
      setText(
        "employee-attendance-message",
        "Check-out time must be later than your check-in time.",
      );

      return;
    }

    const updatedRecord = {
      ...existingRecord,

      checkOut,
      checkOutAt: now.getTime(),
    };

    const workedMinutes = calculateWorkedMinutes(updatedRecord, now.getTime());

    const halfDay = workedMinutes < MIN_HALF_DAY_MINUTES;

    const late = isRecordLate(existingRecord);

    updatedRecord.workedMinutes = workedMinutes;
    updatedRecord.isLate = late;
    updatedRecord.isHalfDay = halfDay;

    updatedRecord.status = halfDay ? "half day" : late ? "late" : "present";

    const updatedRecords = [...records];

    updatedRecords[recordIndex] = updatedRecord;

    const saved = storage.saveAttendance(updatedRecords);

    if (!saved) {
      setText(
        "employee-attendance-message",
        "Check-out could not be saved. Please check browser storage and try again.",
      );

      return;
    }

    console.log("[HCM Lite] Employee checked out.", {
      employeeId: currentUser.id,
      date: today,
      checkOut,
      workedMinutes,
      status: updatedRecord.status,
    });

    setText(
      "employee-attendance-message",
      halfDay
        ? `Check-out saved. Total work duration: ${formatDuration(workedMinutes)}. Attendance marked half day.`
        : `Check-out saved successfully. Total work duration: ${formatDuration(workedMinutes)}.`,
    );

    refreshDashboard();
  }

  // -----------------------------------------------------
  // 14. REGISTER EVENTS
  // -----------------------------------------------------

  function initializeEmployeeEvents() {
    const checkInButton = $("employee-check-in-button");
    const checkOutButton = $("employee-check-out-button");

    if (checkInButton) {
      checkInButton.addEventListener("click", handleCheckIn);
    }

    if (checkOutButton) {
      checkOutButton.addEventListener("click", handleCheckOut);
    }

    const logoutButton = $("employee-logout-button");

    if (logoutButton) {
      logoutButton.addEventListener("click", () => {
        auth.logout();
      });
    }
  }

  // -----------------------------------------------------
  // 15. REFRESH THE CURRENT DASHBOARD
  // -----------------------------------------------------

  function refreshDashboard() {
    if (isEmployeePage) {
      renderEmployeeDashboard();
    }

    if (isAdminPage) {
      renderAdminDashboard();
    }
  }

  // -----------------------------------------------------
  // 16. CROSS-TAB SYNCHRONIZATION
  // -----------------------------------------------------

  window.addEventListener("storage", (event) => {
    const watchedKeys = [
      "hcm_company",
      "hcm_users",
      "hcm_attendance",
      "hcm_leaves",
    ];

    if (event.key === null || watchedKeys.includes(event.key)) {
      refreshDashboard();
    }
  });

  // -----------------------------------------------------
  // 17. INITIALIZE
  // -----------------------------------------------------

  function init() {
    if (isEmployeePage) {
      initializeEmployeeEvents();
      renderEmployeeDashboard();

      // Refresh elapsed time while an employee is checked in
      // but hasn't checked out.
      window.setInterval(() => {
        const record = getTodayRecord(currentUser.id);

        if (record && record.checkIn && !record.checkOut) {
          renderEmployeeDashboard();
        }
      }, 60000);
    }

    if (isAdminPage) {
      renderAdminDashboard();
    }

    console.log(
      `[HCM Lite] Attendance module initialized for ${currentUser.role}.`,
    );
  }

  init();

  // -----------------------------------------------------
  // 18. PUBLIC API FOR OTHER MODULES
  // -----------------------------------------------------

  window.HCMAttendance = Object.freeze({
    refresh: refreshDashboard,
    getTodayRecord,
    getRecordStatus,
    isRecordLate,
    calculateWorkedMinutes,
    formatDuration,
    isWorkingDay,
  });
})();
