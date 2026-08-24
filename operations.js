(function () {
  "use strict";

  var state = {
    client: null,
    catalog: { departments: [] },
    session: null,
    data: null,
    groups: { groups: [], allocations: [], holiday_mode: false },
    mode: { mode: "normal", conference_mode: false, holiday_mode: false },
    tools: null,
    studentServices: null,
    studentTermId: null,
    studentEdit: null,
    passReview: null,
    periodPreview: null,
    toastTimer: null,
    clinicTimer: null,
    initialViewApplied: false,
    scanStartedAt: 0,
    scanLastAt: 0,
    scanKeyCount: 0
  };

  function el(id) { return document.getElementById(id); }
  function all(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function value(id) { return String(el(id).value || "").trim(); }
  function escapeHtml(input) {
    return String(input == null ? "" : input)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function titleCase(input) { return String(input || "").replace(/_/g, " ").replace(/\b\w/g, function (x) { return x.toUpperCase(); }); }
  function parseNumber(input) { return input === "" || input == null ? null : Number(input); }
  function formatDate(input) {
    if (!input) return "Not set";
    var d = new Date(String(input).slice(0, 10) + "T12:00:00");
    return isNaN(d.getTime()) ? String(input) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function dateIso(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }
  function addDays(iso, days) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + days);
    return dateIso(d);
  }
  function today() { return dateIso(new Date()); }
  function mondayFor(iso) {
    var d = new Date(iso + "T12:00:00");
    var day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return dateIso(d);
  }
  function monthEnd(iso) {
    var d = new Date(iso + "T12:00:00");
    return dateIso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  }
  function departmentById(id) {
    return (state.data ? state.data.departments : state.catalog.departments || []).find(function (d) { return d.id === id; });
  }
  function departmentPath(id) {
    var names = [], seen = {}, department = departmentById(id), guard = 0;
    while (department && !seen[department.id] && guard < 6) {
      names.unshift(department.name);
      seen[department.id] = true;
      department = department.parent_department_id ? departmentById(department.parent_department_id) : null;
      guard += 1;
    }
    return names.join(" / ") || "Department";
  }
  function reportingSections(parentDepartmentId) {
    if (!state.data || !parentDepartmentId) return [];
    var parent = departmentById(parentDepartmentId);
    if (!parent || parent.slug !== "horticulture") return [];
    return (state.data.departments || []).filter(function (department) {
      return department.parent_department_id === parentDepartmentId
        && department.workspace_enabled === false
        && ["open-field", "greenhouses"].indexOf(department.slug) >= 0;
    });
  }
  function baseReportDepartmentId(prefix) {
    return isDepartment() ? currentDepartmentId() : value(prefix + "-department");
  }
  function configureReportingSection(prefix) {
    var sections = reportingSections(baseReportDepartmentId(prefix));
    var field = el(prefix + "-section-field");
    var select = el(prefix + "-section");
    var previous = select.value;
    fillSelect(select, sections, { first: "Choose section" });
    if (sections.some(function (section) { return section.id === previous; })) select.value = previous;
    field.hidden = !sections.length;
    select.required = !!sections.length;
    if (!sections.length) select.value = "";
    if (prefix === "daily") el("daily-horticulture-note").hidden = !sections.length;
  }
  function reportDepartmentId(prefix) {
    var parentId = baseReportDepartmentId(prefix);
    return reportingSections(parentId).length ? value(prefix + "-section") : parentId;
  }
  function slotById(id) { return (state.data.time_slots || []).find(function (s) { return s.id === id; }); }
  function taskById(id) { return (state.data.tasks || []).find(function (task) { return task.id === id; }); }
  function sessionById(id) { return (state.data.work_sessions || []).find(function (session) { return session.id === id; }); }
  function reportById(id) { return (state.data.reports || []).find(function (report) { return report.id === id; }); }
  function currentDepartmentId() { return state.session && state.session.department ? state.session.department.id : null; }
  function currentDepartmentSlug() { return state.session && state.session.department ? state.session.department.slug : ""; }
  function isDepartment() { return state.session && state.session.role === "department"; }
  function isLeadership() { return state.session && state.session.role === "student_leadership"; }
  function isManagement() { return state.session && ["management", "administrator"].indexOf(state.session.role) >= 0; }
  function isConference() { return !!(state.mode && state.mode.conference_mode); }
  function isKitchenWorkspace() { return isDepartment() && currentDepartmentSlug() === "kitchen"; }
  function isClinicWorkspace() { return isDepartment() && currentDepartmentSlug() === "clinic"; }
  function workspaceDefaultView() {
    if (isKitchenWorkspace()) return "meal-service";
    if (isClinicWorkspace()) return "clinic-service";
    return isDepartment() ? "tools" : "overview";
  }

  function toast(message, isError) {
    var box = el("toast");
    clearTimeout(state.toastTimer);
    box.textContent = message;
    box.classList.toggle("error", !!isError);
    box.hidden = false;
    state.toastTimer = setTimeout(function () { box.hidden = true; }, isError ? 7000 : 3800);
  }

  function setBusy(target, busy, busyLabel) {
    var button = target && target.tagName === "BUTTON" ? target : target && target.querySelector("button[type=submit]");
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel || "Working...";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  async function rpc(name, args) {
    el("connection-state").textContent = "Working";
    el("connection-state").className = "status-pill amber";
    var response = await state.client.rpc(name, args || {});
    if (response.error) {
      el("connection-state").textContent = navigator.onLine ? "Error" : "Offline";
      el("connection-state").className = "status-pill red";
      throw response.error;
    }
    var data = response.data;
    if (data && ["unauthorized", "locked"].indexOf(data.status) >= 0 && name !== "ops_login") {
      signOut(false);
      throw new Error(data.message || "Your session has ended.");
    }
    el("connection-state").textContent = "Connected";
    el("connection-state").className = "status-pill green";
    return data;
  }

  function fillSelect(select, items, config) {
    if (!select) return;
    config = config || {};
    var previous = select.value;
    var first = config.first == null ? "" : '<option value="">' + escapeHtml(config.first) + "</option>";
    select.innerHTML = first + items.map(function (item) {
      var id = config.id ? item[config.id] : item.id;
      var label = config.label ? item[config.label] : item.name;
      return '<option value="' + escapeHtml(id) + '">' + escapeHtml(label) + "</option>";
    }).join("");
    if (items.some(function (item) { return String(config.id ? item[config.id] : item.id) === previous; })) select.value = previous;
  }

  async function loadCatalog() {
    var data = await rpc("ops_catalog");
    state.catalog = data;
    fillSelect(el("login-department"), data.departments || [], { id: "slug", label: "name", first: "Choose department" });
  }

  function storeSession(session) {
    state.session = session;
    state.initialViewApplied = false;
    sessionStorage.setItem("amfcc_ops_session", JSON.stringify(session));
  }

  function restoreSession() {
    try {
      var raw = sessionStorage.getItem("amfcc_ops_session");
      if (!raw) return false;
      state.session = JSON.parse(raw);
      state.initialViewApplied = false;
      return !!(state.session && state.session.session_token);
    } catch (error) {
      sessionStorage.removeItem("amfcc_ops_session");
      return false;
    }
  }

  function showLogin() {
    el("login-screen").hidden = false;
    el("app-shell").hidden = true;
    el("access-code").value = "";
  }

  function showApp() {
    el("login-screen").hidden = true;
    el("app-shell").hidden = false;
    el("workspace-title").textContent = state.session.display_name || titleCase(state.session.role);
    el("workspace-subtitle").textContent = state.session.role === "department"
      ? (isKitchenWorkspace() ? "Daily meal service, food planning, stock and reporting" : isClinicWorkspace() ? "Clinic register, medication stock and reporting" : "Purpose-built operations, reporting and support requests")
      : titleCase(state.session.role) + " workspace";
    applyRoleVisibility();
  }

  function applyRoleVisibility() {
    var role = state.session.role;
    all("[data-roles]").forEach(function (node) {
      node.hidden = node.dataset.roles.split(",").indexOf(role) < 0;
    });
    all("[data-department-slug]").forEach(function (node) {
      var roleAllowed = !node.dataset.roles || node.dataset.roles.split(",").indexOf(role) >= 0;
      var departmentAllowed = role === "administrator" || (role === "department" && currentDepartmentSlug() === node.dataset.departmentSlug);
      node.hidden = !roleAllowed || !departmentAllowed;
    });
    var overviewButton = el("main-nav").querySelector('[data-view="overview"]');
    if (overviewButton) overviewButton.hidden = role === "department" && ["kitchen", "clinic"].indexOf(currentDepartmentSlug()) >= 0;
    applyDepartmentNavigation();
    all(".admin-department-field").forEach(function (node) { node.hidden = role === "department"; });
    all(".department-entry").forEach(function (node) { node.hidden = role === "student_leadership"; });
    all("[data-ss-admin-only]").forEach(function (node) { node.hidden = role !== "administrator"; });
    var active = el("main-nav").querySelector("button.active");
    applyOperatingModeVisibility();
    if (active && active.hidden && state.data) switchView(workspaceDefaultView());
  }

  function applyOperatingModeVisibility() {
    var conference = isConference();
    ["requests","planner","assignments"].forEach(function (view) {
      var button = document.querySelector('#main-nav button[data-view="' + view + '"]');
      if (button) {
        var allowed = !button.dataset.roles || button.dataset.roles.split(",").indexOf(state.session.role) >= 0;
        button.hidden = conference || !allowed;
      }
    });
    el("overview-session-panel").hidden = conference;
    var banner = el("operating-mode-banner");
    banner.hidden = state.mode.mode === "normal" && !conference;
    banner.className = "operating-mode-banner " + (conference ? "conference" : state.mode.mode);
    el("operating-mode-title").textContent = state.mode.combined_label || state.mode.label || titleCase(state.mode.mode) + " Mode";
    el("operating-mode-message").textContent = conference
      ? (state.mode.holiday_mode ? "Holiday calendar rules remain active. " : "School Term calendar rules remain active. ") + "Conference Mode removes manual-work sessions and meal deadlines. Record every piece of work as an Emergency task."
      : "Morning and Afternoon task sessions are available during Holiday Mode.";
    if (conference) {
      el("task-type").value = "emergency";
      el("task-priority").value = "critical";
      el("task-type").disabled = true;
      el("task-priority").disabled = true;
      var active = el("main-nav").querySelector("button.active");
      if (active && ["requests","planner","assignments"].indexOf(active.dataset.view) >= 0) switchView("tasks");
    } else {
      el("task-type").disabled = false;
      el("task-priority").disabled = false;
    }
  }

  async function signOut(callServer) {
    if (callServer !== false && state.session && state.session.session_token) {
      try { await rpc("ops_logout", { p_session_token: state.session.session_token }); } catch (error) { /* local logout still proceeds */ }
    }
    state.session = null;
    state.initialViewApplied = false;
    state.data = null;
    state.studentServices = null;
    state.studentEdit = null;
    state.passReview = null;
    sessionStorage.removeItem("amfcc_ops_session");
    showLogin();
  }

  async function loadData(showMessage) {
    if (!state.session) return;
    var from = value("range-from") || today();
    state.mode = await rpc("system_mode_status");
    var data = await rpc("ops_bootstrap", {
      p_session_token: state.session.session_token,
      p_from_date: from,
      p_to_date: addDays(from, 21)
    });
    state.data = data;
    state.groups = await rpc("ops_group_planner", {
      p_session_token: state.session.session_token,
      p_from_date: from,
      p_to_date: addDays(from, 21)
    });
    (state.data.session_requests || []).forEach(function (request) {
      request.request_kind = (state.groups.request_kinds || {})[request.id] || "planned";
    });
    if (isDepartment()) await loadDepartmentTools(currentDepartmentId());
    if (!isDepartment()) await loadStudentServices();
    else state.studentServices = null;
    renderAll();
    if (showMessage) toast("Workspace refreshed.");
  }

  async function loadDepartmentTools(departmentId) {
    if (!departmentId) { state.tools = null; return; }
    state.tools = await rpc("ops_department_tools_bootstrap", {
      p_session_token: state.session.session_token,
      p_department_id: departmentId,
      p_from_date: addDays(today(), -30),
      p_to_date: addDays(today(), 35)
    });
  }

  function statusPill(status) {
    status = status || "neutral";
    return '<span class="status-pill ' + escapeHtml(status) + '">' + escapeHtml(titleCase(status)) + "</span>";
  }

  function populateWorkspaceInputs() {
    var departments = (state.data.departments || []).filter(function (d) { return d.workspace_enabled !== false; });
    var selectors = ["task-department","request-department","daily-department","period-department","transfer-from","transfer-to","task-list-department","action-department","tools-department"];
    selectors.forEach(function (id) {
      var node = el(id);
      if (!node) return;
      var first = id === "task-list-department" ? "All departments" : id === "action-department" ? "Institution-wide" : null;
      fillSelect(node, departments, { first: first });
      if (isDepartment() && id !== "transfer-to") node.value = currentDepartmentId();
    });
    var requestSlots = isConference() ? [] : (state.data.time_slots || []).filter(function (slot) { return !state.groups.holiday_mode || ["morning","afternoon"].indexOf(slot.code) >= 0; });
    fillSelect(el("request-slot"), requestSlots, { first: "Choose session" });
    el("request-rules").textContent = isConference()
      ? "Conference Mode is active. Manual-work sessions are disabled. Add all work under Tasks as Emergency work."
      : state.groups.holiday_mode
      ? "Holiday mode is active. Morning and Afternoon slots are available. Next-day planned requests close at 6:00 pm."
      : "Next-day planned requests close at 6:00 pm. Use Unexpected task only for genuinely unforeseen work.";
    if (!isDepartment() && el("tools-department") && !el("tools-department").value && departments.length) el("tools-department").value = departments[0].id;
    configureReportingSection("daily");
    configureReportingSection("period");

    var datalist = el("staff-name-options");
    datalist.innerHTML = (state.data.staff_directory || []).map(function (person) {
      return '<option value="' + escapeHtml(person.full_name) + '"></option>';
    }).join("");
  }

  function renderSummary() {
    var todayIso = today();
    var openTasks = (state.data.tasks || []).filter(function (t) { return ["done","cancelled"].indexOf(t.status) < 0; });
    var sessions = isConference() ? [] : (state.data.work_sessions || []).filter(function (s) { return s.work_date >= todayIso && s.status !== "cancelled"; });
    var pending = isConference() ? [] : (state.data.session_requests || []).filter(function (r) { return r.status === "pending"; });
    var reports = (state.data.reports || []).filter(function (r) { return ["submitted","verified","returned"].indexOf(r.status) >= 0; });
    var cards = [
      [openTasks.length,"Open tasks",openTasks.some(function (t) { return t.status === "blocked"; })],
      [sessions.length,"Upcoming sessions",false],
      [pending.length,"Session requests",pending.length > 0 && !isDepartment()],
      [reports.length,isDepartment() ? "Reports in review" : "Reports needing action",reports.some(function (r) { return r.status === "returned"; })]
    ];
    el("summary-cards").innerHTML = cards.map(function (card) {
      return '<article class="summary-card' + (card[2] ? " alert" : "") + '"><div class="label">' + escapeHtml(card[1]) + '</div><div class="value">' + card[0] + "</div></article>";
    }).join("");
  }

  function renderOverviewSessions() {
    if (isConference()) {
      el("session-count").textContent = "0";
      el("overview-sessions").classList.add("empty-state");
      el("overview-sessions").textContent = "Manual-work sessions are unavailable in Conference Mode.";
      return;
    }
    var items = (state.data.work_sessions || []).filter(function (session) { return session.work_date >= today() && session.status !== "cancelled"; }).slice(0, 8);
    el("session-count").textContent = String(items.length);
    el("overview-sessions").classList.toggle("empty-state", !items.length);
    el("overview-sessions").innerHTML = items.length ? items.map(function (session) {
      var department = departmentById(session.department_id);
      var slot = slotById(session.slot_id);
      var allocations = (state.groups.allocations || []).filter(function (a) { return a.session_id === session.id; });
      var labels = allocations.map(function (a) {
        var group = (state.groups.groups || []).find(function (g) { return g.code === a.group_code; });
        return a.headcount + " " + (group ? group.label : titleCase(a.group_code));
      }).join(", ");
      var assignedCount = allocations.reduce(function (sum, a) { return sum + Number(a.headcount || 0); }, 0);
      var actions = "";
      if (isDepartment() && session.department_id === currentDepartmentId() && ["published","in_progress"].indexOf(session.status) >= 0) {
        actions = '<div class="card-actions">' + (session.status === "published" ? '<button class="button secondary session-status" data-id="' + session.id + '" data-status="in_progress">Start session</button>' : '') + '<button class="button primary session-status" data-id="' + session.id + '" data-status="completed">Complete session</button></div>';
      }
      return '<article class="data-card"><div class="card-top"><div><h3>' + escapeHtml(department ? department.name : "Department") + '</h3><p>' + escapeHtml(formatDate(session.work_date)) + " · " + escapeHtml(slot ? slot.name : "Session") + '</p></div>' + statusPill(session.status) + '</div><div class="card-meta"><span>' + assignedCount + " / " + session.allocated_headcount + ' assigned</span></div>' + (labels ? '<p><strong>Groups:</strong> ' + escapeHtml(labels) + "</p>" : '<p class="muted">Student Leadership has not published group allocations yet.</p>') + actions + "</article>";
    }).join("") : "No sessions published yet.";
  }

  function renderNotifications() {
    var items = state.data.notifications || [];
    var unread = items.filter(function (n) { return !n.read; }).length;
    el("notification-count").textContent = String(unread);
    el("notification-list").classList.toggle("empty-state", !items.length);
    el("notification-list").innerHTML = items.length ? items.slice(0, 10).map(function (notice) {
      return '<article class="data-card ' + (notice.read ? "read" : "") + '"><div class="card-top"><div><h3>' + escapeHtml(notice.title) + '</h3><p>' + escapeHtml(notice.message) + '</p></div>' + (!notice.read ? '<button class="button quiet mark-read" data-id="' + notice.id + '">Mark read</button>' : '') + '</div><div class="card-meta"><span>' + escapeHtml(formatDate(notice.created_at)) + "</span></div></article>";
    }).join("") : "No new notifications.";
  }

  function renderAttention() {
    var taskItems = (state.data.tasks || []).filter(function (task) {
      return task.status === "blocked" || (task.due_date && task.due_date < today() && ["done","cancelled"].indexOf(task.status) < 0);
    });
    var returned = (state.data.reports || []).filter(function (report) { return report.status === "returned"; });
    var html = taskItems.slice(0, 8).map(function (task) {
      var department = departmentById(task.department_id);
      return '<article class="data-card ' + (task.status === "blocked" ? "alert" : "warning") + '"><div class="card-top"><div><h3>' + escapeHtml(task.title) + '</h3><p>' + escapeHtml(department ? department.name : "") + '</p></div>' + statusPill(task.status) + '</div><div class="card-meta"><span>Due ' + escapeHtml(formatDate(task.due_date)) + "</span></div></article>";
    }).join("");
    html += returned.map(function (report) {
      return '<article class="data-card alert"><h3>Report returned: ' + escapeHtml(departmentPath(report.department_id)) + '</h3><p>' + escapeHtml(report.return_reason || "Changes requested") + "</p></article>";
    }).join("");
    el("attention-list").classList.toggle("empty-state", !html);
    el("attention-list").innerHTML = html || "Nothing currently needs attention.";
  }

  function renderTasks() {
    var filter = value("task-filter") || "open";
    var departmentFilter = value("task-list-department");
    var tasks = (state.data.tasks || []).filter(function (task) {
      if (departmentFilter && task.department_id !== departmentFilter) return false;
      if (filter === "open") return ["done","cancelled"].indexOf(task.status) < 0;
      if (filter === "done") return task.status === "done";
      if (filter === "blocked") return task.status === "blocked";
      return true;
    });
    el("task-list").classList.toggle("empty-state", !tasks.length);
    el("task-list").innerHTML = tasks.length ? tasks.map(function (task) {
      var department = departmentById(task.department_id);
      var displayType = isConference() ? "emergency" : task.task_type;
      var displayPriority = isConference() ? "critical" : task.priority;
      return '<article class="data-card ' + (task.status === "blocked" || isConference() ? "alert" : "") + '"><div class="card-top"><div><h3>' + escapeHtml(task.title) + '</h3><p>' + escapeHtml(department ? department.name : "") + " · " + escapeHtml(titleCase(displayType)) + " · " + escapeHtml(titleCase(task.cadence)) + '</p></div>' + statusPill(task.status) + '</div>' + (task.description ? '<p>' + escapeHtml(task.description) + "</p>" : "") + '<div class="card-meta"><span>Priority: ' + escapeHtml(titleCase(displayPriority)) + '</span><span>Due: ' + escapeHtml(formatDate(task.due_date)) + '</span><span>People: ' + task.requested_people + '</span><span>Owner: ' + escapeHtml(task.owner_name || "Not assigned") + '</span></div><div class="card-actions"><button class="button secondary edit-task" data-id="' + task.id + '">Edit</button></div></article>';
    }).join("") : "No tasks match this view.";
    var availableTasks = (state.data.tasks || []).filter(function (task) { return ["done","cancelled"].indexOf(task.status) < 0 && (!isDepartment() || task.department_id === currentDepartmentId()); });
    fillSelect(el("request-tasks"), availableTasks, { id: "id", label: "title" });
  }

  function renderRequests() {
    var requests = state.data.session_requests || [];
    el("request-list").classList.toggle("empty-state", !requests.length);
    el("request-list").innerHTML = requests.length ? requests.map(function (request) {
      var department = departmentById(request.department_id);
      var slot = slotById(request.slot_id);
      var taskNames = (request.task_ids || []).map(function (id) { var task = taskById(id); return task ? task.title : null; }).filter(Boolean).join(", ");
      return '<article class="data-card ' + (request.request_kind === "unexpected" ? "warning" : "") + '"><div class="card-top"><div><h3>' + escapeHtml(department ? department.name : "Department") + '</h3><p>' + escapeHtml(formatDate(request.work_date)) + " · " + escapeHtml(slot ? slot.name : "Session") + " · " + escapeHtml(titleCase(request.request_kind || "planned")) + '</p></div>' + statusPill(request.status) + '</div><p><strong>Requested:</strong> ' + request.requested_headcount + (request.allocated_headcount != null ? " · Allocated: " + request.allocated_headcount : "") + '</p>' + (taskNames ? '<p><strong>Tasks:</strong> ' + escapeHtml(taskNames) + "</p>" : "") + (request.decision_notes ? '<p><strong>Decision:</strong> ' + escapeHtml(request.decision_notes) + "</p>" : "") + "</article>";
    }).join("") : "No session requests in this period.";
  }

  function renderPlanner() {
    var requests = (state.data.session_requests || []).filter(function (request) { return request.status === "pending"; });
    el("planner-board").classList.toggle("empty-state", !requests.length);
    el("planner-board").innerHTML = requests.length ? requests.map(function (request) {
      var department = departmentById(request.department_id);
      var slot = slotById(request.slot_id);
      return '<article class="planner-card ' + (request.request_kind === "unexpected" ? "warning" : "") + '" data-request="' + request.id + '"><div class="card-top"><div><h3>' + escapeHtml(department ? department.name : "Department") + '</h3><p>' + escapeHtml(formatDate(request.work_date)) + " · " + escapeHtml(slot ? slot.name : "Session") + " · " + escapeHtml(titleCase(request.request_kind || "planned")) + '</p></div><span class="count-badge">' + request.requested_headcount + '</span></div><p>' + escapeHtml(request.request_notes || "No note supplied.") + '</p><div class="allocate-row"><label>Approve or edit total<input class="planner-allocation" type="number" min="1" max="100" value="' + request.requested_headcount + '"></label><label class="check-row"><input class="planner-publish" type="checkbox" checked> Publish</label><textarea class="planner-notes" rows="2" placeholder="Decision note"></textarea><button class="button primary planner-approve" type="button">Approve</button><button class="button danger planner-decline" type="button">Decline</button></div></article>';
    }).join("") : "No pending requests.";
  }

  function renderAssignmentControls() {
    var sessions = (state.data.work_sessions || []).filter(function (session) { return session.status !== "cancelled" && session.work_date >= today(); });
    var previous = el("assignment-session").value;
    el("assignment-session").innerHTML = '<option value="">Choose a session</option>' + sessions.map(function (session) {
      var department = departmentById(session.department_id);
      var slot = slotById(session.slot_id);
      return '<option value="' + session.id + '">' + escapeHtml(formatDate(session.work_date) + " · " + (slot ? slot.name : "Session") + " · " + (department ? department.name : "Department") + " · " + session.allocated_headcount + " places") + "</option>";
    }).join("");
    if (sessions.some(function (session) { return session.id === previous; })) el("assignment-session").value = previous;
    renderGroupAssignments();
  }

  function groupInputId(code) { return "group-" + code.replace(/_/g, "-"); }

  function groupAvailableForSession(group, session) {
    var usedElsewhere = (state.groups.allocations || []).filter(function (allocation) {
      return allocation.group_code === group.code && allocation.session_id !== session.id &&
        allocation.work_date === session.work_date && allocation.slot_id === session.slot_id;
    }).reduce(function (sum, allocation) { return sum + Number(allocation.headcount || 0); }, 0);
    return Math.max(0, Number(group.total || 0) - usedElsewhere);
  }

  function renderGroupAssignments() {
    var sessionId = value("assignment-session");
    var groups = state.groups.groups || [];
    el("group-capacity-cards").innerHTML = groups.map(function (group) {
      return '<article class="summary-card"><div class="label">' + escapeHtml(group.label) + '</div><div class="value">' + Number(group.total || 0) + '</div><small>available now</small></article>';
    }).join("");
    if (!sessionId) {
      groups.forEach(function (group) { var input = el(groupInputId(group.code)); if (input) input.value = "0"; });
      el("group-session-capacity").textContent = "Choose a published session to see availability for that date and slot.";
      return;
    }
    var session = sessionById(sessionId);
    var existing = state.groups.allocations || [];
    groups.forEach(function (group) {
      var allocation = existing.find(function (item) { return item.session_id === sessionId && item.group_code === group.code; });
      var input = el(groupInputId(group.code));
      if (input) { input.value = allocation ? allocation.headcount : 0; input.max = groupAvailableForSession(group, session); }
    });
    el("group-session-capacity").innerHTML = '<strong>' + session.allocated_headcount + ' approved places.</strong> ' + groups.map(function (group) {
      return escapeHtml(group.label) + ': ' + groupAvailableForSession(group, session) + ' available';
    }).join(' · ');
  }

  function renderReports() {
    var filter = value("report-review-filter") || "review";
    var reports = (state.data.reports || []).filter(function (report) {
      if (filter === "review") return ["submitted","verified","returned"].indexOf(report.status) >= 0;
      if (filter === "approved") return ["approved","locked"].indexOf(report.status) >= 0;
      return true;
    });
    el("report-review-list").classList.toggle("empty-state", !reports.length);
    el("report-review-list").innerHTML = reports.length ? reports.map(function (report) {
      var actions = [];
      if (["submitted"].indexOf(report.status) >= 0 && ["student_leadership","management","administrator"].indexOf(state.session.role) >= 0) actions.push('<button class="button secondary report-transition" data-id="' + report.id + '" data-status="verified">Verify</button>');
      if (report.status === "verified" && isManagement()) actions.push('<button class="button primary report-transition" data-id="' + report.id + '" data-status="approved">Approve and queue Jira</button>');
      if (["submitted","verified"].indexOf(report.status) >= 0) actions.push('<button class="button quiet report-transition" data-id="' + report.id + '" data-status="returned">Return</button>');
      if (report.status === "approved" && isManagement()) actions.push('<button class="button secondary report-transition" data-id="' + report.id + '" data-status="locked">Lock</button>');
      var metrics = (report.metrics || []).map(function (metric) { return escapeHtml(metric.metric_name) + ": " + escapeHtml(metric.actual_value == null ? "not set" : metric.actual_value) + " " + escapeHtml(metric.unit || "") + " (" + escapeHtml(metric.status) + ")"; }).join("<br>");
      return '<article class="data-card"><div class="card-top"><div><h3>' + escapeHtml(departmentPath(report.department_id) + " · " + titleCase(report.report_type)) + '</h3><p>' + escapeHtml(formatDate(report.period_start)) + " to " + escapeHtml(formatDate(report.period_end)) + '</p></div>' + statusPill(report.status) + '</div>' + (report.summary ? '<p><strong>Summary:</strong> ' + escapeHtml(report.summary) + "</p>" : "") + (report.work_completed ? '<p><strong>Completed:</strong> ' + escapeHtml(report.work_completed) + "</p>" : "") + (report.challenges ? '<p><strong>Challenges:</strong> ' + escapeHtml(report.challenges) + "</p>" : "") + (report.return_reason ? '<p><strong>Return reason:</strong> ' + escapeHtml(report.return_reason) + "</p>" : "") + (metrics ? '<p><strong>Figures:</strong><br>' + metrics + "</p>" : "") + (report.jira_issue_url ? '<p><a href="' + escapeHtml(report.jira_issue_url) + '" target="_blank" rel="noopener">Open Jira issue ' + escapeHtml(report.jira_issue_key) + "</a></p>" : "") + '<div class="card-actions">' + actions.join("") + "</div></article>";
    }).join("") : "No reports match this view.";
  }

  function renderTransfers() {
    var items = state.data.transfers || [];
    el("transfer-list").classList.toggle("empty-state", !items.length);
    el("transfer-list").innerHTML = items.length ? items.map(function (transfer) {
      var from = departmentById(transfer.from_department_id);
      var to = departmentById(transfer.to_department_id);
      var lines = (transfer.items || []).map(function (item) { return escapeHtml(item.quantity + " " + item.unit + " " + item.item_name); }).join(", ");
      var receive = transfer.status === "sent" && (isManagement() || (isDepartment() && currentDepartmentId() === transfer.to_department_id))
        ? '<div class="card-actions"><button class="button primary receive-transfer" data-id="' + transfer.id + '" data-decision="received">Receive</button><button class="button quiet receive-transfer" data-id="' + transfer.id + '" data-decision="disputed">Dispute</button></div>' : "";
      return '<article class="data-card"><div class="card-top"><div><h3>' + escapeHtml((from ? from.name : "Department") + " → " + (to ? to.name : "Department")) + '</h3><p>' + escapeHtml(formatDate(transfer.transfer_date)) + '</p></div>' + statusPill(transfer.status) + '</div><p>' + lines + '</p><div class="card-meta"><span>Sent by ' + escapeHtml(transfer.sent_by_name) + '</span>' + (transfer.received_by_name ? '<span>Received by ' + escapeHtml(transfer.received_by_name) + "</span>" : "") + "</div>" + receive + "</article>";
    }).join("") : "No transfers in this period.";
  }

  function toolProfile(slug) {
    var base = {
      eyebrow: "Department operations",
      title: "Department work and resources",
      description: "Plan work, track resources and record the figures this department needs.",
      plan: "Plan department work", planTypeLabel: "Plan type", planTypePlaceholder: "Enter a type", planTitleLabel: "Work plan", planTitlePlaceholder: "Enter the plan",
      stock: "Add stock or equipment", stockNameLabel: "Item or equipment", stockCategoryLabel: "Category", stockCategoryPlaceholder: "Enter your own category", stockUnitLabel: "Unit", stockUnitPlaceholder: "Enter a unit",
      log: "Record department activity", logTypeLabel: "Record type", logTypePlaceholder: "Enter a type", logTitleLabel: "Activity", logTitlePlaceholder: "Describe the activity", quantityLabel: "Quantity", logUnitLabel: "Unit",
      nav: {},
      workflow: [["Work planning","Plan the department's actual workload."],["Resources","Track the stock and equipment the department uses."],["Operational record","Keep dated records for reporting and follow-up."]]
    };
    var profiles = {
      "it-department": { eyebrow:"IT operations",title:"IT service desk and assets",description:"Manage technology work, devices, network issues, repairs and service history.",plan:"Plan IT maintenance and improvements",planTypeLabel:"IT work type",planTypePlaceholder:"Incident, maintenance, installation or improvement",planTitleLabel:"System or work item",planTitlePlaceholder:"Describe the IT work",stock:"Register device, part or supply",stockNameLabel:"Device, part or supply",stockCategoryLabel:"Asset category",stockCategoryPlaceholder:"Enter the category used by IT",stockUnitPlaceholder:"device, cable, licence, item",log:"Record incident or service work",logTypeLabel:"IT record type",logTypePlaceholder:"Incident, repair, setup, update or inspection",logTitleLabel:"System or issue",logTitlePlaceholder:"What was worked on?",quantityLabel:"Devices affected",nav:{tasks:"IT work queue",requests:"Support requests",tools:"IT service and assets"},workflow:[["Service desk","Record faults, fixes and follow-up work."],["Devices and parts","Track equipment, spares and consumables."],["Network and systems","Plan checks, installations and maintenance."]]},
      "husbandry": { eyebrow:"Animal husbandry",title:"Animal care and production",description:"Plan animal care, manage feed and supplies, and record health, production and losses.",plan:"Plan animal care",planTypeLabel:"Care plan type",planTypePlaceholder:"Routine, health, breeding or facility work",planTitleLabel:"Animal group or work",planTitlePlaceholder:"Describe the care plan",stock:"Add feed or husbandry supply",stockNameLabel:"Feed, medicine or supply",stockCategoryLabel:"Supply category",stockCategoryPlaceholder:"Enter the husbandry category",stockUnitPlaceholder:"kg, bag, bottle, item",log:"Record animal care or production",logTypeLabel:"Husbandry record type",logTypePlaceholder:"Feeding, health, breeding, production or loss",logTitleLabel:"Animal group or event",quantityLabel:"Animals or output",nav:{tasks:"Animal care work",tools:"Animal care and feed"},workflow:[["Daily animal care","Plan routine care and facility work."],["Feed and supplies","Track quantities received, used and remaining."],["Health and production","Record checks, treatment, output and losses."]]},
      "horticulture": { eyebrow:"Horticulture operations",title:"Open Field and Greenhouses",description:"One Horticulture workspace for crop planning, inputs, harvests and two separate reporting sections.",plan:"Plan crop work",planTypeLabel:"Crop plan type",planTypePlaceholder:"Planting, watering, crop care or harvest",planTitleLabel:"Crop, field or greenhouse",planTitlePlaceholder:"Describe the crop plan",stock:"Add seed, input or material",stockNameLabel:"Seed, input or material",stockCategoryLabel:"Input category",stockCategoryPlaceholder:"Enter the horticulture category",stockUnitPlaceholder:"kg, litre, tray, packet, item",log:"Record crop or harvest activity",logTypeLabel:"Crop record type",logTypePlaceholder:"Planting, watering, treatment, harvest or loss",logTitleLabel:"Crop and section",quantityLabel:"Area or output",nav:{tasks:"Crop work",requests:"Request field support","daily-report":"Section report","period-report":"Section summaries",tools:"Crops, inputs and harvests"},workflow:[["Open Field","Plan field work and submit its report separately."],["Greenhouses","Manage Greenhouses 1, 2 and 3 and submit one Greenhouses report."],["Inputs and harvests","Track seed, materials, treatments, output and losses."]]},
      "maintenance": { eyebrow:"Maintenance operations",title:"Faults, repairs and preventive work",description:"Run the maintenance job queue, manage parts and tools, and record repair history.",plan:"Plan maintenance jobs",planTypeLabel:"Maintenance type",planTypePlaceholder:"Fault, repair, inspection or preventive work",planTitleLabel:"Asset or location",planTitlePlaceholder:"What needs maintenance?",stock:"Add spare, material or tool",stockNameLabel:"Part, material or tool",stockCategoryLabel:"Maintenance category",stockCategoryPlaceholder:"Enter the maintenance category",stockUnitPlaceholder:"item, metre, litre, box",log:"Record job progress or equipment work",logTypeLabel:"Maintenance record type",logTypePlaceholder:"Inspection, repair, servicing or completion",logTitleLabel:"Asset, location or job",quantityLabel:"Items or hours",nav:{tasks:"Maintenance jobs",requests:"Request work crew",tools:"Repairs, spares and tools"},workflow:[["Fault queue","Turn faults into trackable repair jobs."],["Preventive work","Plan inspections and regular servicing."],["Spares and tools","Track parts, materials, equipment and usage."]]},
      "painting": { eyebrow:"Painting operations",title:"Painting jobs and materials",description:"Plan surfaces and rooms, manage paint and tools, and record preparation and completion.",plan:"Plan painting jobs",planTypeLabel:"Job type",planTypePlaceholder:"Preparation, painting, touch-up or restoration",planTitleLabel:"Area or item",planTitlePlaceholder:"What is being painted?",stock:"Add paint, material or tool",stockNameLabel:"Paint, material or tool",stockCategoryLabel:"Material category",stockCategoryPlaceholder:"Enter the painting category",stockUnitPlaceholder:"litre, tin, roll, item",log:"Record painting progress",logTypeLabel:"Painting record type",logTypePlaceholder:"Preparation, coat, completion, usage or issue",logTitleLabel:"Area or job",quantityLabel:"Area or material",nav:{tasks:"Painting jobs",tools:"Jobs, paint and tools"},workflow:[["Job preparation","Plan surfaces, colours and preparation work."],["Paint and materials","Track paint, consumables and tools."],["Progress records","Record coats, completed areas and issues."]]},
      "flowers": { eyebrow:"Flower operations",title:"Flower cultivation and harvest",description:"Plan flower care, track growing inputs, and record harvests, losses and distribution.",plan:"Plan flower work",planTypeLabel:"Cultivation plan type",planTypePlaceholder:"Planting, watering, care or harvest",planTitleLabel:"Bed, variety or work",stock:"Add seed, input or material",stockNameLabel:"Seed, input or material",stockCategoryLabel:"Growing category",stockCategoryPlaceholder:"Enter the flower category",stockUnitPlaceholder:"packet, tray, litre, kg, item",log:"Record flower activity",logTypeLabel:"Flower record type",logTypePlaceholder:"Planting, treatment, harvest, distribution or loss",logTitleLabel:"Bed, variety or event",quantityLabel:"Stems or output",nav:{tasks:"Flower work",tools:"Cultivation and harvests"},workflow:[["Cultivation","Plan beds, care and seasonal work."],["Growing inputs","Track seed, treatments and materials."],["Harvest and losses","Record output, distribution and losses."]]},
      "poultry": { eyebrow:"Poultry operations",title:"Flocks, feed and production",description:"Manage flock work, feed position, production, health events and losses.",plan:"Plan poultry work",planTypeLabel:"Flock plan type",planTypePlaceholder:"Feeding, health, housing or production",planTitleLabel:"Flock or work",stock:"Add feed or poultry supply",stockNameLabel:"Feed, medicine or supply",stockCategoryLabel:"Poultry category",stockCategoryPlaceholder:"Enter the poultry category",stockUnitPlaceholder:"kg, bag, bottle, tray, item",log:"Record flock or production activity",logTypeLabel:"Poultry record type",logTypePlaceholder:"Feed, health, eggs, growth, mortality or transfer",logTitleLabel:"Flock or event",quantityLabel:"Birds or output",nav:{tasks:"Flock work",tools:"Flocks, feed and production"},workflow:[["Flock care","Plan daily care, health and housing work."],["Feed position","Track feed received, used and remaining."],["Production and losses","Record output, growth, mortality and movements."]]},
      "layers": { eyebrow:"Layers operations",title:"Layer flock and egg production",description:"Manage layer feed, flock health, egg production, breakages and transfers.",plan:"Plan layer work",planTypeLabel:"Layer plan type",planTypePlaceholder:"Feeding, flock care, housing or egg work",planTitleLabel:"Flock or work",stock:"Add layer feed or supply",stockNameLabel:"Feed, medicine or supply",stockUnitPlaceholder:"kg, bag, bottle, tray, item",log:"Record egg or flock activity",logTypeLabel:"Layer record type",logTypePlaceholder:"Eggs, feed, health, mortality or transfer",logTitleLabel:"Flock or event",quantityLabel:"Eggs or birds",nav:{tasks:"Layer flock work",tools:"Layers, feed and eggs"},workflow:[["Layer care","Plan feeding, health and housing work."],["Feed stock","Track feed deliveries, use and balance."],["Egg production","Record eggs, breakages, losses and transfers."]]},
      "broilers": { eyebrow:"Broiler operations",title:"Broiler batches, feed and growth",description:"Manage broiler batches, feed remaining, growth checks, health events and losses.",plan:"Plan broiler batch work",planTypeLabel:"Batch plan type",planTypePlaceholder:"Feeding, growth, health or housing",planTitleLabel:"Batch or work",stock:"Add broiler feed or supply",stockNameLabel:"Feed, medicine or supply",stockUnitPlaceholder:"kg, bag, bottle, item",log:"Record broiler activity",logTypeLabel:"Broiler record type",logTypePlaceholder:"Feed, weight, health, mortality or transfer",logTitleLabel:"Batch or event",quantityLabel:"Birds or weight",nav:{tasks:"Broiler batch work",tools:"Batches, feed and growth"},workflow:[["Batch care","Plan feeding, health and housing work."],["Feed stock","Track deliveries, use and feed remaining."],["Growth and losses","Record weights, mortality and movements."]]},
      "building": { eyebrow:"Building operations",title:"Construction projects and materials",description:"Plan building work, manage materials and equipment, and record progress, safety and completion.",plan:"Plan building work",planTypeLabel:"Project or work type",planTypePlaceholder:"Construction, repair, installation or inspection",planTitleLabel:"Building, area or project",stock:"Add building material or equipment",stockNameLabel:"Material, part or equipment",stockCategoryLabel:"Building category",stockCategoryPlaceholder:"Enter the building category",stockUnitPlaceholder:"bag, metre, sheet, item",log:"Record construction progress",logTypeLabel:"Building record type",logTypePlaceholder:"Delivery, work completed, inspection, issue or usage",logTitleLabel:"Area or project",quantityLabel:"Area or material",nav:{tasks:"Building projects",requests:"Request building crew",tools:"Projects and materials"},workflow:[["Project stages","Plan construction, repairs and installations."],["Materials and equipment","Track deliveries, usage and remaining quantities."],["Progress and safety","Record completed work, checks and blockers."]]},
      "media": { eyebrow:"Media operations",title:"Content, events and equipment",description:"Plan coverage and publications, manage media equipment, and record production and delivery.",plan:"Plan media work",planTypeLabel:"Media plan type",planTypePlaceholder:"Coverage, production, publication or event",planTitleLabel:"Event, story or production",stock:"Register media equipment or supply",stockNameLabel:"Equipment, accessory or supply",stockCategoryLabel:"Media category",stockCategoryPlaceholder:"Enter the media category",stockUnitPlaceholder:"device, cable, battery, item",log:"Record production or equipment activity",logTypeLabel:"Media record type",logTypePlaceholder:"Capture, edit, publish, handover or fault",logTitleLabel:"Event, production or equipment",quantityLabel:"Items or outputs",nav:{tasks:"Media assignments",tools:"Content and equipment"},workflow:[["Content calendar","Plan events, stories and publication work."],["Equipment register","Track cameras, audio, accessories and supplies."],["Production record","Record capture, editing, delivery and faults."]]},
      "chairs-upholstery": { eyebrow:"Upholstery operations",title:"Furniture jobs and materials",description:"Plan chair and upholstery jobs, track fabric and components, and record completed items and repairs.",plan:"Plan furniture and upholstery jobs",planTypeLabel:"Job type",planTypePlaceholder:"Repair, upholstery, restoration or production",planTitleLabel:"Furniture item or batch",stock:"Add upholstery material or tool",stockNameLabel:"Fabric, component or tool",stockCategoryLabel:"Material category",stockCategoryPlaceholder:"Enter the upholstery category",stockUnitPlaceholder:"metre, sheet, item, box",log:"Record furniture job progress",logTypeLabel:"Upholstery record type",logTypePlaceholder:"Strip, repair, cover, complete, usage or issue",logTitleLabel:"Item, batch or job",quantityLabel:"Items or material",nav:{tasks:"Furniture jobs",tools:"Jobs and materials"},workflow:[["Job queue","Plan repairs, restoration and new work."],["Materials","Track fabric, foam, components and tools."],["Finished work","Record completed items, usage and issues."]]},
      "kitchen": { eyebrow:"Kitchen operations",title:"Menus, ingredients and food usage",description:"Plan meals, manage ingredients, record usage and wastage, and keep meal service reporting together.",plan:"Plan meals for a day or week",planTypeLabel:"Meal plan type",planTypePlaceholder:"Daily menu, weekly menu, preparation or special service",planTitleLabel:"Menu or service",planTitlePlaceholder:"Describe the meal plan",stock:"Add food or ingredient",stockNameLabel:"Food or ingredient",stockCategoryLabel:"Food category",stockCategoryPlaceholder:"Enter the category used by Kitchen",stockUnitPlaceholder:"kg, litre, packet, tray, item",log:"Record food usage or service activity",logTypeLabel:"Kitchen record type",logTypePlaceholder:"Preparation, usage, wastage, service or issue",logTitleLabel:"Meal, ingredient or event",quantityLabel:"Meals or quantity",nav:{tasks:"Occasional work",requests:"Request extra help","daily-report":"Daily service report","period-report":"Service summaries",tools:"Menus and food stock",transfers:"Food transfers"},workflow:[["Meal planning","Plan daily or weekly menus and preparation."],["Ingredients and usage","Track food received, used, wasted and remaining."],["Meal service","Use the dedicated scanner page for daily check-ins."]]},
      "clinic": { eyebrow:"Clinic operations",title:"Medication, materials and clinic work",description:"Manage Clinic supplies, operational plans and activity records alongside the protected bed-rest register.",plan:"Plan clinic work",planTypeLabel:"Clinic plan type",planTypePlaceholder:"Routine, stock review, follow-up or health activity",planTitleLabel:"Clinic work item",stock:"Add medication or material",stockNameLabel:"Medication or material",stockCategoryLabel:"Clinic category",stockCategoryPlaceholder:"Enter the Clinic category",stockUnitPlaceholder:"tablet, bottle, packet, box, item",log:"Record clinic activity",logTypeLabel:"Clinic record type",logTypePlaceholder:"Consultation total, stock use, follow-up or incident",logTitleLabel:"Activity or event",quantityLabel:"People or items",nav:{tasks:"Clinic actions",requests:"Request support","daily-report":"Clinic daily report","period-report":"Clinic summaries",tools:"Medication and materials",transfers:"Clinic transfers"},workflow:[["Clinic register","Manage bed-rest permissions in the protected Clinic screen."],["Medication stock","Track medication and material quantities and low levels."],["Clinic operations","Plan work and record non-confidential activity totals."]]},
      "bakery": { eyebrow:"Bakery operations",title:"Production batches and ingredients",description:"Plan bakery production, manage ingredients and packaging, and record output, usage and wastage.",plan:"Plan bakery production",planTypeLabel:"Production plan type",planTypePlaceholder:"Daily bake, special order, preparation or maintenance",planTitleLabel:"Product or batch",stock:"Add ingredient or bakery supply",stockNameLabel:"Ingredient, packaging or supply",stockCategoryLabel:"Bakery category",stockCategoryPlaceholder:"Enter the bakery category",stockUnitPlaceholder:"kg, litre, packet, tray, item",log:"Record production or wastage",logTypeLabel:"Bakery record type",logTypePlaceholder:"Batch, output, usage, wastage or issue",logTitleLabel:"Product, batch or event",quantityLabel:"Items or weight",nav:{tasks:"Production work",tools:"Batches and ingredients"},workflow:[["Production plan","Plan products, batches and preparation."],["Ingredients","Track ingredients, packaging and supplies."],["Output and wastage","Record finished items, use, loss and issues."]]},
      "tuckshop": { eyebrow:"Tuckshop operations",title:"Stock, sales and service",description:"Plan tuckshop service, track stock movements, and record sales totals, losses and restocking needs.",plan:"Plan tuckshop service",planTypeLabel:"Service plan type",planTypePlaceholder:"Restock, promotion, service or stocktake",planTitleLabel:"Service or stock plan",stock:"Add sale item or supply",stockNameLabel:"Product or supply",stockCategoryLabel:"Product category",stockCategoryPlaceholder:"Enter the tuckshop category",stockUnitPlaceholder:"item, packet, bottle, box",log:"Record sales or stock activity",logTypeLabel:"Tuckshop record type",logTypePlaceholder:"Sales, stocktake, expiry, loss or issue",logTitleLabel:"Product group or event",quantityLabel:"Items or value",nav:{tasks:"Tuckshop work",tools:"Stock and sales records"},workflow:[["Service planning","Plan restocking, stocktakes and service work."],["Sale stock","Track products received, sold, lost and remaining."],["Daily record","Record totals, expiries, issues and follow-up."]]},
      "fisheries": { eyebrow:"Fisheries operations",title:"Ponds, feed and harvests",description:"Plan pond work, manage feed and supplies, and record water checks, stock, growth, harvests and losses.",plan:"Plan fisheries work",planTypeLabel:"Pond plan type",planTypePlaceholder:"Feeding, water, stocking, harvest or maintenance",planTitleLabel:"Pond or work",stock:"Add feed or fisheries supply",stockNameLabel:"Feed, treatment or supply",stockCategoryLabel:"Fisheries category",stockCategoryPlaceholder:"Enter the fisheries category",stockUnitPlaceholder:"kg, bag, litre, item",log:"Record pond or harvest activity",logTypeLabel:"Fisheries record type",logTypePlaceholder:"Feed, water check, stocking, growth, harvest or loss",logTitleLabel:"Pond or event",quantityLabel:"Fish or weight",nav:{tasks:"Pond work",requests:"Request pond support",tools:"Ponds, feed and harvests"},workflow:[["Pond rounds","Plan feeding, checks and maintenance."],["Feed and supplies","Track feed, treatments and equipment."],["Stock and harvest","Record growth, mortality, harvests and transfers."]]},
      "transport": { eyebrow:"Transport operations",title:"Trips, vehicles and fuel",description:"Plan transport work, manage fuel and parts, and record trips, faults, servicing and vehicle availability.",plan:"Plan trips and vehicle work",planTypeLabel:"Transport plan type",planTypePlaceholder:"Trip, service, repair, inspection or booking",planTitleLabel:"Vehicle or journey",stock:"Add fuel, part or vehicle supply",stockNameLabel:"Fuel, part or supply",stockCategoryLabel:"Transport category",stockCategoryPlaceholder:"Enter the transport category",stockUnitPlaceholder:"litre, item, tyre, bottle",log:"Record trip, fault or maintenance",logTypeLabel:"Transport record type",logTypePlaceholder:"Trip, fuel, fault, service, inspection or handover",logTitleLabel:"Vehicle or journey",quantityLabel:"Distance or fuel",nav:{tasks:"Vehicle work",tools:"Trips, vehicles and fuel"},workflow:[["Trip planning","Plan journeys, drivers and vehicle use."],["Fuel and parts","Track fuel, spares and vehicle supplies."],["Vehicle history","Record mileage, faults, service and availability."]]},
      "finance-accounts": { eyebrow:"Finance operations",title:"Finance cycles and administrative work",description:"Plan recurring finance work, track office resources, and keep dated operational records and follow-up items.",plan:"Plan finance and accounts work",planTypeLabel:"Finance work type",planTypePlaceholder:"Payment cycle, reconciliation, filing or review",planTitleLabel:"Process or work item",stock:"Add office resource or controlled item",stockNameLabel:"Resource or controlled item",stockCategoryLabel:"Resource category",stockCategoryPlaceholder:"Enter the Finance category",stockUnitPlaceholder:"item, book, packet, licence",log:"Record finance operations",logTypeLabel:"Finance record type",logTypePlaceholder:"Reconciliation, submission, filing, follow-up or issue",logTitleLabel:"Process or record",quantityLabel:"Items or records",nav:{tasks:"Finance work queue",tools:"Finance work and records"},workflow:[["Work cycles","Plan reconciliations, payments and regular submissions."],["Controlled resources","Track stationery, books, devices and licences."],["Operational record","Record completed cycles, exceptions and follow-up."]]},
      "conference-centre": { eyebrow:"Conference operations",title:"Events, spaces and service readiness",description:"Plan conferences and room setups, manage event supplies and equipment, and record attendance, service and issues.",plan:"Plan events and room setups",planTypeLabel:"Event plan type",planTypePlaceholder:"Conference, meeting, setup, service or turnaround",planTitleLabel:"Event or booking",stock:"Add event supply or equipment",stockNameLabel:"Supply or equipment",stockCategoryLabel:"Conference category",stockCategoryPlaceholder:"Enter the Conference category",stockUnitPlaceholder:"item, set, packet, litre",log:"Record event or venue activity",logTypeLabel:"Conference record type",logTypePlaceholder:"Setup, attendance, service, handover, usage or issue",logTitleLabel:"Event, room or activity",quantityLabel:"Guests or items",nav:{tasks:"Event work",requests:"Request event support",tools:"Events, spaces and supplies"},workflow:[["Event calendar","Plan bookings, room layouts and service needs."],["Venue readiness","Track equipment, consumables and setup work."],["Service record","Record attendance, handovers, use and issues."]]}
    };
    return Object.assign({}, base, profiles[slug] || {});
  }

  function applyDepartmentNavigation() {
    var defaults = { overview:"Overview",tasks:"Tasks",requests:"Sessions","daily-report":"Daily report","period-report":"Weekly / monthly",tools:"Department tools",transfers:"Transfers" };
    var labels = isDepartment() ? Object.assign({}, defaults, toolProfile(currentDepartmentSlug()).nav || {}) : defaults;
    Object.keys(defaults).forEach(function (view) {
      var button = el("main-nav").querySelector('[data-view="' + view + '"]');
      if (button) button.textContent = labels[view] || defaults[view];
    });
  }

  function selectedToolsDepartmentId() { return isDepartment() ? currentDepartmentId() : value("tools-department"); }

  function renderTools() {
    var tools = state.tools;
    if (!tools || tools.department_id !== selectedToolsDepartmentId()) {
      el("tools-description").textContent = "Choose a department to open its tools.";
      el("tool-stock-list").innerHTML = "No department selected.";
      el("tool-history").innerHTML = "No department selected.";
      return;
    }
    var profile = toolProfile(tools.department_slug || "");
    el("tools-eyebrow").textContent = profile.eyebrow;
    el("tools-heading").textContent = profile.title;
    el("tools-description").textContent = profile.description;
    el("tool-plan-heading").textContent = profile.plan;
    el("tool-stock-heading").textContent = profile.stock;
    el("tool-log-heading").textContent = profile.log;
    el("tool-plan-type-label").textContent = profile.planTypeLabel;
    el("tool-plan-type").placeholder = profile.planTypePlaceholder;
    el("tool-plan-title-label").textContent = profile.planTitleLabel;
    el("tool-plan-title").placeholder = profile.planTitlePlaceholder || "Enter the plan";
    el("tool-stock-name-label").textContent = profile.stockNameLabel;
    el("tool-stock-category-label").textContent = profile.stockCategoryLabel;
    el("tool-stock-category").placeholder = profile.stockCategoryPlaceholder;
    el("tool-stock-unit-label").textContent = profile.stockUnitLabel;
    el("tool-stock-unit").placeholder = profile.stockUnitPlaceholder;
    el("tool-log-type-label").textContent = profile.logTypeLabel;
    el("tool-log-type").placeholder = profile.logTypePlaceholder;
    el("tool-log-title-label").textContent = profile.logTitleLabel;
    el("tool-log-title").placeholder = profile.logTitlePlaceholder;
    el("tool-log-quantity-label").textContent = profile.quantityLabel;
    el("tool-log-unit-label").textContent = profile.logUnitLabel;
    el("tool-workflow-cards").innerHTML = (profile.workflow || []).map(function (item) {
      return '<article class="workflow-card"><h3>' + escapeHtml(item[0]) + '</h3><p>' + escapeHtml(item[1]) + '</p></article>';
    }).join("");
    var serviceLink = tools.department_slug === "kitchen" ? '<button class="button primary" type="button" data-open-view="meal-service">Meal check-in</button>' : tools.department_slug === "clinic" ? '<button class="button primary" type="button" data-open-view="clinic-service">Clinic register</button>' : "";
    el("tool-quick-links").innerHTML = serviceLink + '<a class="button secondary" href="#tool-plan-form">Planning</a><a class="button secondary" href="#tool-stock-item-form">Stock and usage</a><a class="button secondary" href="#tool-log-form">Activity records</a>';

    var items = tools.stock_items || [];
    fillSelect(el("tool-stock-item"), items, { id: "id", label: "item_name", first: items.length ? "Choose item" : "Add an item first" });
    el("tool-stock-list").classList.toggle("empty-state", !items.length);
    el("tool-stock-list").innerHTML = items.length ? items.map(function (item) {
      var low = item.reorder_level != null && Number(item.current_quantity) <= Number(item.reorder_level);
      return '<article class="data-card ' + (low ? "warning" : "") + '"><div class="card-top"><div><h3>' + escapeHtml(item.item_name) + '</h3><p>' + escapeHtml(item.category || "Uncategorised") + '</p></div><span class="count-badge">' + escapeHtml(item.current_quantity + " " + item.unit) + '</span></div>' + (item.reorder_level != null ? '<p class="muted">Low-stock level: ' + escapeHtml(item.reorder_level + " " + item.unit) + '</p>' : '') + '</article>';
    }).join("") : "No stock items yet. Add the first item above.";

    var history = (tools.plans || []).map(function (plan) { return { date: plan.starts_on, title: plan.title, meta: plan.plan_type + " · " + plan.starts_on + (plan.ends_on !== plan.starts_on ? " to " + plan.ends_on : ""), notes: plan.details }; })
      .concat((tools.logs || []).map(function (log) { return { date: log.record_date, title: log.title, meta: log.log_type + (log.quantity != null ? " · " + log.quantity + " " + (log.unit || "") : ""), notes: log.notes }; }))
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    el("tool-history").classList.toggle("empty-state", !history.length);
    el("tool-history").innerHTML = history.length ? history.slice(0, 30).map(function (record) {
      return '<article class="data-card"><h3>' + escapeHtml(record.title) + '</h3><p class="muted">' + escapeHtml(record.meta) + '</p>' + (record.notes ? '<p>' + escapeHtml(record.notes) + '</p>' : '') + '</article>';
    }).join("") : "No plans or activity records yet.";

  }

  async function toolCommand(action, payload) {
    payload = payload || {};
    payload.department_id = selectedToolsDepartmentId();
    var result = await rpc("ops_department_tool_command", { p_session_token: state.session.session_token, p_action: action, p_payload: payload });
    if (result.status !== "success") throw new Error(result.message || "The record could not be saved.");
    await loadDepartmentTools(selectedToolsDepartmentId());
    renderTools();
  }

  function normalizeScannedRegistration(raw) {
    raw = String(raw || "").trim();
    if (!raw) return "";
    try {
      var decoded = JSON.parse(raw);
      raw = decoded.registration_number || decoded.registration || decoded.reg || decoded.student_id || raw;
    } catch (error) { /* card data may be plain text */ }
    try { raw = decodeURIComponent(raw); } catch (error) { /* keep original text */ }
    var queryMatch = String(raw).match(/[?&](?:registration_number|registration|reg|student)=([0-9]{5})(?:&|$)/i);
    if (queryMatch) return queryMatch[1];
    var matches = String(raw).match(/[0-9]{5}/g);
    if (matches && matches.length) return matches[matches.length - 1];
    var digits = String(raw).replace(/\D/g, "");
    return digits.length === 5 ? digits : "";
  }

  function focusKitchenScanner() {
    var field = el("kitchen-registration");
    if (!field || !el("view-meal-service").classList.contains("active")) return;
    setTimeout(function () { if (el("view-meal-service").classList.contains("active")) field.focus(); }, 80);
  }

  function kitchenInputSource() {
    var elapsed = state.scanStartedAt ? Date.now() - state.scanStartedAt : 99999;
    var source = state.scanKeyCount >= 5 && elapsed < 1600 ? "scanner" : "manual";
    state.scanStartedAt = 0;
    state.scanLastAt = 0;
    state.scanKeyCount = 0;
    return source;
  }

  function renderKitchenResult(result, registrationNumber) {
    var box = el("kitchen-scan-result");
    var stateBox = el("kitchen-scanner-state");
    var name = result.full_name || "Registration " + (result.registration_number || registrationNumber);
    if (result.status === "checked_in") {
      box.className = "scan-result success";
      box.innerHTML = '<strong>Checked in</strong><span>' + escapeHtml(name + " · " + result.meal_session) + "</span>";
      stateBox.className = "status-pill green";
      stateBox.textContent = "Saved";
      if (navigator.vibrate) navigator.vibrate(80);
    } else if (result.status === "duplicate") {
      box.className = "scan-result warning";
      box.innerHTML = '<strong>Already checked in</strong><span>' + escapeHtml(name + " · " + (result.meal_session || value("kitchen-meal"))) + "</span>";
      stateBox.className = "status-pill amber";
      stateBox.textContent = "Duplicate";
      if (navigator.vibrate) navigator.vibrate([60,50,60]);
    } else {
      box.className = "scan-result error";
      box.innerHTML = '<strong>Not saved</strong><span>' + escapeHtml(result.message || "The card could not be recognised.") + "</span>";
      stateBox.className = "status-pill red";
      stateBox.textContent = "Try again";
      if (navigator.vibrate) navigator.vibrate([100,60,100]);
    }
  }

  async function checkInKitchen(source, busyTarget) {
    var scanned = value("kitchen-registration");
    var registrationNumber = normalizeScannedRegistration(scanned);
    if (!registrationNumber) {
      renderKitchenResult({ status:"invalid", message:"Scan a recognised student card or enter a five-digit registration number." }, scanned);
      el("kitchen-registration").select();
      return;
    }
    setBusy(busyTarget, true, "Checking in...");
    try {
      var result = await rpc("ops_kitchen_service", { p_session_token:state.session.session_token, p_action:"check_in", p_payload:{ service_date:today(), registration_number:registrationNumber, meal_session:value("kitchen-meal"), source:source || "manual" } });
      renderKitchenResult(result || { status:"invalid", message:"Check-in did not return a result." }, registrationNumber);
      if (["checked_in","duplicate"].indexOf(result && result.status) >= 0) {
        el("kitchen-registration").value = "";
        await refreshKitchen();
      }
    } catch (error) {
      renderKitchenResult({ status:"error", message:error.message }, registrationNumber);
    } finally {
      setBusy(busyTarget, false);
      focusKitchenScanner();
    }
  }

  async function refreshKitchen() {
    var result = await rpc("ops_kitchen_service", { p_session_token: state.session.session_token, p_action: "dashboard", p_payload: { service_date: today() } });
    if (result.status !== "success") throw new Error(result.message || "Kitchen totals could not be loaded.");
    var meals = ["Breakfast","Lunch","Break-fast 4pm","Supper"];
    el("kitchen-counts").innerHTML = meals.map(function (meal) { return '<article class="summary-card"><div class="label">' + escapeHtml(meal) + '</div><div class="value">' + Number((result.counts || {})[meal] || 0) + '</div></article>'; }).join("") + '<article class="summary-card"><div class="label">Lunch to prepare</div><div class="value">' + Number(result.lunch_to_cook || 0) + '</div></article>';
    var recent = result.recent || [];
    el("kitchen-recent").classList.toggle("empty-state", !recent.length);
    el("kitchen-recent").innerHTML = recent.length ? recent.map(function (checkin) {
      return '<article class="data-card"><div class="card-top"><div><h3>' + escapeHtml(checkin.full_name) + '</h3><p>' + escapeHtml(checkin.registration_number + " · " + checkin.meal_session) + '</p></div><span class="status-pill green">' + escapeHtml(formatDateTime(checkin.checked_in_at)) + '</span></div></article>';
    }).join("") : "No students checked in yet.";
  }

  async function refreshClinic() {
    var result = await rpc("ops_clinic_service", { p_session_token: state.session.session_token, p_action: "active", p_payload: {} });
    if (result.status !== "success") throw new Error(result.message || "Clinic records could not be loaded.");
    var rows = result.students || [];
    el("clinic-active-count").textContent = rows.length;
    el("clinic-active").classList.toggle("empty-state", !rows.length);
    el("clinic-active").innerHTML = rows.length ? rows.map(function (student) {
      return '<article class="data-card"><div class="card-top"><div><h3>' + escapeHtml(student.student_name) + '</h3><p>' + escapeHtml(student.registration_number) + '</p></div><button class="button quiet clinic-bed-rest" data-action="clear" data-registration="' + escapeHtml(student.registration_number) + '">End bed rest</button></div>' + (student.notes ? '<p>' + escapeHtml(student.notes) + '</p>' : '') + '</article>';
    }).join("") : "No students are currently on bed rest.";
  }

  function downloadCsv(rows, filename) {
    if (!rows.length) throw new Error("There are no rows to export.");
    var keys = Object.keys(rows[0]);
    var quote = function (value) { return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"'; };
    var csv = [keys.map(quote).join(",")].concat(rows.map(function (row) { return keys.map(function (key) { return quote(row[key]); }).join(","); })).join("\n");
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function formatDateTime(input) {
    if (!input) return "Not recorded";
    var d = new Date(input);
    return isNaN(d.getTime()) ? String(input) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function datetimeLocal(input) {
    if (!input) return "";
    var d = new Date(input);
    if (isNaN(d.getTime())) return "";
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function studentBridgePin() {
    return state.session && state.session.session_token ? "ops:" + state.session.session_token : "";
  }

  function serviceAcademicYear() {
    return Number(state.studentServices && state.studentServices.current_academic_year) || new Date().getFullYear();
  }

  function serviceYearNumber(registrationNumber) {
    var digits = String(registrationNumber == null ? "" : registrationNumber).replace(/\D/g, "");
    if (digits.length < 2) return null;
    var intake = 2000 + Number(digits.slice(0, 2));
    var year = serviceAcademicYear() - intake + 1;
    return year > 0 && year < 10 ? year : null;
  }

  function serviceYearLabel(registrationNumber) {
    var year = serviceYearNumber(registrationNumber);
    if (!year) return "Year unknown";
    var suffix = year % 10 === 1 && year % 100 !== 11 ? "st" : year % 10 === 2 && year % 100 !== 12 ? "nd" : year % 10 === 3 && year % 100 !== 13 ? "rd" : "th";
    return year + suffix + " Year";
  }

  function serviceYearMatches(registrationNumber, filter) {
    return !filter || filter === "ALL" || String(serviceYearNumber(registrationNumber)) === String(filter);
  }

  function serviceStudentName(student) {
    return '<span class="service-person"><strong>' + escapeHtml(student.student_name) + '</strong><small>' + escapeHtml(serviceYearLabel(student.registration_number)) + '</small></span>';
  }

  function servicePassPeople(pass) {
    var people = Array.isArray(pass.people) && pass.people.length ? pass.people : [{ student_name: pass.student_name, registration_number: pass.registration_number, is_primary: true }];
    return people.filter(function (person) { return person && person.student_name; });
  }

  function servicePeopleHtml(pass) {
    return '<div class="service-people">' + servicePassPeople(pass).map(function (person) {
      return '<span class="service-person"><strong>' + escapeHtml(person.student_name) + (person.is_primary ? ' <small>Applicant</small>' : '') + '</strong><small>' + escapeHtml(person.registration_number) + ' · ' + escapeHtml(serviceYearLabel(person.registration_number)) + '</small></span>';
    }).join("") + "</div>";
  }

  function serviceStudentByRegistration(registrationNumber) {
    return (state.studentServices && state.studentServices.students || []).find(function (student) {
      return String(student.registration_number) === String(registrationNumber);
    });
  }

  async function loadStudentServices() {
    if (!state.session || isDepartment()) return;
    var bridge = studentBridgePin();
    var result;
    if (state.session.role === "administrator") {
      result = await rpc("admin_services_dashboard_v2", {
        p_pin: bridge,
        p_term_id: state.studentTermId ? Number(state.studentTermId) : null
      });
    } else {
      result = await rpc("student_services_dashboard_v3", { p_pin: bridge });
    }
    if (!result || result.status !== "success") throw new Error(result && result.message || "Student services could not be loaded.");
    state.studentServices = result;
    if (result.selected_term && result.selected_term.id != null) state.studentTermId = String(result.selected_term.id);
  }

  function activateStudentServicesTab(tab) {
    var target = el("ss-tab-" + tab);
    if (!target || target.hidden) tab = "campus";
    all("[data-ss-tab]", el("student-services-tabs")).forEach(function (button) {
      button.classList.toggle("active", button.dataset.ssTab === tab);
    });
    all(".student-service-section", el("view-student-services")).forEach(function (section) {
      section.classList.toggle("active", section.id === "ss-tab-" + tab);
    });
  }

  function configureStudentServiceVisibility() {
    var admin = state.session.role === "administrator";
    all("[data-ss-admin-only]").forEach(function (node) { node.hidden = !admin; });
    el("ss-accommodation-fees-heading").hidden = !admin;
    all("#student-services-tabs option[value='3'], #view-student-services option[value='3']").forEach(function (option) {
      option.hidden = isLeadership();
      option.disabled = isLeadership();
      if (isLeadership() && option.parentElement.value === "3") option.parentElement.value = "ALL";
    });
    var active = el("student-services-tabs").querySelector("button.active");
    if (active && active.hidden) activateStudentServicesTab("campus");
  }

  function renderStudentServiceSummary() {
    var data = state.studentServices || {}, counts = data.counts || {};
    var cards = [
      [counts.on_campus || 0, "On campus", false],
      [counts.off_campus || 0, "Off campus", false],
      [counts.bed_rest || 0, "Allowed bed rest", false],
      [counts.pending_passes || 0, "Pending passes", Number(counts.pending_passes || 0) > 0],
      [counts.overdue_passes || 0, "Overdue passes", Number(counts.overdue_passes || 0) > 0]
    ];
    if (state.session.role === "administrator") cards.push([(data.fee_summary || {}).unpaid || 0, "Fees not paid", Number((data.fee_summary || {}).unpaid || 0) > 0]);
    el("ss-summary-cards").innerHTML = cards.map(function (card) {
      return '<article class="summary-card' + (card[2] ? " alert" : "") + '"><div class="label">' + escapeHtml(card[1]) + '</div><div class="value">' + escapeHtml(card[0]) + "</div></article>";
    }).join("");
  }

  function renderStudentCampus() {
    var data = state.studentServices || {}, q = value("ss-campus-search").toLowerCase(), filter = value("ss-campus-filter"), year = value("ss-campus-year");
    var rows = (data.students || []).filter(function (student) {
      var statusMatch = filter === "ALL" || filter === student.status || filter === "BED_REST" && student.bed_rest;
      return statusMatch && serviceYearMatches(student.registration_number, year) && (student.student_name + " " + student.registration_number).toLowerCase().indexOf(q) >= 0;
    });
    el("ss-campus-rows").innerHTML = rows.length ? rows.map(function (student) {
      var health = [];
      if (student.bed_rest) health.push('<span class="service-pill bed-rest">Allowed bed rest</span>');
      if (state.session.role === "administrator" && student.maternity) health.push('<span class="service-pill bed-rest">Maternity</span>');
      return '<tr><td>' + serviceStudentName(student) + '</td><td>' + escapeHtml(student.registration_number) + '</td><td><span class="service-pill ' + escapeHtml(student.status) + '">' + escapeHtml(student.status === "IN" ? "On campus" : student.status === "OUT" ? "Off campus" : "Unknown") + '</span></td><td>' + (health.join(" ") || '<span class="service-secondary">None</span>') + '</td><td>' + escapeHtml(formatDateTime(student.last_movement_at)) + '</td><td><button class="button quiet ss-edit-student" data-registration="' + escapeHtml(student.registration_number) + '" type="button">Edit</button></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty-state">No matching students.</td></tr>';
  }

  function renderStudentAccommodation() {
    var data = state.studentServices || {}, admin = state.session.role === "administrator", q = value("ss-accommodation-search").toLowerCase(), filter = value("ss-accommodation-filter"), year = value("ss-accommodation-year");
    var rows = (data.students || []).filter(function (student) {
      var statusMatch = filter === "ALL" || filter === "ALLOCATED" && student.residence || filter === "NOT_ALLOCATED" && !student.residence || filter === "BED_REST" && student.bed_rest;
      var hay = [student.student_name, student.registration_number, student.residence, student.room].join(" ").toLowerCase();
      return statusMatch && serviceYearMatches(student.registration_number, year) && hay.indexOf(q) >= 0;
    });
    el("ss-accommodation-rows").innerHTML = rows.length ? rows.map(function (student) {
      var feeCell = admin ? '<td><span class="service-pill ' + (student.fees_paid === false ? "unpaid" : "paid") + '">' + (student.fees_paid === false ? "Not paid" : "Paid") + "</span></td>" : "";
      return '<tr><td>' + serviceStudentName(student) + '</td><td>' + escapeHtml(student.registration_number) + '</td><td>' + escapeHtml(student.residence || "Not allocated") + '</td><td>' + escapeHtml(student.room || "—") + '</td><td>' + escapeHtml(student.bed || "—") + '</td>' + feeCell + '<td>' + escapeHtml(titleCase(student.accommodation_status || "Not allocated")) + '</td><td><button class="button quiet ss-edit-student" data-registration="' + escapeHtml(student.registration_number) + '" type="button">Edit</button></td></tr>';
    }).join("") : '<tr><td colspan="8" class="empty-state">No matching accommodation records.</td></tr>';
  }

  function renderStudentPasses() {
    var data = state.studentServices || {}, q = value("ss-pass-search").toLowerCase(), filter = value("ss-pass-filter"), year = value("ss-pass-year");
    var rows = (data.gate_passes || []).filter(function (pass) {
      var statusMatch = filter === "ALL" || filter === "OVERDUE" && pass.overdue || pass.status === filter;
      var people = servicePassPeople(pass);
      var yearMatch = year === "ALL" || people.some(function (person) { return serviceYearMatches(person.registration_number, year); });
      var hay = people.map(function (person) { return person.student_name + " " + person.registration_number; }).join(" ") + " " + (pass.destination || "");
      return statusMatch && yearMatch && hay.toLowerCase().indexOf(q) >= 0;
    });
    el("ss-pass-permission-note").textContent = isLeadership() ? "Student Leadership can view all people and decisions on a pass. Approval remains view only." : state.session.role === "administrator" ? "School Administration can amend departure and return times and make the Administrator decision." : "Management can record a Principal, Dean, or Director decision.";
    el("ss-pass-rows").innerHTML = rows.length ? rows.map(function (pass) {
      var status = pass.overdue ? "overdue" : pass.status;
      return '<tr class="' + (pass.overdue ? "service-row-overdue" : "") + '"><td>' + servicePeopleHtml(pass) + '</td><td>' + escapeHtml(pass.destination) + '</td><td><span class="service-pill ' + escapeHtml(status) + '">' + escapeHtml(pass.overdue ? "Overdue" : titleCase(pass.status)) + '</span>' + (pass.waiting_on ? '<br><small class="service-secondary">Waiting on ' + escapeHtml(pass.waiting_on) + "</small>" : "") + '</td><td>' + escapeHtml(formatDateTime(pass.departure_at)) + '<br><small class="service-secondary">Return ' + escapeHtml(formatDateTime(pass.expected_return_at)) + '</small></td><td><button class="button secondary ss-open-pass" data-id="' + escapeHtml(pass.id) + '" type="button">' + (isLeadership() ? "View" : "Review") + "</button></td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty-state">No matching gate passes.</td></tr>';
  }

  function renderStudentFees() {
    if (state.session.role !== "administrator") return;
    var data = state.studentServices || {}, selected = data.selected_term || {}, terms = data.terms || [];
    var termSelect = el("ss-fee-term"), previous = state.studentTermId || String(selected.id || "");
    termSelect.innerHTML = terms.map(function (term) { return '<option value="' + escapeHtml(term.id) + '">' + escapeHtml(term.term_name + " · " + term.academic_year) + "</option>"; }).join("");
    if (previous) termSelect.value = previous;
    var summary = data.fee_summary || {};
    el("ss-fee-summary").innerHTML = [[summary.paid || 0,"Paid",false],[summary.unpaid || 0,"Not paid",Number(summary.unpaid || 0)>0],[summary.total || 0,"Students",false]].map(function (card) {
      return '<article class="summary-card' + (card[2] ? " alert" : "") + '"><div class="label">' + card[1] + '</div><div class="value">' + card[0] + "</div></article>";
    }).join("");
    var q = value("ss-fee-search").toLowerCase(), filter = value("ss-fee-filter"), year = value("ss-fee-year");
    var rows = (data.students || []).filter(function (student) {
      var statusMatch = filter === "ALL" || filter === "PAID" && student.fees_paid !== false || filter === "UNPAID" && student.fees_paid === false;
      return statusMatch && serviceYearMatches(student.registration_number, year) && (student.student_name + " " + student.registration_number).toLowerCase().indexOf(q) >= 0;
    });
    el("ss-fee-rows").innerHTML = rows.length ? rows.map(function (student) {
      var paid = student.fees_paid !== false;
      return '<tr><td>' + serviceStudentName(student) + '</td><td>' + escapeHtml(student.registration_number) + '</td><td>' + escapeHtml(selected.term_name || "Current term") + '</td><td>' + escapeHtml(formatDate(selected.fees_due_date)) + '</td><td><button class="button ' + (paid ? "secondary" : "danger") + ' ss-fee-toggle" data-registration="' + escapeHtml(student.registration_number) + '" data-paid="' + paid + '" type="button">' + (paid ? "Paid" : "Not paid") + '</button></td><td>' + escapeHtml(formatDateTime(student.fee_updated_at)) + "</td></tr>";
    }).join("") : '<tr><td colspan="6" class="empty-state">No matching fee records.</td></tr>';
  }

  function renderStudentDuty() {
    var data = state.studentServices || {}, q = value("ss-duty-search").toLowerCase(), year = value("ss-duty-year");
    var rows = (data.gate_duty_today || []).filter(function (row) { return serviceYearMatches(row.registration_number, year) && (row.student_name + " " + row.registration_number).toLowerCase().indexOf(q) >= 0; });
    el("ss-duty-rows").innerHTML = rows.length ? rows.map(function (row) {
      return '<tr><td>' + escapeHtml(formatDateTime(row.scanned_at)) + '</td><td>' + serviceStudentName(row) + '</td><td>' + escapeHtml(row.registration_number) + '</td><td><span class="service-pill ' + escapeHtml(row.direction) + '">' + escapeHtml(row.direction) + '</span></td><td>' + escapeHtml(row.source || row.record_source || "Recorded") + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty-state">No gate-duty records today.</td></tr>';
  }

  function renderStudentRecent() {
    var data = state.studentServices || {}, q = value("ss-recent-search").toLowerCase(), year = value("ss-recent-year");
    var rows = (data.recent_movements || []).filter(function (row) { return serviceYearMatches(row.registration_number, year) && (row.student_name + " " + row.registration_number).toLowerCase().indexOf(q) >= 0; });
    el("ss-recent-rows").innerHTML = rows.length ? rows.map(function (row) {
      return '<tr><td>' + escapeHtml(formatDateTime(row.scanned_at)) + '</td><td>' + serviceStudentName(row) + '</td><td>' + escapeHtml(row.registration_number) + '</td><td><span class="service-pill ' + escapeHtml(row.direction) + '">' + escapeHtml(row.direction) + '</span></td><td>' + escapeHtml(row.gate_pass_id ? "Approved pass" : row.checkout_destination_label || "Not linked") + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty-state">No recent campus movements.</td></tr>';
  }

  function renderStudentSettings() {
    if (state.session.role !== "administrator") return;
    var settings = state.studentServices && state.studentServices.settings || {};
    el("ss-base-mode").value = state.mode.base_mode || state.mode.mode || "normal";
    el("ss-conference-mode").checked = !!state.mode.conference_mode;
    el("ss-pilot-mode").checked = !!settings.gate_pass_pilot_mode;
    el("ss-pilot-start").value = datetimeLocal(settings.gate_pass_pilot_started_at);
    el("ss-pilot-end").value = datetimeLocal(settings.gate_pass_pilot_ends_at);
    el("ss-result-seconds").value = settings.gate_terminal_result_seconds == null ? 3 : settings.gate_terminal_result_seconds;
    el("ss-settings-actor").value = localStorage.getItem("amfcc_ops_admin_actor") || el("ss-settings-actor").value;
  }

  function renderStudentServices() {
    if (!state.studentServices || isDepartment()) return;
    configureStudentServiceVisibility();
    renderStudentServiceSummary();
    renderStudentCampus();
    renderStudentAccommodation();
    renderStudentPasses();
    renderStudentFees();
    renderStudentDuty();
    renderStudentRecent();
    renderStudentSettings();
  }

  function toggleStudentEditFields() {
    var offCampus = value("ss-edit-campus-status") === "OUT";
    el("ss-edit-outing-type").disabled = !offCampus;
    if (!offCampus) el("ss-edit-outing-type").value = "";
    var remove = el("ss-remove-accommodation").checked;
    ["ss-edit-residence","ss-edit-room","ss-edit-bed","ss-edit-accommodation-status"].forEach(function (id) { el(id).disabled = remove; });
  }

  function openStudentServiceEdit(registrationNumber) {
    var student = serviceStudentByRegistration(registrationNumber);
    if (!student) return toast("Student not found. Refresh and try again.", true);
    state.studentEdit = Object.assign({}, student);
    el("ss-student-summary").innerHTML = '<strong>' + escapeHtml(student.student_name) + '</strong><br>' + escapeHtml(student.registration_number) + ' · ' + escapeHtml(serviceYearLabel(student.registration_number));
    el("ss-edit-campus-status").value = student.status === "OUT" ? "OUT" : "IN";
    el("ss-edit-outing-type").value = student.outing_type || "";
    el("ss-edit-campus-note").value = "";
    el("ss-edit-residence").value = student.residence || "";
    el("ss-edit-room").value = student.room || "";
    el("ss-edit-bed").value = student.bed || "";
    el("ss-edit-accommodation-status").value = ["waiting","allocated","checked_in","checked_out"].indexOf(student.accommodation_status) >= 0 ? student.accommodation_status : "allocated";
    el("ss-remove-accommodation").checked = false;
    toggleStudentEditFields();
    el("ss-student-modal").hidden = false;
  }

  function closeStudentServiceEdit() {
    state.studentEdit = null;
    el("ss-student-modal").hidden = true;
  }

  async function saveStudentServiceEdit(form) {
    var original = state.studentEdit;
    if (!original) return;
    var status = value("ss-edit-campus-status"), outing = status === "OUT" ? value("ss-edit-outing-type") : "";
    var campusChanged = status !== original.status || status === "OUT" && outing !== (original.outing_type || "");
    var remove = el("ss-remove-accommodation").checked;
    var residence = value("ss-edit-residence"), room = value("ss-edit-room"), bed = value("ss-edit-bed"), accommodationStatus = value("ss-edit-accommodation-status");
    var accommodationChanged = remove || residence !== (original.residence || "") || room !== (original.room || "") || bed !== (original.bed || "") || accommodationStatus !== (original.accommodation_status || "allocated");
    if (!campusChanged && !accommodationChanged) throw new Error("Change the campus status, outing type, or accommodation before saving.");
    setBusy(form, true, "Saving...");
    try {
      if (campusChanged) {
        var result = await rpc("dashboard_update_student_campus_status_v2", { p_pin: studentBridgePin(), p_registration_number: String(original.registration_number), p_direction: status, p_outing_type: outing || null, p_note: value("ss-edit-campus-note") || null });
        if (["success","same_status"].indexOf(result.status) < 0) throw new Error(result.message || "Campus status was not saved.");
      }
      if (accommodationChanged) {
        var accommodation = await rpc("dashboard_update_student_accommodation", { p_pin: studentBridgePin(), p_registration_number: String(original.registration_number), p_residence: residence, p_room: room || null, p_bed: bed || null, p_allocation_status: accommodationStatus, p_remove: remove });
        if (accommodation.status !== "success") throw new Error(accommodation.message || "Accommodation was not saved.");
      }
      closeStudentServiceEdit();
      await loadStudentServices();
      renderStudentServices();
      toast("Student operations updated.");
    } finally { setBusy(form, false); }
  }

  function localPassDetails(pass) {
    var people = servicePassPeople(pass);
    var approvals = (pass.approvals || []).map(function (approval) {
      return '<div class="approval-review-row"><strong>' + escapeHtml(titleCase(approval.role === "administrator" ? "School Administrator" : approval.role)) + '</strong><br><span class="service-secondary">' + escapeHtml(titleCase(approval.decision)) + ' · ' + escapeHtml(formatDateTime(approval.decided_at)) + "</span></div>";
    }).join("") || '<p class="service-secondary">No decisions yet.</p>';
    return '<p><strong>Applicant:</strong> ' + escapeHtml(pass.student_name) + ' (' + escapeHtml(pass.registration_number) + ')</p><h3>Everyone on this pass</h3><ul class="pass-review-list">' + people.map(function (person) { return '<li><strong>' + escapeHtml(person.student_name) + '</strong> (' + escapeHtml(person.registration_number) + ')' + (person.is_primary ? " · Applicant" : "") + "</li>"; }).join("") + '</ul><p><strong>Destination:</strong> ' + escapeHtml(pass.destination) + '</p><p><strong>Reason:</strong> ' + escapeHtml(pass.reason) + '</p>' + (pass.contact_details ? '<p><strong>Contact:</strong> ' + escapeHtml(pass.contact_details) + "</p>" : "") + '<p><strong>Status:</strong> ' + escapeHtml(titleCase(pass.status)) + '</p><h3>Decisions</h3>' + approvals;
  }

  async function openStudentPass(passId) {
    var admin = state.session.role === "administrator";
    var result = await rpc(admin ? "admin_gate_pass_review_details" : "dashboard_gate_pass_review_details", { p_pin: studentBridgePin(), p_pass_id: passId });
    if (!result || result.status !== "success") throw new Error(result && result.message || "Pass details could not be opened.");
    state.passReview = result.pass;
    el("ss-pass-details").innerHTML = localPassDetails(result.pass);
    el("ss-admin-schedule").hidden = !admin;
    el("ss-senior-role-field").hidden = admin || !result.can_decide;
    el("ss-pass-comments-field").hidden = !(admin || result.can_decide);
    el("ss-pass-actions").hidden = !(admin || result.can_decide);
    el("ss-pass-view-only").hidden = admin || result.can_decide;
    el("ss-pass-comments").value = "";
    el("ss-senior-role").value = "";
    if (admin) {
      el("ss-pass-departure").value = datetimeLocal(result.pass.departure_at);
      el("ss-pass-return").value = datetimeLocal(result.pass.expected_return_at);
    }
    el("ss-pass-modal").hidden = false;
  }

  function closeStudentPass() {
    state.passReview = null;
    el("ss-pass-modal").hidden = true;
  }

  async function saveStudentPassDecision(decision) {
    if (!state.passReview) return;
    var comments = value("ss-pass-comments"), admin = state.session.role === "administrator", result;
    if (["rejected","cancelled"].indexOf(decision) >= 0 && comments.length < 2) throw new Error("Add a reason for rejecting or cancelling the pass.");
    if (admin) {
      if (!value("ss-pass-departure") || !value("ss-pass-return")) throw new Error("Enter both departure and expected return times.");
      result = await rpc("admin_review_gate_pass", {
        p_pin: studentBridgePin(), p_pass_id: state.passReview.id,
        p_departure_at: new Date(value("ss-pass-departure")).toISOString(),
        p_expected_return_at: new Date(value("ss-pass-return")).toISOString(),
        p_decision: decision, p_comments: comments || null
      });
    } else {
      if (!value("ss-senior-role")) throw new Error("Choose Principal, Dean, or Director.");
      result = await rpc("dashboard_gate_pass_decision", { p_pin: studentBridgePin(), p_pass_id: state.passReview.id, p_actor_role: value("ss-senior-role"), p_decision: decision, p_comments: comments || null });
    }
    if (result.status !== "success") throw new Error(result.message || "The gate-pass decision was not saved.");
    closeStudentPass();
    await loadStudentServices();
    renderStudentServices();
    toast("Gate pass updated.");
  }

  async function saveStudentPassTimes(button) {
    if (!state.passReview || state.session.role !== "administrator") return;
    setBusy(button, true, "Saving...");
    try {
      var result = await rpc("admin_review_gate_pass", {
        p_pin: studentBridgePin(), p_pass_id: state.passReview.id,
        p_departure_at: new Date(value("ss-pass-departure")).toISOString(),
        p_expected_return_at: new Date(value("ss-pass-return")).toISOString(),
        p_decision: null, p_comments: value("ss-pass-comments") || null
      });
      if (result.status !== "success") throw new Error(result.message || "The pass times were not saved.");
      closeStudentPass();
      await loadStudentServices();
      renderStudentServices();
      toast("Departure and return times updated.");
    } finally { setBusy(button, false); }
  }

  async function exportStudentMovements(form) {
    setBusy(form, true, "Preparing...");
    try {
      var period = value("ss-movement-period"), year = value("ss-movement-year");
      var result = await rpc("student_movements_export_v2", { p_pin: studentBridgePin(), p_period: period });
      if (result.status !== "success") throw new Error(result.message || "Movement export failed.");
      var rows = (result.rows || []).filter(function (row) { return serviceYearMatches(row.registration_number, year); }).map(function (row) {
        return {
          "Report Period": result.period_label,
          "Registration Number": row.registration_number,
          "Student Name": row.student_name,
          "Class Year": serviceYearLabel(row.registration_number),
          "Current Campus Status": row.current_campus_status,
          "On Campus": row.on_campus,
          "Allowed Bed Rest": row.on_bed_rest,
          "On Gate Pass": row.on_gate_pass,
          "Gate Pass Status": row.gate_pass_status,
          "Gate Pass Destination": row.gate_pass_destination,
          "Expected Return": row.gate_pass_expected_return_at ? formatDateTime(row.gate_pass_expected_return_at) : "",
          "Latest Movement": row.latest_movement_at ? formatDateTime(row.latest_movement_at) : "",
          "Latest Direction": row.latest_movement_direction || "",
          "Movements in Period": row.movements_in_period == null ? "" : row.movements_in_period,
          "Residence": row.residence || "",
          "Room": row.room || "",
          "Bed": row.bed || ""
        };
      });
      downloadCsv(rows, "student-movements-" + period + "-" + (year === "ALL" ? "all-years" : "year-" + year) + "-" + today() + ".csv");
      toast("Movement report downloaded.");
    } finally { setBusy(form, false); }
  }

  async function exportStudentDetail(form) {
    setBusy(form, true, "Preparing...");
    try {
      var type = value("ss-export-type"), year = value("ss-export-year");
      var result = await rpc("student_services_export", { p_pin: studentBridgePin(), p_report: type, p_start_date: value("ss-export-start") || null, p_end_date: value("ss-export-end") || null });
      if (result.status !== "success") throw new Error(result.message || "Detailed export failed.");
      var rows = (result.rows || []).filter(function (row) { return serviceYearMatches(row.registration_number, year); }).map(function (row) {
        var output = { "Class Year": serviceYearLabel(row.registration_number) };
        Object.keys(row).forEach(function (key) { output[titleCase(key)] = row[key]; });
        return output;
      });
      downloadCsv(rows, type + "-" + (year === "ALL" ? "all-years" : "year-" + year) + "-" + today() + ".csv");
      toast("Detailed report downloaded.");
    } finally { setBusy(form, false); }
  }

  async function saveStudentServiceSettings(form) {
    setBusy(form, true, "Saving...");
    try {
      var actor = value("ss-settings-actor");
      if (!actor) throw new Error("Select or enter your name for the audit record.");
      localStorage.setItem("amfcc_ops_admin_actor", actor);
      var result = await rpc("system_control_set_mode", { p_session_token: state.session.session_token, p_mode: value("ss-base-mode"), p_actor_name: actor });
      if (result.status !== "success") throw new Error(result.message || "School calendar mode was not saved.");
      result = await rpc("system_control_set_conference", { p_session_token: state.session.session_token, p_enabled: el("ss-conference-mode").checked, p_actor_name: actor });
      if (result.status !== "success") throw new Error(result.message || "Conference Mode was not saved.");
      var settings = [
        ["gate_pass_pilot_mode", el("ss-pilot-mode").checked],
        ["gate_pass_pilot_started_at", value("ss-pilot-start") ? new Date(value("ss-pilot-start")).toISOString() : null],
        ["gate_pass_pilot_ends_at", value("ss-pilot-end") ? new Date(value("ss-pilot-end")).toISOString() : null],
        ["gate_terminal_result_seconds", Number(value("ss-result-seconds"))]
      ];
      for (var i = 0; i < settings.length; i++) {
        result = await rpc("system_control_update_setting", { p_session_token: state.session.session_token, p_setting_key: settings[i][0], p_setting_value: settings[i][1], p_actor_name: actor });
        if (result.status !== "success") throw new Error(result.message || "An Administrator setting was not saved.");
      }
      await loadData(false);
      toast("Administrator settings saved.");
    } finally { setBusy(form, false); }
  }

  function renderAccess() {
    if (state.session.role !== "administrator") return;
    var departments = (state.data.departments || []).filter(function (d) { return d.workspace_enabled; });
    el("department-access-list").innerHTML = departments.map(function (department) {
      return '<article class="access-card"><div class="card-top"><div><h3>' + escapeHtml(department.name) + '</h3><p class="muted">' + (department.login_enabled ? "PIN is enabled" : "No PIN set") + '</p></div>' + statusPill(department.login_enabled ? "green" : "amber") + '</div><form class="department-code-form" data-department="' + department.id + '"><label>New 4-digit PIN<input type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" required autocomplete="new-password"></label><label>Recorded by<input class="code-actor" list="staff-name-options" placeholder="Your name"></label><button class="button secondary" type="submit">Set PIN</button></form></article>';
    }).join("");
    var sync = state.data.jira_sync || { pending: 0, processing: 0, failed: 0, sent: 0 };
    el("jira-sync-counts").innerHTML = [[sync.pending,"Pending"],[sync.processing,"Processing"],[sync.failed,"Failed"],[sync.sent,"Sent"]].map(function (item) {
      return '<article class="summary-card ' + (item[1] === "Failed" && item[0] ? "alert" : "") + '"><div class="label">' + item[1] + '</div><div class="value">' + item[0] + "</div></article>";
    }).join("");
    el("jira-sync-state").textContent = sync.sent || sync.pending || sync.failed ? "Outbox active" : "Waiting for first approval";
    el("jira-sync-state").className = "status-pill " + (sync.failed ? "red" : "green");
  }

  function renderAll() {
    applyRoleVisibility();
    populateWorkspaceInputs();
    renderSummary();
    renderOverviewSessions();
    renderNotifications();
    renderAttention();
    renderTasks();
    renderRequests();
    renderPlanner();
    renderAssignmentControls();
    renderReports();
    renderTransfers();
    renderTools();
    renderStudentServices();
    renderAccess();
    loadDailyReport();
    if (isKitchenWorkspace()) refreshKitchen().catch(function (error) { toast(error.message, true); });
    if (isClinicWorkspace()) refreshClinic().catch(function (error) { toast(error.message, true); });
    if (!state.initialViewApplied) {
      state.initialViewApplied = true;
      switchView(workspaceDefaultView());
    }
  }

  function switchView(view) {
    all(".view").forEach(function (section) { section.classList.toggle("active", section.id === "view-" + view); });
    all("#main-nav button").forEach(function (button) { button.classList.toggle("active", button.dataset.view === view); });
    if (view === "tools" && selectedToolsDepartmentId() && (!state.tools || state.tools.department_id !== selectedToolsDepartmentId())) {
      loadDepartmentTools(selectedToolsDepartmentId()).then(renderTools).catch(function (error) { toast(error.message, true); });
    }
    if (view === "meal-service") {
      refreshKitchen().then(focusKitchenScanner).catch(function (error) { toast(error.message, true); });
    }
    if (view === "clinic-service") refreshClinic().catch(function (error) { toast(error.message, true); });
  }

  function resetTaskForm() {
    el("task-form").reset();
    el("task-id").value = "";
    el("task-department").value = currentDepartmentId() || "";
    el("task-external-allowed").checked = true;
    if (isConference()) {
      el("task-type").value = "emergency";
      el("task-priority").value = "critical";
    } else {
      el("task-type").value = "ad_hoc";
      el("task-priority").value = "medium";
    }
    el("task-form").hidden = true;
  }

  function editTask(id) {
    var task = taskById(id);
    if (!task) return;
    el("task-id").value = task.id;
    el("task-department").value = task.department_id;
    el("task-title").value = task.title || "";
    el("task-description").value = task.description || "";
    el("task-type").value = isConference() ? "emergency" : task.task_type;
    el("task-cadence").value = task.cadence;
    el("task-priority").value = isConference() ? "critical" : task.priority;
    el("task-status").value = task.status;
    el("task-due-date").value = task.due_date || "";
    el("task-people").value = task.requested_people || 0;
    el("task-owner").value = task.owner_name || "";
    el("task-actor").value = "";
    el("task-external-allowed").checked = task.external_people_allowed !== false;
    el("task-form").hidden = false;
    el("task-title").focus();
  }

  async function command(action, payload) {
    var result = await rpc("ops_command", { p_session_token: state.session.session_token, p_action: action, p_payload: payload || {} });
    if (result.status !== "success") {
      var error = new Error(result.message || "The operation could not be completed.");
      error.result = result;
      throw error;
    }
    return result;
  }

  async function rememberName(name, departmentId) {
    name = String(name || "").trim();
    if (!name) return;
    try { await command("save_staff_name", { actor_name: name, department_id: departmentId || currentDepartmentId() }); } catch (error) { /* recording work must not fail because name memory failed */ }
  }

  function addMetric(metric) {
    var fragment = el("metric-row-template").content.cloneNode(true);
    var row = fragment.querySelector(".metric-row");
    metric = metric || {};
    all("[data-field]", row).forEach(function (input) { input.value = metric[input.dataset.field] == null ? "" : metric[input.dataset.field]; });
    el("metric-rows").appendChild(fragment);
  }

  function collectMetrics() {
    return all(".metric-row", el("metric-rows")).map(function (row, index) {
      function field(name) { return row.querySelector('[data-field="' + name + '"]').value.trim(); }
      return { metric_name: field("metric_name"), target_value: parseNumber(field("target_value")), actual_value: parseNumber(field("actual_value")), unit: field("unit"), status: field("status"), sort_order: (index + 1) * 10 };
    }).filter(function (metric) { return metric.metric_name; });
  }

  function dailyDepartmentId() { return reportDepartmentId("daily"); }
  function loadDailyReport() {
    if (!state.data) return;
    var departmentId = dailyDepartmentId();
    var reportDate = value("daily-date") || today();
    var report = (state.data.reports || []).find(function (r) { return r.department_id === departmentId && r.report_type === "daily" && r.report_date === reportDate; });
    var fields = { "daily-actor":"prepared_by_name","daily-staff":"staff_on_duty","daily-completed":"work_completed","daily-open":"work_open","daily-challenges":"challenges","daily-action":"action_required","daily-stock":"stock_equipment","daily-risks":"risks","daily-support":"support_required","daily-next":"next_period_plan" };
    Object.keys(fields).forEach(function (id) { el(id).value = report ? report[fields[id]] || "" : ""; });
    el("metric-rows").innerHTML = "";
    (report && report.metrics && report.metrics.length ? report.metrics : [{}]).forEach(addMetric);
    el("daily-draft-state").textContent = departmentId ? (report ? titleCase(report.status) : "Not saved") : "Choose section";
    el("daily-draft-state").className = "status-pill " + (report ? report.status : "neutral");
    var locked = report && ["approved","locked"].indexOf(report.status) >= 0;
    all("input,textarea,select,button", el("daily-report-form")).forEach(function (node) { node.disabled = !!locked; });
    ["daily-department", "daily-section", "daily-date"].forEach(function (id) { if (el(id)) el(id).disabled = false; });
  }

  function dailyPayload(submit) {
    var reportDate = value("daily-date");
    var departmentId = dailyDepartmentId();
    if (!departmentId) throw new Error("Choose Open Field or Greenhouses before saving the Horticulture report.");
    return {
      actor_name: value("daily-actor"), department_id: departmentId, report_type: "daily",
      report_date: reportDate, period_start: reportDate, period_end: reportDate,
      staff_on_duty: value("daily-staff"), work_completed: value("daily-completed"),
      work_open: value("daily-open"), challenges: value("daily-challenges"),
      action_required: value("daily-action"), stock_equipment: value("daily-stock"),
      risks: value("daily-risks"), support_required: value("daily-support"),
      next_period_plan: value("daily-next"), metrics: collectMetrics(), submit: submit
    };
  }

  async function saveDaily(submit, button) {
    setBusy(button, true, submit ? "Submitting..." : "Saving...");
    try {
      var payload = dailyPayload(submit);
      await command("save_report", payload);
      await rememberName(payload.actor_name, isDepartment() ? currentDepartmentId() : payload.department_id);
      localStorage.removeItem("amfcc_ops_daily_draft");
      await loadData(false);
      toast(submit ? "Daily report submitted." : "Draft saved.");
    } catch (error) { toast(error.message, true); }
    finally { setBusy(button, false); }
  }

  function populatePeriodPreview(preview) {
    state.periodPreview = preview;
    el("period-report-form").hidden = false;
    el("period-source-summary").textContent = preview.summary + " Source: " + preview.source_counts.daily_reports + " daily report(s).";
    el("period-status").value = preview.suggested_status;
    el("period-summary").value = preview.summary || "";
    el("period-completed").value = preview.work_completed || "";
    el("period-open").value = preview.work_open || "";
    el("period-challenges").value = preview.challenges || "";
    el("period-action").value = preview.action_required || "";
    el("period-stock").value = preview.stock_equipment || "";
    el("period-risks").value = preview.risks || "";
    el("period-support").value = "";
    el("period-next").value = "";
    el("period-actor").focus();
  }

  function periodPayload(submit) {
    var departmentId = reportDepartmentId("period");
    if (!departmentId) throw new Error("Choose Open Field or Greenhouses before saving the Horticulture report.");
    return {
      actor_name: value("period-actor"), department_id: departmentId,
      report_type: value("period-type"), report_date: value("period-end"), period_start: value("period-start"), period_end: value("period-end"),
      summary: value("period-summary"), work_completed: value("period-completed"), work_open: value("period-open"),
      challenges: value("period-challenges"), action_required: value("period-action"), stock_equipment: value("period-stock"),
      risks: value("period-risks"), support_required: value("period-support"), next_period_plan: value("period-next"),
      payload: { overall_status: value("period-status"), generated_source_counts: state.periodPreview ? state.periodPreview.source_counts : {} }, submit: submit
    };
  }

  async function savePeriod(submit, button) {
    setBusy(button, true, submit ? "Submitting..." : "Saving...");
    try {
      var payload = periodPayload(submit);
      await command("save_report", payload);
      await rememberName(payload.actor_name, isDepartment() ? currentDepartmentId() : payload.department_id);
      await loadData(false);
      toast(submit ? "Report submitted." : "Draft saved.");
    } catch (error) { toast(error.message, true); }
    finally { setBusy(button, false); }
  }

  function bindEvents() {
    el("access-type").addEventListener("change", function () {
      var department = value("access-type") === "department";
      el("department-login-field").hidden = !department;
      el("login-department").required = department;
      el("access-code").inputMode = "numeric";
      el("access-code").maxLength = 4;
      el("access-code").pattern = "[0-9]{4}";
    });

    el("login-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Opening...");
      try {
        var result = await rpc("ops_login", { p_access_type: value("access-type"), p_department_slug: value("login-department"), p_access_code: value("access-code") });
        if (result.status !== "success") throw new Error(result.message || "Sign-in failed.");
        storeSession(result); showApp(); await loadData(false); toast("Workspace opened.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("logout-button").addEventListener("click", function () { signOut(true); });
    el("refresh-button").addEventListener("click", function () { loadData(true).catch(function (error) { toast(error.message, true); }); });
    el("range-from").addEventListener("change", function () { loadData(false).catch(function (error) { toast(error.message, true); }); });
    el("main-nav").addEventListener("click", function (event) { var button = event.target.closest("button[data-view]"); if (button) switchView(button.dataset.view); });
    el("app-shell").addEventListener("click", function (event) { var button = event.target.closest("[data-open-view]"); if (button) switchView(button.dataset.openView); });

    el("student-services-tabs").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-ss-tab]");
      if (button && !button.hidden) activateStudentServicesTab(button.dataset.ssTab);
    });
    el("ss-refresh").addEventListener("click", async function () {
      setBusy(this, true, "Refreshing...");
      try { await loadStudentServices(); renderStudentServices(); toast("Student services refreshed."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(this, false); }
    });
    ["ss-campus-search","ss-campus-filter","ss-campus-year"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentCampus); });
    ["ss-accommodation-search","ss-accommodation-filter","ss-accommodation-year"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentAccommodation); });
    ["ss-pass-search","ss-pass-filter","ss-pass-year"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentPasses); });
    ["ss-duty-search","ss-duty-year"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentDuty); });
    ["ss-recent-search","ss-recent-year"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentRecent); });
    ["ss-fee-search","ss-fee-filter","ss-fee-year"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentFees); });

    el("view-student-services").addEventListener("click", function (event) {
      var edit = event.target.closest(".ss-edit-student");
      if (edit) { openStudentServiceEdit(edit.dataset.registration); return; }
      var pass = event.target.closest(".ss-open-pass");
      if (pass) openStudentPass(pass.dataset.id).catch(function (error) { toast(error.message, true); });
    });
    el("ss-student-close").addEventListener("click", closeStudentServiceEdit);
    el("ss-student-cancel").addEventListener("click", closeStudentServiceEdit);
    el("ss-student-modal").addEventListener("click", function (event) { if (event.target === this) closeStudentServiceEdit(); });
    el("ss-edit-campus-status").addEventListener("change", toggleStudentEditFields);
    el("ss-remove-accommodation").addEventListener("change", toggleStudentEditFields);
    el("ss-student-form").addEventListener("submit", function (event) {
      event.preventDefault();
      saveStudentServiceEdit(event.currentTarget).catch(function (error) { toast(error.message, true); });
    });

    el("ss-pass-close").addEventListener("click", closeStudentPass);
    el("ss-pass-modal").addEventListener("click", function (event) { if (event.target === this) closeStudentPass(); });
    all(".ss-pass-decision", el("ss-pass-actions")).forEach(function (button) {
      button.addEventListener("click", async function () {
        setBusy(button, true, "Saving...");
        try { await saveStudentPassDecision(button.dataset.decision); }
        catch (error) { toast(error.message, true); }
        finally { setBusy(button, false); }
      });
    });
    el("ss-save-pass-times").addEventListener("click", function () {
      saveStudentPassTimes(this).catch(function (error) { toast(error.message, true); });
    });
    el("ss-fee-term").addEventListener("change", async function () {
      state.studentTermId = this.value;
      try { await loadStudentServices(); renderStudentServices(); }
      catch (error) { toast(error.message, true); }
    });
    el("ss-fee-rows").addEventListener("click", async function (event) {
      var button = event.target.closest(".ss-fee-toggle");
      if (!button) return;
      var nextPaid = button.dataset.paid !== "true";
      if (!window.confirm("Mark this student as " + (nextPaid ? "fees paid" : "fees not paid") + " for the selected term?")) return;
      setBusy(button, true, "Saving...");
      try {
        var notes = window.prompt("Optional note for the fee record:", "");
        var result = await rpc("admin_update_fee_status", { p_pin: studentBridgePin(), p_registration_number: button.dataset.registration, p_term_id: Number(state.studentTermId), p_fees_paid: nextPaid, p_notes: notes || null });
        if (result.status !== "success") throw new Error(result.message || "Fee status was not saved.");
        await loadStudentServices(); renderStudentServices(); toast("Fee status updated.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(button, false); }
    });
    el("ss-movement-export-form").addEventListener("submit", function (event) { event.preventDefault(); exportStudentMovements(event.currentTarget).catch(function (error) { toast(error.message, true); }); });
    el("ss-detail-export-form").addEventListener("submit", function (event) { event.preventDefault(); exportStudentDetail(event.currentTarget).catch(function (error) { toast(error.message, true); }); });
    el("ss-settings-form").addEventListener("submit", function (event) { event.preventDefault(); saveStudentServiceSettings(event.currentTarget).catch(function (error) { toast(error.message, true); }); });

    el("new-task-button").addEventListener("click", function () { resetTaskForm(); el("task-form").hidden = false; el("task-title").focus(); });
    el("cancel-task-button").addEventListener("click", resetTaskForm);
    el("task-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Saving...");
      var payload = { id: value("task-id") || null, department_id: isDepartment() ? currentDepartmentId() : value("task-department"), title: value("task-title"), description: value("task-description"), task_type: isConference() ? "emergency" : value("task-type"), cadence: value("task-cadence"), priority: isConference() ? "critical" : value("task-priority"), status: value("task-status"), due_date: value("task-due-date") || null, requested_people: parseNumber(value("task-people")) || 0, owner_name: value("task-owner"), actor_name: value("task-actor"), external_people_allowed: el("task-external-allowed").checked };
      try { await command("save_task", payload); await rememberName(payload.actor_name, payload.department_id); resetTaskForm(); await loadData(false); toast("Task saved."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("task-list").addEventListener("click", function (event) { var button = event.target.closest(".edit-task"); if (button) editTask(button.dataset.id); });
    el("task-filter").addEventListener("change", renderTasks);
    el("task-list-department").addEventListener("change", renderTasks);

    el("request-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      if (isConference()) { toast("Manual-work sessions are unavailable in Conference Mode. Add an Emergency task instead.", true); return; }
      setBusy(event.currentTarget, true, "Sending...");
      var taskIds = all("option:checked", el("request-tasks")).map(function (option) { return option.value; });
      var payload = { department_id: isDepartment() ? currentDepartmentId() : value("request-department"), request_kind: value("request-kind"), work_date: value("request-date"), slot_id: value("request-slot"), requested_headcount: parseNumber(value("request-headcount")), task_ids: taskIds, request_notes: value("request-notes"), actor_name: value("request-actor") };
      try { var result = await rpc("ops_submit_session_request", { p_session_token: state.session.session_token, p_payload: payload }); if (result.status !== "success") throw new Error(result.message || "Request could not be sent."); await rememberName(payload.actor_name, payload.department_id); event.currentTarget.reset(); el("request-date").value = addDays(today(), 1); await loadData(false); toast("Session request sent."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("request-kind").addEventListener("change", function () {
      el("request-date").value = value("request-kind") === "unexpected" ? today() : addDays(today(), 1);
    });

    el("planner-board").addEventListener("click", async function (event) {
      var button = event.target.closest(".planner-approve,.planner-decline"); if (!button) return;
      var card = button.closest(".planner-card"); setBusy(button, true, "Saving...");
      try {
        if (!value("planner-actor")) throw new Error("Select or enter the person making this decision.");
        await command("plan_session", { request_id: card.dataset.request, decision: button.classList.contains("planner-decline") ? "declined" : "approved", allocated_headcount: parseNumber(card.querySelector(".planner-allocation").value), publish: card.querySelector(".planner-publish").checked, decision_notes: card.querySelector(".planner-notes").value, actor_name: value("planner-actor") });
        await loadData(false); toast("Session decision saved.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(button, false); }
    });

    el("assignment-session").addEventListener("change", renderGroupAssignments);
    el("assignment-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Publishing...");
      var allocations = (state.groups.groups || []).map(function (group) { return { group_code: group.code, headcount: parseNumber(value(groupInputId(group.code))) || 0 }; });
      try { var result = await rpc("ops_assign_groups", { p_session_token: state.session.session_token, p_session_id: value("assignment-session"), p_allocations: allocations, p_actor_name: value("assignment-actor") }); if (result.status !== "success") throw new Error(result.message || "Groups could not be assigned."); await loadData(false); toast("Group allocation published."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });

    el("overview-sessions").addEventListener("click", async function (event) {
      var button = event.target.closest(".session-status"); if (!button) return; setBusy(button, true, "Saving...");
      try { var person = window.prompt("Your name:", ""); if (!person) return; await command("update_session_status", { session_id: button.dataset.id, status: button.dataset.status, actor_name: person }); await loadData(false); toast("Session updated."); }
      catch (error) { toast(error.message, true); } finally { setBusy(button, false); }
    });
    el("notification-list").addEventListener("click", async function (event) {
      var button = event.target.closest(".mark-read"); if (!button) return;
      try { await command("mark_notification_read", { notification_id: button.dataset.id }); await loadData(false); }
      catch (error) { toast(error.message, true); }
    });

    el("daily-date").addEventListener("change", loadDailyReport);
    el("daily-department").addEventListener("change", function () { configureReportingSection("daily"); loadDailyReport(); });
    el("daily-section").addEventListener("change", loadDailyReport);
    el("add-metric-button").addEventListener("click", function () { addMetric({}); });
    el("metric-rows").addEventListener("click", function (event) { var button = event.target.closest(".remove-metric"); if (button) { button.closest(".metric-row").remove(); if (!el("metric-rows").children.length) addMetric({}); } });
    el("save-daily-draft").addEventListener("click", function (event) { saveDaily(false, event.currentTarget); });
    el("daily-report-form").addEventListener("submit", function (event) { event.preventDefault(); saveDaily(true, el("submit-daily-report")); });
    el("daily-report-form").addEventListener("input", function () {
      try { localStorage.setItem("amfcc_ops_daily_draft", JSON.stringify(dailyPayload(false))); el("daily-draft-state").textContent = "Unsaved changes"; el("daily-draft-state").className = "status-pill amber"; } catch (error) { /* storage may be disabled in kiosk mode */ }
    });

    el("period-type").addEventListener("change", function () {
      var start = value("period-start") || today();
      if (value("period-type") === "weekly") { start = mondayFor(start); el("period-start").value = start; el("period-end").value = addDays(start, 6); }
      else { var d = new Date(start + "T12:00:00"); el("period-start").value = dateIso(new Date(d.getFullYear(), d.getMonth(), 1, 12)); el("period-end").value = monthEnd(start); }
    });
    el("period-department").addEventListener("change", function () { configureReportingSection("period"); el("period-report-form").hidden = true; });
    el("period-section").addEventListener("change", function () { el("period-report-form").hidden = true; });
    el("period-controls").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Generating...");
      try { var departmentId = reportDepartmentId("period"); if (!departmentId) throw new Error("Choose Open Field or Greenhouses before generating the Horticulture report."); var result = await rpc("ops_generate_report", { p_session_token: state.session.session_token, p_report_type: value("period-type"), p_department_id: departmentId, p_period_start: value("period-start"), p_period_end: value("period-end") }); if (result.status !== "success") throw new Error(result.message || "Report could not be generated."); populatePeriodPreview(result); toast("Report generated from source records."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("save-period-draft").addEventListener("click", function (event) { savePeriod(false, event.currentTarget); });
    el("period-report-form").addEventListener("submit", function (event) { event.preventDefault(); savePeriod(true, event.currentTarget); });

    el("transfer-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Recording...");
      var payload = { from_department_id: isDepartment() ? currentDepartmentId() : value("transfer-from"), to_department_id: value("transfer-to"), transfer_date: value("transfer-date"), reference: value("transfer-reference"), actor_name: value("transfer-actor"), notes: value("transfer-notes"), items: [{ item_name: value("transfer-item"), quantity: parseNumber(value("transfer-quantity")), unit: value("transfer-unit") }] };
      try { await command("create_transfer", payload); await rememberName(payload.actor_name, payload.from_department_id); event.currentTarget.reset(); el("transfer-date").value = today(); await loadData(false); toast("Transfer recorded."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("transfer-list").addEventListener("click", async function (event) {
      var button = event.target.closest(".receive-transfer"); if (!button) return;
      var person = window.prompt("Name of receiving person:", ""); if (!person) return;
      var notes = button.dataset.decision === "disputed" ? window.prompt("Reason for dispute:", "") : "";
      try { await command("receive_transfer", { transfer_id: button.dataset.id, decision: button.dataset.decision, actor_name: person, notes: notes }); await loadData(false); toast("Transfer updated."); }
      catch (error) { toast(error.message, true); }
    });

    el("tools-department").addEventListener("change", async function () {
      try { await loadDepartmentTools(selectedToolsDepartmentId()); renderTools(); }
      catch (error) { toast(error.message, true); }
    });
    el("tool-plan-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Saving...");
      try { await toolCommand("save_plan", { plan_type:value("tool-plan-type"), title:value("tool-plan-title"), starts_on:value("tool-plan-start"), ends_on:value("tool-plan-end"), details:value("tool-plan-details"), actor_name:value("tool-plan-actor") }); event.currentTarget.reset(); el("tool-plan-start").value=today(); el("tool-plan-end").value=today(); toast("Plan saved."); }
      catch (error) { toast(error.message, true); } finally { setBusy(event.currentTarget, false); }
    });
    el("tool-stock-item-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Adding...");
      try { await toolCommand("add_stock_item", { item_name:value("tool-stock-name"), category:value("tool-stock-category"), unit:value("tool-stock-unit"), opening_quantity:value("tool-stock-opening"), reorder_level:value("tool-stock-reorder"), actor_name:value("tool-stock-actor") }); event.currentTarget.reset(); toast("Stock item added."); }
      catch (error) { toast(error.message, true); } finally { setBusy(event.currentTarget, false); }
    });
    el("tool-stock-movement-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Recording...");
      try { await toolCommand("record_stock_movement", { stock_item_id:value("tool-stock-item"), movement_type:value("tool-stock-movement"), quantity:value("tool-stock-quantity"), movement_date:value("tool-stock-date"), notes:value("tool-stock-notes"), actor_name:value("tool-movement-actor") }); event.currentTarget.reset(); el("tool-stock-date").value=today(); toast("Stock movement recorded."); }
      catch (error) { toast(error.message, true); } finally { setBusy(event.currentTarget, false); }
    });
    el("tool-log-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Saving...");
      try { await toolCommand("record_log", { record_date:value("tool-log-date"), log_type:value("tool-log-type"), title:value("tool-log-title"), quantity:value("tool-log-quantity"), unit:value("tool-log-unit"), notes:value("tool-log-notes"), actor_name:value("tool-log-actor") }); event.currentTarget.reset(); el("tool-log-date").value=today(); toast("Activity recorded."); }
      catch (error) { toast(error.message, true); } finally { setBusy(event.currentTarget, false); }
    });
    el("kitchen-checkin-form").addEventListener("submit", function (event) {
      event.preventDefault(); checkInKitchen(kitchenInputSource(), event.currentTarget);
    });
    el("kitchen-registration").addEventListener("keydown", function (event) {
      var now = Date.now();
      if (event.key === "Enter") { event.preventDefault(); checkInKitchen(kitchenInputSource(), el("kitchen-checkin-form")); return; }
      if (event.key.length === 1) {
        if (!state.scanStartedAt || now - state.scanLastAt > 140) { state.scanStartedAt = now; state.scanKeyCount = 0; }
        state.scanLastAt = now; state.scanKeyCount += 1;
      }
    });
    el("kitchen-registration").addEventListener("blur", function () {
      setTimeout(function () {
        var active = document.activeElement;
        if (el("view-meal-service").classList.contains("active") && (!active || ["INPUT","SELECT","TEXTAREA"].indexOf(active.tagName) < 0)) focusKitchenScanner();
      }, 250);
    });
    el("kitchen-meal").addEventListener("change", focusKitchenScanner);
    el("kitchen-refresh").addEventListener("click", function () { refreshKitchen().then(focusKitchenScanner).catch(function (error) { toast(error.message, true); }); });
    el("kitchen-export").addEventListener("click", async function () {
      try { var result=await rpc("ops_kitchen_service",{p_session_token:state.session.session_token,p_action:"export",p_payload:{service_date:today(),scope:"today"}}); if(result.status!=="success")throw new Error(result.message||"Export failed."); downloadCsv(result.rows||[],"meal-checkins-"+today()+".csv"); }
      catch(error){ toast(error.message,true); }
    });
    document.addEventListener("keydown", function (event) {
      if (!el("view-meal-service").classList.contains("active") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1 || ["INPUT","TEXTAREA","SELECT"].indexOf(event.target.tagName) >= 0) return;
      var now = Date.now();
      if (!state.scanStartedAt || now - state.scanLastAt > 140) { state.scanStartedAt = now; state.scanKeyCount = 0; }
      state.scanLastAt = now; state.scanKeyCount += 1;
      el("kitchen-registration").focus();
      el("kitchen-registration").value += event.key;
      event.preventDefault();
    });
    el("clinic-refresh").addEventListener("click", function () { refreshClinic().catch(function(error){toast(error.message,true);}); });
    el("clinic-search").addEventListener("input", function () {
      clearTimeout(state.clinicTimer); state.clinicTimer=setTimeout(async function(){
        var query=value("clinic-search"); if(query.length<2){el("clinic-results").innerHTML="Enter at least two letters or digits.";return;}
        try { var result=await rpc("ops_clinic_service",{p_session_token:state.session.session_token,p_action:"search",p_payload:{query:query}}); if(result.status!=="success")throw new Error(result.message||"Search failed."); var rows=result.students||[]; el("clinic-results").classList.toggle("empty-state",!rows.length); el("clinic-results").innerHTML=rows.length?rows.map(function(student){return '<article class="data-card"><div class="card-top"><div><h3>'+escapeHtml(student.student_name)+'</h3><p>'+escapeHtml(student.registration_number+" · "+titleCase(student.campus_status))+"</p></div><button class=\"button "+(student.on_bed_rest?"quiet":"primary")+" clinic-bed-rest\" data-action=\""+(student.on_bed_rest?"clear":"start")+"\" data-registration=\""+escapeHtml(student.registration_number)+"\">"+(student.on_bed_rest?"End bed rest":"Start bed rest")+"</button></div></article>";}).join(""):"No matching students."; }
        catch(error){toast(error.message,true);}
      },250);
    });
    function clinicAction(event) {
      var button=event.target.closest(".clinic-bed-rest"); if(!button)return;
      var notes=button.dataset.action==="start"?window.prompt("Clinic notes (optional):",""):"";
      rpc("ops_clinic_service",{p_session_token:state.session.session_token,p_action:"set_bed_rest",p_payload:{registration_number:button.dataset.registration,bed_rest_action:button.dataset.action,notes:notes||""}}).then(function(result){if(result.status!=="success")throw new Error(result.message||"Clinic record could not be saved."); return refreshClinic();}).then(function(){toast("Clinic record updated.");}).catch(function(error){toast(error.message,true);});
    }
    el("clinic-results").addEventListener("click",clinicAction);
    el("clinic-active").addEventListener("click",clinicAction);

    el("report-review-filter").addEventListener("change", renderReports);
    el("report-review-list").addEventListener("click", async function (event) {
      var button = event.target.closest(".report-transition"); if (!button) return;
      var reason = button.dataset.status === "returned" ? window.prompt("Why is this report being returned?", "") : "";
      if (button.dataset.status === "returned" && !reason) return;
      setBusy(button, true, "Saving...");
      try { if (!value("reviewer-name")) throw new Error("Select or enter the reviewer name."); await command("transition_report", { report_id: button.dataset.id, target_status: button.dataset.status, reason: reason, actor_name: value("reviewer-name") }); await loadData(false); toast("Report moved to " + titleCase(button.dataset.status) + "."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(button, false); }
    });
    el("management-action-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Creating...");
      var payload = { department_id: value("action-department") || null, priority: value("action-priority"), summary: value("action-summary"), description: value("action-description"), owner_name: value("action-owner"), due_date: value("action-due-date") || null, actor_name: value("action-actor") || state.session.display_name, sync_to_jira: el("action-jira").checked };
      try { await command("save_management_action", payload); event.currentTarget.reset(); await loadData(false); toast("Management action created."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });

    el("department-access-list").addEventListener("submit", async function (event) {
      var form = event.target.closest(".department-code-form"); if (!form) return; event.preventDefault(); setBusy(form, true, "Setting...");
      try { var result=await rpc("ops_set_department_pin",{p_session_token:state.session.session_token,p_department_id:form.dataset.department,p_pin:form.querySelector('input[type="password"]').value,p_actor_name:form.querySelector(".code-actor").value||state.session.display_name}); if(result.status!=="success")throw new Error(result.message||"PIN could not be set."); form.reset(); await loadData(false); toast("Department PIN set."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(form, false); }
    });

    window.addEventListener("online", function () { if (state.session) loadData(false).catch(function () {}); });
    window.addEventListener("offline", function () { el("connection-state").textContent = "Offline"; el("connection-state").className = "status-pill red"; });
  }

  async function initialise() {
    el("range-from").value = today();
    el("request-date").value = addDays(today(), 1);
    el("daily-date").value = today();
    el("transfer-date").value = today();
    el("period-start").value = mondayFor(today());
    el("period-end").value = addDays(mondayFor(today()), 6);
    el("tool-plan-start").value = today();
    el("tool-plan-end").value = today();
    el("tool-log-date").value = today();
    el("tool-stock-date").value = today();
    el("ss-export-start").value = addDays(today(), -30);
    el("ss-export-end").value = today();
    el("access-code").maxLength = 4;
    el("access-code").pattern = "[0-9]{4}";

    if (!window.APP_CONFIG || !window.APP_CONFIG.SUPABASE_URL || !window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY || !window.supabase) {
      toast("The Supabase connection is not configured.", true); return;
    }
    state.client = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    bindEvents();
    try {
      await loadCatalog();
      if (restoreSession()) {
        showApp();
        try { await loadData(false); }
        catch (error) { toast(error.message, true); signOut(false); }
      } else showLogin();
    } catch (error) {
      showLogin(); toast("Could not connect to the operations service. " + error.message, true);
    }

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  document.addEventListener("DOMContentLoaded", initialise);
})();
