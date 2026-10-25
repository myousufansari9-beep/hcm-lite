/* =====================================================
   HCM LITE — ADMIN DASHBOARD
   Authentication, profile, statistics and tables
===================================================== */

(() => {
  "use strict";

  // -------------------------------------------------
  // 1. Check required modules
  // -------------------------------------------------

  if (!window.HCMStorage || !window.HCMAuth) {
    console.error("HCM Lite: storage.js or auth.js is not loaded.");
    return;
  }

  const storage = window.HCMStorage;
  const auth = window.HCMAuth;

  // Only an authenticated Admin can access this page.
  const admin = auth.requireAuth("admin");

  if (!admin) {
    return;
  }

  const $ = (id) => document.getElementById(id);

  // -------------------------------------------------
  // 2. Date and formatting helpers
  // -------------------------------------------------

  function getTodayKey() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function formatDate(date = new Date()) {
    return new Intl.DateTimeFormat("en-PK", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  function formatStoredDate(value) {
    if (!value) return "—";

    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("en-PK", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function formatTime(value) {
    if (!value) return "—";

    const time = String(value);
    const match = time.match(/(?:T|\s)?(\d{1,2}):(\d{2})/);

    if (!match) return time;

    const hours = Number(match[1]);
    const minutes = match[2];

    if (hours > 23 || hours < 0) return time;

    const displayHour = hours % 12 || 12;
    const period = hours >= 12 ? "PM" : "AM";

    return `${displayHour}:${minutes} ${period}`;
  }

  function normalizeStatus(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ");
  }

  function getInitials(name) {
    const parts = String(name || "Admin")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return (
      parts
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("") || "A"
    );
  }

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent = String(value);
    }
  }

  // -------------------------------------------------
  // 3. Display Admin profile and current date
  // -------------------------------------------------

  function renderAdminProfile() {
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

  // -------------------------------------------------
  // 4. Logout functionality
  // -------------------------------------------------

  function initializeLogout() {
    const logoutButton = $("logout-button");

    if (!logoutButton) {
      console.warn("HCM Lite: Logout button not found.");
      return;
    }

    logoutButton.addEventListener("click", () => {
      auth.logout();
    });
  }

  // -------------------------------------------------
  // 5. Read today's data
  // -------------------------------------------------

  function getDashboardData() {
    const today = getTodayKey();

    const company = storage.getCompany() || {};

    const users = storage.getUsers();

    const employees = users.filter((user) => user.role === "employee");

    const allAttendance = storage.getAttendance();

    const allLeaves = storage.getLeaves();

    const todayAttendance = allAttendance.filter(
      (record) => String(record.date || "").slice(0, 10) === today,
    );

    const weekday = new Date()
      .toLocaleDateString("en-US", {
        weekday: "long",
      })
      .toLowerCase();

    const workingDays = Array.isArray(company.workingDays)
      ? company.workingDays.map((day) => String(day).toLowerCase())
      : ["monday", "tuesday", "wednesday", "thursday", "friday"];

    const isWorkingDay = workingDays.includes(weekday);

    // An approved leave counts for today only when today is a
    // configured working day and falls inside the leave date range.
    const approvedLeavesToday = isWorkingDay
      ? allLeaves.filter((leave) => {
          const status = normalizeStatus(leave.status);

          const from = String(leave.from || "").slice(0, 10);
          const to = String(leave.to || "").slice(0, 10);

          return (
            status === "approved" && from && to && from <= today && today <= to
          );
        })
      : [];

    const employeeIds = new Set(
      employees.map((employee) => String(employee.id)),
    );

    // Count each employee once, even if inconsistent data contains
    // multiple approved leave records covering the same date.
    const onLeaveIds = new Set(
      approvedLeavesToday
        .map((leave) => String(leave.employeeId))
        .filter((id) => employeeIds.has(id)),
    );

    const pendingLeaves = allLeaves.filter(
      (leave) => normalizeStatus(leave.status) === "pending",
    );

    const presentCount = todayAttendance.filter((record) =>
      Boolean(record.checkIn),
    ).length;

    const lateCount = todayAttendance.filter(
      (record) => normalizeStatus(record.status) === "late",
    ).length;

    return {
      employees,
      todayAttendance,
      approvedLeavesToday,
      onLeaveIds,
      pendingLeaves,
      presentCount,
      lateCount,
      isWorkingDay,
    };
  }

  // -------------------------------------------------
  // 6. Render statistics cards
  // -------------------------------------------------

  function renderStatistics(data) {
    setText("total-employees-count", data.employees.length);

    setText("present-count", data.presentCount);

    setText("on-leave-count", data.onLeaveIds.size);

    setText("late-count", data.lateCount);

    setText("nav-pending-leaves-count", data.pendingLeaves.length);
  }

  // -------------------------------------------------
  // 7. Attendance table helpers
  // -------------------------------------------------

  function createCell(value) {
    const cell = document.createElement("td");

    cell.textContent = value == null || value === "" ? "—" : String(value);

    return cell;
  }

  function createStatusBadge(status) {
    const badge = document.createElement("span");

    const label = String(status || "Unknown");
    const normalized = normalizeStatus(label);

    badge.classList.add("status-badge");

    const classMap = {
      present: "status-present",
      late: "status-late",
      "half day": "status-half-day",
      absent: "status-absent",
      approved: "status-approved",
      pending: "status-pending",
      rejected: "status-rejected",
      "on leave": "status-approved",
    };

    if (classMap[normalized]) {
      badge.classList.add(classMap[normalized]);
    }

    badge.textContent = label;

    return badge;
  }

  function renderAttendanceTable(data) {
    const tbody = $("attendance-table-body");

    if (!tbody) return;

    const emptyState = $("attendance-empty-state");

    // Remove previous dynamically generated rows.
    tbody
      .querySelectorAll("[data-generated-row]")
      .forEach((row) => row.remove());

    const rows = [];

    data.employees.forEach((employee) => {
      const record = data.todayAttendance.find(
        (item) => String(item.employeeId) === String(employee.id),
      );

      const isOnLeave = data.onLeaveIds.has(String(employee.id));

      // On non-working days, don't mark employees without
      // attendance records as absent.
      if (!record && !isOnLeave && !data.isWorkingDay) {
        return;
      }

      let status;

      if (record) {
        status = String(record.status || "").trim();

        if (!status) {
          status = record.checkIn ? "Present" : "Absent";
        }
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

      rows.push(row);
    });

    rows.forEach((row) => tbody.appendChild(row));

    if (emptyState) {
      emptyState.hidden = rows.length > 0;
    }

    setText(
      "attendance-summary",
      `${data.todayAttendance.length} attendance record(s) for today. ` +
        `${data.presentCount} employee(s) checked in; ` +
        `${data.lateCount} late record(s).`,
    );
  }

  // -------------------------------------------------
  // 8. Pending leave requests table
  // -------------------------------------------------

  function renderPendingLeaves(data) {
    const tbody = $("pending-leaves-body");

    if (!tbody) return;

    const emptyState = $("leave-empty-state");

    tbody
      .querySelectorAll("[data-generated-row]")
      .forEach((row) => row.remove());

    const employees = data.employees;

    data.pendingLeaves.forEach((leave) => {
      const employee = employees.find(
        (item) => String(item.id) === String(leave.employeeId),
      );

      const row = document.createElement("tr");

      row.dataset.generatedRow = "true";

      const employeeName = employee ? employee.name : "Unknown employee";

      const leaveType = String(leave.type || "Leave").replace(/[_-]+/g, " ");

      const formattedType = leaveType.replace(/\b\w/g, (character) =>
        character.toUpperCase(),
      );

      row.append(
        createCell(employeeName),
        createCell(formattedType),
        createCell(
          `${formatStoredDate(leave.from)} – ` +
            `${formatStoredDate(leave.to)}`,
        ),
        createCell(leave.days ?? "—"),
      );

      const statusCell = document.createElement("td");

      statusCell.appendChild(createStatusBadge("Pending"));

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
      emptyState.hidden = data.pendingLeaves.length > 0;
    }
  }

  // -------------------------------------------------
  // 9. Initialize dashboard
  // -------------------------------------------------

  function initDashboard() {
    try {
      renderAdminProfile();
      initializeLogout();

      const data = getDashboardData();

      renderStatistics(data);
      renderAttendanceTable(data);
      renderPendingLeaves(data);

      console.log("HCM Lite: Admin dashboard initialized.");
    } catch (error) {
      console.error("HCM Lite: Dashboard initialization failed.", error);
    }
  }

  initDashboard();
})();
