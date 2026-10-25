/* =========================================================
   HCM LITE — PAYSLIP MODULE

   Admin:
   - Company payroll overview
   - Employee-wise payslip
   - Month/year selection
   - Payroll CSV export
   - Print / Save as PDF

   Employee:
   - Personal salary overview
   - Own payslip only
   - Month/year selection
   - Print / Save as PDF

   Uses existing HCMStorage and HCMAuth.
========================================================= */

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const DAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const DEFAULT_WORKING_DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
  ];

  let currentUser = null;
  let currentRole = null;

  const elements = {
    month: $("#payslip-month-filter"),
    year: $("#payslip-year-filter"),
    employeeFilter: $("#payslip-employee-filter"),
    filterForm: $("#payslip-filter-form"),
    message: $("#payslip-message"),
    emptyState: $("#payslip-empty-state"),
    preview: $("#payslip-preview"),
    exportButton: $("#export-payroll-csv-button"),
    printButton: $("#print-payslip-button"),
  };

  /* =====================================================
     1. STORAGE HELPERS
  ===================================================== */

  function getStorage() {
    if (!window.HCMStorage) {
      throw new Error("HCMStorage missing. Load storage.js before payslip.js.");
    }

    return window.HCMStorage;
  }

  function getUsers() {
    const data = getStorage().getUsers();
    return Array.isArray(data) ? data : [];
  }

  function getEmployees() {
    return getUsers().filter((user) => user && user.role === "employee");
  }

  function getAttendance() {
    const data = getStorage().getAttendance();
    return Array.isArray(data) ? data : [];
  }

  function getLeaves() {
    const data = getStorage().getLeaves();
    return Array.isArray(data) ? data : [];
  }

  function getCompany() {
    return getStorage().getCompany() || {};
  }

  /* =====================================================
     2. GENERAL HELPERS
  ===================================================== */

  function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
      element.textContent =
        value === null || value === undefined ? "—" : String(value);
    }
  }

  function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function formatPKR(value) {
    const amount = Number(value) || 0;

    return `PKR ${amount.toLocaleString("en-PK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatAmount(value) {
    const amount = Number(value) || 0;

    return amount.toLocaleString("en-PK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function getInitial(name) {
    const value = String(name || "User").trim();

    return value ? value.charAt(0).toUpperCase() : "U";
  }

  function localISODate(date = new Date()) {
    const year = date.getFullYear();

    const month = String(date.getMonth() + 1).padStart(2, "0");

    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function formatDate(date = new Date()) {
    return date.toLocaleDateString("en-PK", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function getCurrentPeriod() {
    const now = new Date();

    return {
      year: now.getFullYear(),
      month: now.getMonth(),
    };
  }

  function getSelectedPeriod() {
    const fallback = getCurrentPeriod();

    const monthNumber = Number(elements.month?.value);
    const year = Number(elements.year?.value);

    const validMonth =
      Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12;

    const validYear = Number.isInteger(year) && year >= 2000 && year <= 2100;

    return {
      year: validYear ? year : fallback.year,
      month: validMonth ? monthNumber - 1 : fallback.month,
    };
  }

  function getMonthLabel(year, monthIndex) {
    return new Date(year, monthIndex, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  function normalizeDate(value) {
    if (!value) return "";

    return String(value).slice(0, 10);
  }

  function sameId(first, second) {
    return String(first) === String(second);
  }

  /* =====================================================
     3. ROLE-BASED VIEW

     Only Admin elements appear for Admin.
     Only Employee elements appear for Employee.
  ===================================================== */

  function configureRoleView() {
    const isAdmin = currentRole === "admin";

    document.body.classList.add("admin-page", "payslip-page");

    document.body.classList.toggle("employee-view", !isAdmin);

    $$("[data-role-section]").forEach((section) => {
      section.hidden = section.dataset.roleSection !== currentRole;
    });

    if (elements.employeeFilter) {
      elements.employeeFilter.disabled = !isAdmin;
      elements.employeeFilter.required = isAdmin;
    }

    if (!isAdmin) {
      const eyebrow = $(".app-topbar .page-eyebrow");
      const heading = $(".app-topbar h1");
      const subtitle = $(".app-topbar .page-subtitle");

      if (eyebrow) {
        eyebrow.textContent = "MY PAYROLL";
      }

      if (heading) {
        heading.textContent = "My Payslips";
      }

      if (subtitle) {
        subtitle.textContent =
          "View your monthly salary details and attendance deductions.";
      }
    }
  }

  /* =====================================================
     4. USER PROFILE AND TOPBAR
  ===================================================== */

  function populateProfile() {
    const isAdmin = currentRole === "admin";

    const name = currentUser.name || (isAdmin ? "Admin" : "Employee");

    const initial = getInitial(name);

    setText("payslip-current-date", formatDate());

    setText("payslip-topbar-avatar", initial);
    setText("payslip-topbar-name", name);

    setText(
      "payslip-topbar-role",
      isAdmin ? "Administrator" : currentUser.department || "Employee",
    );

    if (isAdmin) {
      setText("payslip-admin-avatar", initial);
      setText("payslip-admin-sidebar-name", name);
    } else {
      setText("payslip-employee-avatar", initial);

      setText("payslip-employee-sidebar-name", name);

      setText(
        "payslip-employee-sidebar-department",
        currentUser.department || "Department not set",
      );
    }
  }

  /* =====================================================
     5. ADMIN EMPLOYEE SELECTOR
  ===================================================== */

  function populateEmployeeFilter() {
    const select = elements.employeeFilter;

    if (!select) return;

    const previousValue = select.value;

    while (select.options.length > 1) {
      select.remove(1);
    }

    getEmployees()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .forEach((employee) => {
        const option = document.createElement("option");

        option.value = String(employee.id);

        option.textContent =
          `${employee.name || "Unnamed Employee"}` +
          (employee.department ? ` — ${employee.department}` : "");

        select.appendChild(option);
      });

    const employeeStillExists = getEmployees().some((employee) =>
      sameId(employee.id, previousValue),
    );

    select.value = employeeStillExists ? previousValue : "";
  }

  /* =====================================================
     6. WORKING DAYS AND LEAVE RULES
  ===================================================== */

  function getWorkingDaySet() {
    const configured = getCompany().workingDays;

    if (!Array.isArray(configured)) {
      return new Set(DEFAULT_WORKING_DAYS);
    }

    const validNames = configured
      .map((item) => {
        const value = String(item || "")
          .trim()
          .toLowerCase();

        return DAY_NAMES.find(
          (name) =>
            name.toLowerCase() === value ||
            name.slice(0, 3).toLowerCase() === value.slice(0, 3),
        );
      })
      .filter(Boolean);

    return new Set(validNames.length ? validNames : DEFAULT_WORKING_DAYS);
  }

  function isWorkingDay(date, workingDays) {
    return workingDays.has(DAY_NAMES[date.getDay()]);
  }

  function getMonthWorkingDates(year, monthIndex) {
    const workingDays = getWorkingDaySet();
    const dates = [];

    const numberOfDays = new Date(year, monthIndex + 1, 0).getDate();

    for (let day = 1; day <= numberOfDays; day++) {
      const date = new Date(year, monthIndex, day);

      if (isWorkingDay(date, workingDays)) {
        dates.push(localISODate(date));
      }
    }

    return dates;
  }

  function hasApprovedLeave(employeeId, dateString, leaves) {
    return leaves.some((leave) => {
      if (!leave || leave.status !== "approved") {
        return false;
      }

      if (!sameId(leave.employeeId, employeeId)) {
        return false;
      }

      const from = normalizeDate(leave.from);
      const to = normalizeDate(leave.to);

      return Boolean(from && to && dateString >= from && dateString <= to);
    });
  }

  /* =====================================================
     7. PAYROLL CALCULATION

     Daily rate = monthly salary / working days in month

     Deduction =
       daily rate * absent days
       + daily rate * 0.5 * half days

     Approved leave does not count as absence.
     Future dates and today's missing attendance are not
     counted as absent yet.
  ===================================================== */

  function calculatePayroll(employee, year, monthIndex) {
    const monthDates = getMonthWorkingDates(year, monthIndex);

    const attendance = getAttendance();
    const leaves = getLeaves();

    const attendanceByDate = new Map();

    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

    attendance.forEach((record) => {
      if (!record) return;

      if (!sameId(record.employeeId, employee.id)) {
        return;
      }

      const date = normalizeDate(record.date);

      if (date && date.slice(0, 7) === monthKey) {
        attendanceByDate.set(date, record);
      }
    });

    const today = localISODate();
    const todayMonth = today.slice(0, 7);

    const futureMonth = monthKey > todayMonth;
    const currentMonth = monthKey === todayMonth;

    let presentDays = 0;
    let lateDays = 0;
    let halfDays = 0;
    let absentDays = 0;

    monthDates.forEach((dateString) => {
      // Ignore future months, future dates, and incomplete current day.
      if (futureMonth || dateString > today) {
        return;
      }

      const record = attendanceByDate.get(dateString);

      const status = String(record?.status || "")
        .trim()
        .toLowerCase();

      const isHalfDay =
        Boolean(record?.isHalfDay) ||
        status === "half-day" ||
        status === "halfday";

      const isLate = Boolean(record?.isLate) || status === "late";

      const hasAttendance = Boolean(
        record &&
        (record.checkIn ||
          isHalfDay ||
          isLate ||
          ["present", "late", "half-day", "halfday"].includes(status)),
      );

      if (record && status === "absent") {
        absentDays++;
        return;
      }

      if (hasAttendance) {
        if (isLate) lateDays++;

        if (isHalfDay) {
          halfDays++;
        } else {
          presentDays++;
        }

        return;
      }

      // Don't mark today absent before the day has finished.
      if (currentMonth && dateString === today) {
        return;
      }

      // Approved leave is excused; pending/rejected leave isn't.
      if (hasApprovedLeave(employee.id, dateString, leaves)) {
        return;
      }

      // No attendance on a completed working day = absent.
      absentDays++;
    });

    const salary = Math.max(0, Number(employee.salary) || 0);

    const dailyRate = monthDates.length ? salary / monthDates.length : 0;

    const absentDeduction = roundMoney(dailyRate * absentDays);

    const halfDayDeduction = roundMoney(dailyRate * 0.5 * halfDays);

    const totalDeduction = roundMoney(
      Math.min(salary, absentDeduction + halfDayDeduction),
    );

    const netSalary = roundMoney(Math.max(0, salary - totalDeduction));

    return {
      employee,
      year,
      monthIndex,

      workingDays: monthDates.length,

      presentDays,
      lateDays,
      halfDays,
      absentDays,

      salary: roundMoney(salary),
      dailyRate: roundMoney(dailyRate),

      absentDeduction,
      halfDayDeduction,
      totalDeduction,
      netSalary,
    };
  }

  /* =====================================================
     8. STATUS / VALIDATION MESSAGE
  ===================================================== */

  function showMessage(message, type = "info") {
    const element = elements.message;

    if (!element) return;

    element.textContent = message || "";
    element.dataset.type = type;

    element.setAttribute("role", type === "error" ? "alert" : "status");

    element.style.color =
      type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "";
  }

  /* =====================================================
     9. ADMIN AND EMPLOYEE OVERVIEW CARDS
  ===================================================== */

  function updateOverview() {
    const period = getSelectedPeriod();

    if (currentRole === "admin") {
      const allEmployees = getEmployees();

      const payrolls = allEmployees.map((employee) =>
        calculatePayroll(employee, period.year, period.month),
      );

      const gross = payrolls.reduce((sum, payroll) => sum + payroll.salary, 0);

      const deductions = payrolls.reduce(
        (sum, payroll) => sum + payroll.totalDeduction,
        0,
      );

      const net = payrolls.reduce((sum, payroll) => sum + payroll.netSalary, 0);

      setText("payslip-total-employees", allEmployees.length);

      setText("payslip-gross-payroll", formatPKR(gross));

      setText("payslip-total-deductions", formatPKR(deductions));

      setText("payslip-net-payroll", formatPKR(net));
    } else {
      const payroll = calculatePayroll(currentUser, period.year, period.month);

      setText("employee-payslip-basic-salary", formatPKR(payroll.salary));

      setText("employee-payslip-deduction", formatPKR(payroll.totalDeduction));

      setText("employee-payslip-net-salary", formatPKR(payroll.netSalary));
    }
  }

  /* =====================================================
     10. RENDER INDIVIDUAL PAYSLIP
  ===================================================== */

  function renderPayslip(employee, payroll) {
    const company = getCompany();

    const selectedMonth = getMonthLabel(payroll.year, payroll.monthIndex);

    setText("payslip-company-name", company.name || "HCM Lite");

    setText("payslip-company-subtitle", "Employee Salary Statement");

    setText("payslip-period", selectedMonth);
    setText("payslip-status", "Generated");

    setText("payslip-employee-name", employee.name || "—");

    setText("payslip-employee-id", employee.id ?? "—");

    setText("payslip-employee-email", employee.email || "—");

    setText(
      "payslip-employee-department",
      employee.department || "Not assigned",
    );

    setText("payslip-detail-month", selectedMonth);
    setText("payslip-generated-date", formatDate());

    // Attendance summary

    setText("payslip-working-days", payroll.workingDays);
    setText("payslip-present-days", payroll.presentDays);
    setText("payslip-late-days", payroll.lateDays);
    setText("payslip-half-days", payroll.halfDays);
    setText("payslip-absent-days", payroll.absentDays);

    // Earnings

    setText("payslip-basic-salary", formatAmount(payroll.salary));

    setText("payslip-daily-rate", formatAmount(payroll.dailyRate));

    setText("payslip-gross-salary", formatAmount(payroll.salary));

    // Deductions

    setText("payslip-absent-deduction", formatAmount(payroll.absentDeduction));

    setText(
      "payslip-half-day-deduction",
      formatAmount(payroll.halfDayDeduction),
    );

    setText("payslip-deductions-total", formatAmount(payroll.totalDeduction));

    // Net salary

    setText("payslip-net-salary", formatPKR(payroll.netSalary));

    if (elements.preview) {
      elements.preview.hidden = false;
    }

    if (elements.emptyState) {
      elements.emptyState.hidden = true;
    }
  }

  /* =====================================================
     11. VIEW PAYSLIP FORM
  ===================================================== */

  function handleGeneratePayslip(event) {
    event.preventDefault();
    showMessage("");

    const monthNumber = Number(elements.month?.value);
    const year = Number(elements.year?.value);

    if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      showMessage("Please select a valid salary month.", "error");
      return;
    }

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      showMessage(
        "Please enter a valid salary year between 2000 and 2100.",
        "error",
      );
      return;
    }

    let employee = currentUser;

    // Admin can select an employee.
    // Employee is always restricted to their own account.

    if (currentRole === "admin") {
      const employeeId = elements.employeeFilter?.value;

      employee = getEmployees().find((item) => sameId(item.id, employeeId));

      if (!employee) {
        showMessage(
          "Please select an employee before viewing the payslip.",
          "error",
        );
        return;
      }
    }

    const payroll = calculatePayroll(employee, year, monthNumber - 1);

    renderPayslip(employee, payroll);

    showMessage(
      `Payslip ready for ${employee.name || "employee"} — ` +
        `${getMonthLabel(year, monthNumber - 1)}.`,
      "success",
    );
  }

  /* =====================================================
     12. ADMIN CSV EXPORT
  ===================================================== */

  function csvCell(value) {
    let text = String(value ?? "");

    // Protect text values from common spreadsheet formula injection.
    if (/^[\s]*[=+@\-]/.test(text)) {
      text = `'${text}`;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportPayrollCSV() {
    if (currentRole !== "admin") {
      showMessage("Only an Admin can export company payroll.", "error");
      return;
    }

    const period = getSelectedPeriod();
    const allEmployees = getEmployees();

    if (!allEmployees.length) {
      showMessage("There are no employee records to export yet.", "error");
      return;
    }

    const header = [
      "Employee ID",
      "Employee Name",
      "Email",
      "Department",
      "Salary Month",
      "Salary Year",
      "Monthly Salary (PKR)",
      "Working Days",
      "Present Days",
      "Late Days",
      "Half Days",
      "Absent Days",
      "Daily Rate (PKR)",
      "Absent Deduction (PKR)",
      "Half-Day Deduction (PKR)",
      "Total Deductions (PKR)",
      "Net Salary (PKR)",
    ];

    const rows = allEmployees.map((employee) => {
      const payroll = calculatePayroll(employee, period.year, period.month);

      return [
        employee.id,
        employee.name,
        employee.email,
        employee.department,
        getMonthLabel(period.year, period.month),
        period.year,
        payroll.salary.toFixed(2),
        payroll.workingDays,
        payroll.presentDays,
        payroll.lateDays,
        payroll.halfDays,
        payroll.absentDays,
        payroll.dailyRate.toFixed(2),
        payroll.absentDeduction.toFixed(2),
        payroll.halfDayDeduction.toFixed(2),
        payroll.totalDeduction.toFixed(2),
        payroll.netSalary.toFixed(2),
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");

    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;

    link.download =
      `HCM-Payroll-${period.year}-` +
      `${String(period.month + 1).padStart(2, "0")}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    showMessage(
      `Payroll CSV exported for ${getMonthLabel(period.year, period.month)}.`,
      "success",
    );
  }

  /* =====================================================
     13. REFRESH AFTER DATA CHANGES
  ===================================================== */

  function refreshData() {
    populateEmployeeFilter();
    updateOverview();

    if (elements.preview && !elements.preview.hidden) {
      const period = getSelectedPeriod();

      let employee = currentUser;

      if (currentRole === "admin") {
        employee = getEmployees().find((item) =>
          sameId(item.id, elements.employeeFilter?.value),
        );
      }

      if (employee) {
        renderPayslip(
          employee,
          calculatePayroll(employee, period.year, period.month),
        );
      } else {
        elements.preview.hidden = true;

        if (elements.emptyState) {
          elements.emptyState.hidden = false;
        }
      }
    }
  }

  /* =====================================================
     14. EVENT LISTENERS
  ===================================================== */

  function bindEvents() {
    if (elements.filterForm) {
      elements.filterForm.addEventListener("submit", handleGeneratePayslip);
    }

    [elements.month, elements.year].forEach((field) => {
      if (!field) return;

      field.addEventListener("change", () => {
        showMessage("");
        updateOverview();
      });
    });

    if (elements.employeeFilter) {
      elements.employeeFilter.addEventListener("change", () => showMessage(""));
    }

    if (elements.exportButton) {
      elements.exportButton.addEventListener("click", exportPayrollCSV);
    }

    if (elements.printButton) {
      elements.printButton.addEventListener("click", () => {
        if (!elements.preview || elements.preview.hidden) {
          showMessage(
            "Generate a payslip before printing or saving it as PDF.",
            "error",
          );
          return;
        }

        window.print();
      });
    }

    // Bind logout only to the current user's button.

    const logoutButton =
      currentRole === "admin"
        ? $("#payslip-admin-logout-button")
        : $("#payslip-employee-logout-button");

    if (logoutButton) {
      logoutButton.addEventListener("click", () => {
        if (window.HCMAuth) {
          window.HCMAuth.logout();
        }
      });
    }

    // Refresh when LocalStorage changes in another tab.

    const onDataChanged = () => {
      try {
        const latestUser = window.HCMAuth?.getCurrentUser();

        if (latestUser && latestUser.role === currentRole) {
          currentUser = latestUser;
        }

        refreshData();
      } catch (error) {
        console.error("[HCM Lite] Could not refresh payslip data.", error);
      }
    };

    window.addEventListener("storage", (event) => {
      const relevantKeys = [
        "hcm_users",
        "hcm_attendance",
        "hcm_leaves",
        "hcm_company",
      ];

      if (!event.key || relevantKeys.includes(event.key)) {
        onDataChanged();
      }
    });

    // Existing modules may dispatch these custom events.

    [
      "hcm:leaves-updated",
      "hcm:attendance-updated",
      "hcm:employees-updated",
      "hcm:company-updated",
    ].forEach((eventName) => {
      document.addEventListener(eventName, onDataChanged);

      window.addEventListener(eventName, onDataChanged);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        onDataChanged();
      }
    });
  }

  /* =====================================================
     15. INITIALIZATION
  ===================================================== */

  function initializePayslip() {
    try {
      if (!window.HCMStorage || !window.HCMAuth) {
        showMessage(
          "Payslip could not start. Load storage.js and auth.js before payslip.js.",
          "error",
        );

        console.error("[HCM Lite] Check the script order in payslip.html.");

        return;
      }

      // Shared page allows either valid role.
      currentUser = window.HCMAuth.requireAuth();

      // Auth module handles redirect when session is invalid.
      if (!currentUser) return;

      if (!["admin", "employee"].includes(currentUser.role)) {
        window.HCMAuth.logout();
        return;
      }

      currentRole = currentUser.role;

      // Default selection: current month and year.

      const period = getCurrentPeriod();

      if (elements.month) {
        elements.month.value = String(period.month + 1);
      }

      if (elements.year) {
        elements.year.value = String(period.year);
      }

      if (elements.preview) {
        elements.preview.hidden = true;
      }

      if (elements.emptyState) {
        elements.emptyState.hidden = false;
      }

      configureRoleView();
      populateProfile();
      populateEmployeeFilter();
      updateOverview();
      bindEvents();
    } catch (error) {
      console.error("[HCM Lite] Payslip initialization failed.", error);

      showMessage(
        "Payslip could not load. Check LocalStorage and script order, then reload.",
        "error",
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePayslip, {
      once: true,
    });
  } else {
    initializePayslip();
  }
})();
