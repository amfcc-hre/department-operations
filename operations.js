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
    periodPreview: null,
    toastTimer: null,
    clinicTimer: null
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
  function slotById(id) { return (state.data.time_slots || []).find(function (s) { return s.id === id; }); }
  function taskById(id) { return (state.data.tasks || []).find(function (task) { return task.id === id; }); }
  function sessionById(id) { return (state.data.work_sessions || []).find(function (session) { return session.id === id; }); }
  function reportById(id) { return (state.data.reports || []).find(function (report) { return report.id === id; }); }
  function currentDepartmentId() { return state.session && state.session.department ? state.session.department.id : null; }
  function isDepartment() { return state.session && state.session.role === "department"; }
  function isLeadership() { return state.session && state.session.role === "student_leadership"; }
  function isManagement() { return state.session && ["management", "administrator"].indexOf(state.session.role) >= 0; }
  function isConference() { return state.mode && state.mode.mode === "conference"; }

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
    sessionStorage.setItem("amfcc_ops_session", JSON.stringify(session));
  }

  function restoreSession() {
    try {
      var raw = sessionStorage.getItem("amfcc_ops_session");
      if (!raw) return false;
      state.session = JSON.parse(raw);
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
      ? "Department workspace: tasks, sessions and reports"
      : titleCase(state.session.role) + " workspace";
    applyRoleVisibility();
  }

  function applyRoleVisibility() {
    var role = state.session.role;
    all("[data-roles]").forEach(function (node) {
      node.hidden = node.dataset.roles.split(",").indexOf(role) < 0;
    });
    all(".admin-department-field").forEach(function (node) { node.hidden = role === "department"; });
    all(".department-entry").forEach(function (node) { node.hidden = role === "student_leadership"; });
    var active = el("main-nav").querySelector("button.active");
    applyOperatingModeVisibility();
    if (active && active.hidden) switchView(isConference() ? "tasks" : "overview");
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
    banner.hidden = state.mode.mode === "normal";
    banner.className = "operating-mode-banner " + state.mode.mode;
    el("operating-mode-title").textContent = state.mode.label || titleCase(state.mode.mode) + " Mode";
    el("operating-mode-message").textContent = conference
      ? "No manual-work sessions are available. Record every piece of work as an Emergency task."
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
    state.data = null;
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
      var department = departmentById(report.department_id);
      return '<article class="data-card alert"><h3>Report returned: ' + escapeHtml(department ? department.name : "Department") + '</h3><p>' + escapeHtml(report.return_reason || "Changes requested") + "</p></article>";
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
      var department = departmentById(report.department_id);
      var actions = [];
      if (["submitted"].indexOf(report.status) >= 0 && ["student_leadership","management","administrator"].indexOf(state.session.role) >= 0) actions.push('<button class="button secondary report-transition" data-id="' + report.id + '" data-status="verified">Verify</button>');
      if (report.status === "verified" && isManagement()) actions.push('<button class="button primary report-transition" data-id="' + report.id + '" data-status="approved">Approve and queue Jira</button>');
      if (["submitted","verified"].indexOf(report.status) >= 0) actions.push('<button class="button quiet report-transition" data-id="' + report.id + '" data-status="returned">Return</button>');
      if (report.status === "approved" && isManagement()) actions.push('<button class="button secondary report-transition" data-id="' + report.id + '" data-status="locked">Lock</button>');
      var metrics = (report.metrics || []).map(function (metric) { return escapeHtml(metric.metric_name) + ": " + escapeHtml(metric.actual_value == null ? "not set" : metric.actual_value) + " " + escapeHtml(metric.unit || "") + " (" + escapeHtml(metric.status) + ")"; }).join("<br>");
      return '<article class="data-card"><div class="card-top"><div><h3>' + escapeHtml((department ? department.name : "Department") + " · " + titleCase(report.report_type)) + '</h3><p>' + escapeHtml(formatDate(report.period_start)) + " to " + escapeHtml(formatDate(report.period_end)) + '</p></div>' + statusPill(report.status) + '</div>' + (report.summary ? '<p><strong>Summary:</strong> ' + escapeHtml(report.summary) + "</p>" : "") + (report.work_completed ? '<p><strong>Completed:</strong> ' + escapeHtml(report.work_completed) + "</p>" : "") + (report.challenges ? '<p><strong>Challenges:</strong> ' + escapeHtml(report.challenges) + "</p>" : "") + (report.return_reason ? '<p><strong>Return reason:</strong> ' + escapeHtml(report.return_reason) + "</p>" : "") + (metrics ? '<p><strong>Figures:</strong><br>' + metrics + "</p>" : "") + (report.jira_issue_url ? '<p><a href="' + escapeHtml(report.jira_issue_url) + '" target="_blank" rel="noopener">Open Jira issue ' + escapeHtml(report.jira_issue_key) + "</a></p>" : "") + '<div class="card-actions">' + actions.join("") + "</div></article>";
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
    var profile = { description: "Plan work, track stock and record the figures your department needs.", plan: "Plan department work", stock: "Add stock or equipment", log: "Record department activity" };
    if (slug === "kitchen") return { description: "Plan meals, record food and ingredient usage, manage meal service and keep reports together.", plan: "Plan meals for a day or week", stock: "Add food or ingredient", log: "Record meals, preparation or wastage" };
    if (slug === "clinic") return { description: "Manage clinic work, bed rest, and medication or material stock in one protected workspace.", plan: "Plan clinic work", stock: "Add medication or material", log: "Record clinic activity" };
    if (["poultry","layers","broilers"].indexOf(slug) >= 0) return { description: "Track feed remaining, deliveries, flock work, production, losses and equipment.", plan: "Plan poultry work", stock: "Add feed or poultry supply", log: "Record flock or production activity" };
    if (slug === "horticulture" || slug === "open-field" || slug.indexOf("greenhouse-") === 0) return { description: "Plan crop work and record seed, inputs, watering, harvests, losses and equipment.", plan: "Plan crop work", stock: "Add seed, input or material", log: "Record crop or harvest activity" };
    if (slug === "fisheries") return { description: "Plan pond work and record feed, stock, water checks, harvests, losses and equipment.", plan: "Plan fisheries work", stock: "Add feed or fisheries supply", log: "Record pond or harvest activity" };
    if (["maintenance","building","painting","chairs-upholstery"].indexOf(slug) >= 0) return { description: "Plan jobs and record materials, equipment, progress, faults and completed work.", plan: "Plan jobs", stock: "Add material or equipment item", log: "Record job progress or equipment activity" };
    if (slug === "transport") return { description: "Plan transport work and record fuel, vehicle materials, trips, faults and maintenance.", plan: "Plan transport work", stock: "Add fuel, part or material", log: "Record trip, fault or maintenance" };
    if (["bakery","tuckshop","conference-centre"].indexOf(slug) >= 0) return { description: "Plan service or production work and track stock, usage, output, wastage and equipment.", plan: "Plan service or production", stock: "Add stock item or ingredient", log: "Record service or production activity" };
    return profile;
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
    el("tools-description").textContent = profile.description;
    el("tool-plan-heading").textContent = profile.plan;
    el("tool-stock-heading").textContent = profile.stock;
    el("tool-log-heading").textContent = profile.log;
    el("tool-quick-links").innerHTML = '<a class="button secondary" href="#tool-plan-form">Planning</a><a class="button secondary" href="#tool-stock-item-form">Stock and usage</a><a class="button secondary" href="#tool-log-form">Activity records</a>';

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

    var kitchen = tools.department_slug === "kitchen";
    var clinic = tools.department_slug === "clinic";
    el("kitchen-service-panel").hidden = !kitchen;
    el("clinic-service-panel").hidden = !clinic;
    if (kitchen) refreshKitchen().catch(function (error) { toast(error.message, true); });
    if (clinic) refreshClinic().catch(function (error) { toast(error.message, true); });
  }

  async function toolCommand(action, payload) {
    payload = payload || {};
    payload.department_id = selectedToolsDepartmentId();
    var result = await rpc("ops_department_tool_command", { p_session_token: state.session.session_token, p_action: action, p_payload: payload });
    if (result.status !== "success") throw new Error(result.message || "The record could not be saved.");
    await loadDepartmentTools(selectedToolsDepartmentId());
    renderTools();
  }

  async function refreshKitchen() {
    var result = await rpc("ops_kitchen_service", { p_session_token: state.session.session_token, p_action: "dashboard", p_payload: { service_date: today() } });
    if (result.status !== "success") throw new Error(result.message || "Kitchen totals could not be loaded.");
    var meals = ["Breakfast","Lunch","Break-fast 4pm","Supper"];
    el("kitchen-counts").innerHTML = meals.map(function (meal) { return '<article class="summary-card"><div class="label">' + escapeHtml(meal) + '</div><div class="value">' + Number((result.counts || {})[meal] || 0) + '</div></article>'; }).join("") + '<article class="summary-card"><div class="label">Lunch to cook</div><div class="value">' + Number(result.lunch_to_cook || 0) + '</div></article>';
  }

  async function refreshClinic() {
    var result = await rpc("ops_clinic_service", { p_session_token: state.session.session_token, p_action: "active", p_payload: {} });
    if (result.status !== "success") throw new Error(result.message || "Clinic records could not be loaded.");
    var rows = result.students || [];
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
    renderAccess();
    loadDailyReport();
  }

  function switchView(view) {
    all(".view").forEach(function (section) { section.classList.toggle("active", section.id === "view-" + view); });
    all("#main-nav button").forEach(function (button) { button.classList.toggle("active", button.dataset.view === view); });
    if (view === "tools" && selectedToolsDepartmentId() && (!state.tools || state.tools.department_id !== selectedToolsDepartmentId())) {
      loadDepartmentTools(selectedToolsDepartmentId()).then(renderTools).catch(function (error) { toast(error.message, true); });
    }
    window.scrollTo(0, 0);
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

  function dailyDepartmentId() { return isDepartment() ? currentDepartmentId() : value("daily-department"); }
  function loadDailyReport() {
    if (!state.data) return;
    var departmentId = dailyDepartmentId();
    var reportDate = value("daily-date") || today();
    var report = (state.data.reports || []).find(function (r) { return r.department_id === departmentId && r.report_type === "daily" && r.report_date === reportDate; });
    var fields = { "daily-actor":"prepared_by_name","daily-staff":"staff_on_duty","daily-completed":"work_completed","daily-open":"work_open","daily-challenges":"challenges","daily-action":"action_required","daily-stock":"stock_equipment","daily-risks":"risks","daily-support":"support_required","daily-next":"next_period_plan" };
    Object.keys(fields).forEach(function (id) { el(id).value = report ? report[fields[id]] || "" : ""; });
    el("metric-rows").innerHTML = "";
    (report && report.metrics && report.metrics.length ? report.metrics : [{}]).forEach(addMetric);
    el("daily-draft-state").textContent = report ? titleCase(report.status) : "Not saved";
    el("daily-draft-state").className = "status-pill " + (report ? report.status : "neutral");
    var locked = report && ["approved","locked"].indexOf(report.status) >= 0;
    all("input,textarea,select,button", el("daily-report-form")).forEach(function (node) { node.disabled = !!locked; });
  }

  function dailyPayload(submit) {
    var reportDate = value("daily-date");
    return {
      actor_name: value("daily-actor"), department_id: dailyDepartmentId(), report_type: "daily",
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
      await rememberName(payload.actor_name, payload.department_id);
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
    return {
      actor_name: value("period-actor"), department_id: isDepartment() ? currentDepartmentId() : value("period-department"),
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
      await rememberName(payload.actor_name, payload.department_id);
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
      el("access-code").inputMode = department ? "numeric" : "text";
      el("access-code").maxLength = department ? 4 : 64;
      el("access-code").pattern = department ? "[0-9]{4}" : "";
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
    el("daily-department").addEventListener("change", loadDailyReport);
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
    el("period-controls").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Generating...");
      try { var result = await rpc("ops_generate_report", { p_session_token: state.session.session_token, p_report_type: value("period-type"), p_department_id: isDepartment() ? currentDepartmentId() : value("period-department"), p_period_start: value("period-start"), p_period_end: value("period-end") }); if (result.status !== "success") throw new Error(result.message || "Report could not be generated."); populatePeriodPreview(result); toast("Report generated from source records."); }
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
    el("kitchen-checkin-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Checking in...");
      try { var result=await rpc("ops_kitchen_service",{p_session_token:state.session.session_token,p_action:"check_in",p_payload:{service_date:today(),registration_number:value("kitchen-registration"),meal_session:value("kitchen-meal")}}); if (["checked_in","duplicate"].indexOf(result.status)<0) throw new Error(result.message||"Check-in could not be saved."); el("kitchen-registration").value=""; await refreshKitchen(); toast(result.status==="duplicate"?"Student was already checked in.":"Student checked in."); }
      catch (error) { toast(error.message,true); } finally { setBusy(event.currentTarget,false); }
    });
    el("kitchen-export").addEventListener("click", async function () {
      try { var result=await rpc("ops_kitchen_service",{p_session_token:state.session.session_token,p_action:"export",p_payload:{service_date:today(),scope:"today"}}); if(result.status!=="success")throw new Error(result.message||"Export failed."); downloadCsv(result.rows||[],"meal-checkins-"+today()+".csv"); }
      catch(error){ toast(error.message,true); }
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
