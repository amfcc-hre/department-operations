(function () {
  "use strict";

  var state = {
    client: null,
    catalog: { departments: [] },
    session: null,
    pinSetupMode: false,
    pinSetupOverview: { setups: [] },
    generatedPinSetupCodes: {},
    data: null,
    groups: { groups: [], allocations: [], holiday_mode: false },
    planning: { current_duty: {}, duties: [], department_group_counts: [], standing_rules: [] },
    duties: { current_week: null, weeks: [], gate_assignments: [], permissions: {} },
    serviceDutyDraft: { week_start: null, kitchen_people: [], toilet_people: [], dirty: false },
    plannerView: "daily",
    editingRoster: [],
    editingRosterDepartmentId: null,
    plannerTimer: null,
    draggedSessionId: null,
    personLookupResolve: null,
    studentSearchTimers: {},
    studentSearchSequences: {},
    studentSearchCounter: 0,
    mode: { mode: "normal", conference_mode: false, holiday_mode: false },
    tools: null,
    accommodation: null,
    accommodationBuilding: null,
    accommodationEdit: null,
    studentServices: null,
    studentTermId: null,
    studentEdit: null,
    passReview: null,
    showPassArchive: false,
    gatePassLink: null,
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
  function departmentBySlug(slug) {
    return (state.data ? state.data.departments : state.catalog.departments || []).find(function (d) { return d.slug === slug; });
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
  function reportingSectionConfig(parentDepartmentId) {
    var parent = departmentById(parentDepartmentId);
    if (!parent) return null;
    var configs = {
      "horticulture": {
        slugs:["open-field", "greenhouses"],
        help:"Open Field and Greenhouses submit separately under Horticulture.",
        title:"Horticulture reporting:",
        note:"Use one Horticulture PIN, then choose Open Field or Greenhouses. Greenhouse 1, 2 and 3 are all included within Greenhouses."
      },
      "poultry": {
        slugs:["layers", "broilers"],
        help:"Layers and Broilers submit separately under Poultry.",
        title:"Poultry reporting:",
        note:"Use one Poultry PIN, then choose Layers or Broilers for each report."
      }
    };
    return configs[parent.slug] || null;
  }
  function reportingSections(parentDepartmentId) {
    if (!state.data || !parentDepartmentId) return [];
    var config = reportingSectionConfig(parentDepartmentId);
    if (!config) return [];
    return (state.data.departments || []).filter(function (department) {
      return department.parent_department_id === parentDepartmentId
        && department.active !== false
        && department.workspace_enabled === false
        && config.slugs.indexOf(department.slug) >= 0;
    });
  }
  function baseReportDepartmentId(prefix) {
    return isDepartment() ? currentDepartmentId() : value(prefix + "-department");
  }
  function configureReportingSection(prefix) {
    var parentId = baseReportDepartmentId(prefix);
    var config = reportingSectionConfig(parentId);
    var sections = reportingSections(parentId);
    var field = el(prefix + "-section-field");
    var select = el(prefix + "-section");
    var help = el(prefix + "-section-help");
    var previous = select.value;
    fillSelect(select, sections, { first: "Choose section" });
    if (sections.some(function (section) { return section.id === previous; })) select.value = previous;
    field.hidden = !sections.length;
    select.required = !!sections.length;
    if (help) help.textContent = config ? config.help : "";
    if (!sections.length) select.value = "";
    if (prefix === "daily") {
      el("daily-reporting-note").hidden = !sections.length;
      el("daily-reporting-note-title").textContent = config ? config.title : "";
      el("daily-reporting-note-copy").textContent = config ? config.note : "";
    }
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
  function isSecurityWorkspace() { return isDepartment() && currentDepartmentSlug() === "security"; }
  function isAccommodationWorkspace() {
    return isDepartment() && ["conference-centre", "student-accommodation"].indexOf(currentDepartmentSlug()) >= 0;
  }
  function hasDutiesWorkspace() { return isLeadership() || isManagement() || isSecurityWorkspace(); }
  function peopleDirectory() {
    return state.data && state.data.people_directory && state.data.people_directory.status === "success"
      ? state.data.people_directory : { students: [], staff: [], leadership: [], department_members: [] };
  }
  function selectedMembersDepartmentId() {
    return isDepartment() ? currentDepartmentId() : value("members-department");
  }
  function departmentMembers(departmentId) {
    var directoryMembers = peopleDirectory().department_members || [];
    var source = directoryMembers.length ? directoryMembers : (state.planning.department_members || []);
    return source.filter(function (person) {
      return person.department_id === departmentId;
    });
  }
  function lookupPool(scope) {
    var people = peopleDirectory();
    if (scope === "staff") return people.staff || [];
    if (scope === "student") return people.students || state.planning.student_lookup || [];
    if (scope === "second-year") return (people.students || state.planning.student_lookup || []).filter(function (person) {
      return serviceYearNumber(person.registration_number) === 2;
    });
    if (scope === "leadership") return (people.leadership || []).length ? people.leadership : (state.planning.leadership_people || []);
    if (scope === "senior") return ((people.leadership || []).length ? people.leadership : (state.planning.leadership_people || [])).filter(function (person) { return person.is_senior_prefect; });
    if (scope === "department-member") return departmentMembers(currentDepartmentId());
    if (scope === "department-hod") return departmentMembers(selectedMembersDepartmentId()).filter(function (person) { return person.member_role === "hod"; });
    return [];
  }
  function lookupPersonId(person) { return String(person && (person.student_id || person.id) || ""); }
  function lookupPersonName(person) { return String(person && (person.full_name || person.student_name) || "").trim(); }
  function lookupRegistration(person) { return String(person && person.registration_number || "").trim(); }
  function lookupDisplayLabel(person) {
    var name = lookupPersonName(person), registration = lookupRegistration(person);
    return registration ? name + " · " + registration : name;
  }
  function setLookupSelection(input, person) {
    if (!input || !person) return;
    input.value = lookupDisplayLabel(person);
    input.dataset.selectedStudentId = lookupPersonId(person);
    input.dataset.selectedRegistration = lookupRegistration(person);
    input.dataset.selectedName = lookupPersonName(person);
    input.dataset.selectedDisplayValue = input.value;
  }
  function clearLookupSelection(input) {
    delete input.dataset.selectedStudentId;
    delete input.dataset.selectedRegistration;
    delete input.dataset.selectedName;
    delete input.dataset.selectedDisplayValue;
  }
  function exactLookup(scope, name, input) {
    var raw = String(name || "").trim();
    var target = raw.split("·")[0].trim().toLowerCase();
    var displayedRegistration = raw.indexOf("·") >= 0 ? raw.split("·").pop().trim() : "";
    var pool = lookupPool(scope);
    if (input && input.dataset.selectedDisplayValue === raw) {
      var selectedId = input.dataset.selectedStudentId;
      var selectedRegistration = input.dataset.selectedRegistration;
      var selected = pool.find(function (person) {
        return (selectedId && lookupPersonId(person) === selectedId)
          || (selectedRegistration && lookupRegistration(person) === selectedRegistration);
      });
      if (selected) return selected;
    }
    if (displayedRegistration) {
      var byRegistration = pool.find(function (person) { return lookupRegistration(person) === displayedRegistration; });
      if (byRegistration) return byRegistration;
    }
    return pool.find(function (person) { return lookupPersonName(person).toLowerCase() === target; }) || null;
  }
  function requireLookup(inputOrId, scope) {
    var input = typeof inputOrId === "string" ? el(inputOrId) : inputOrId;
    var person = exactLookup(scope || input.dataset.lookup, input.value, input);
    if (!person) throw new Error("Choose an exact name from the lookup list.");
    if ((scope || input.dataset.lookup) !== "staff") setLookupSelection(input, person);
    else input.value = person.full_name;
    return person;
  }
  function fillDatalist(id, items) {
    var node = el(id);
    if (!node) return;
    var seen = {};
    node.innerHTML = (items || []).filter(function (person) {
      var key = String(person.full_name || "").toLowerCase();
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    }).map(function (person) { return '<option value="' + escapeHtml(person.full_name) + '"></option>'; }).join("");
  }
  function refreshLookupLists() {
    fillDatalist("staff-name-options", lookupPool("staff"));
    fillDatalist("student-name-options", lookupPool("student"));
    fillDatalist("leadership-name-options", lookupPool("leadership"));
    fillDatalist("senior-prefect-options", lookupPool("senior"));
    fillDatalist("department-member-options", lookupPool("department-member"));
    fillDatalist("department-hod-options", lookupPool("department-hod"));
    all("[data-lookup]").forEach(ensureStudentLookup);
  }
  function isStudentLookupInput(input) {
    return !!(input && input.matches && input.matches("[data-lookup]") && input.dataset.lookup !== "staff");
  }
  function ensureStudentLookup(input) {
    if (!isStudentLookupInput(input)) return null;
    input.removeAttribute("list");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-autocomplete", "list");
    if (!input.dataset.studentSearchKey) {
      state.studentSearchCounter += 1;
      input.dataset.studentSearchKey = "student-lookup-" + state.studentSearchCounter;
    }
    var resultsId = input.getAttribute("aria-controls");
    var results = resultsId ? el(resultsId) : null;
    if (!results || !results.classList.contains("student-search-results")) {
      results = document.createElement("div");
      results.id = "student-search-results-" + state.studentSearchCounter;
      results.className = "student-search-results";
      results.hidden = true;
      input.insertAdjacentElement("afterend", results);
      input.setAttribute("aria-controls", results.id);
    }
    if (input.parentElement) input.parentElement.classList.add("student-search-field");
    return results;
  }
  function studentSearchResults(input) {
    var resultsId = input && input.getAttribute("aria-controls");
    return resultsId ? el(resultsId) : null;
  }
  function hideStudentSearchResults(input) {
    var results = studentSearchResults(input);
    if (!results) return;
    results.hidden = true;
    results.innerHTML = "";
  }
  function hideAllStudentSearchResults() {
    all(".student-search-results").forEach(function (results) {
      results.hidden = true;
      results.innerHTML = "";
    });
  }
  function renderStudentSearchStatus(input, message) {
    var results = ensureStudentLookup(input);
    if (!results) return;
    results.hidden = false;
    results.innerHTML = '<div class="student-search-status">' + escapeHtml(message) + '</div>';
  }
  function allowedLookupMatch(scope, match) {
    var registration = String(match.registration_number || "");
    var name = String(match.student_name || "").trim().toLowerCase();
    return lookupPool(scope).find(function (person) {
      return (registration && lookupRegistration(person) === registration)
        || lookupPersonName(person).toLowerCase() === name;
    }) || null;
  }
  function renderStudentSearchResults(input, matches) {
    var results = ensureStudentLookup(input);
    if (!results) return;
    var scope = input.dataset.lookup;
    var allowed = (matches || []).map(function (match) { return allowedLookupMatch(scope, match); }).filter(function (person, index, rows) {
      return person && rows.findIndex(function (item) { return lookupPersonId(item) === lookupPersonId(person); }) === index;
    });
    results.hidden = false;
    if (!allowed.length) {
      results.innerHTML = '<div class="student-search-status">No eligible active student matched that name or registration number.</div>';
      return;
    }
    results.innerHTML = allowed.map(function (person) {
      return '<button type="button" class="student-search-option" data-student-search-key="' + escapeHtml(input.dataset.studentSearchKey) + '" data-student-id="' + escapeHtml(lookupPersonId(person)) + '" data-registration-number="' + escapeHtml(lookupRegistration(person)) + '"><strong>' + escapeHtml(lookupPersonName(person)) + '</strong><span>Registration: ' + escapeHtml(lookupRegistration(person)) + '</span></button>';
    }).join("");
  }
  async function searchStudentRecords(query) {
    var cleanQuery = String(query || "").trim();
    if (cleanQuery.length < 2) return { matches: [], message: "Enter at least two letters of the name or two digits of the registration number." };
    var response = await state.client.rpc("gate_pass_student_search", { p_query: cleanQuery });
    if (response.error) return { matches: [], message: response.error.message || "Student search is temporarily unavailable." };
    if (!response.data || response.data.status !== "success") return { matches: [], message: response.data && response.data.message || "No matching students were found." };
    return { matches: Array.isArray(response.data.matches) ? response.data.matches : [], message: "" };
  }
  function queueStudentSearch(input) {
    var results = ensureStudentLookup(input);
    if (!results || !state.client) return;
    var key = input.dataset.studentSearchKey;
    var query = String(input.value || "").trim();
    clearTimeout(state.studentSearchTimers[key]);
    state.studentSearchSequences[key] = Number(state.studentSearchSequences[key] || 0) + 1;
    var sequence = state.studentSearchSequences[key];
    if (query.length < 2) { hideStudentSearchResults(input); return; }
    state.studentSearchTimers[key] = setTimeout(async function () {
      renderStudentSearchStatus(input, "Searching…");
      var result = await searchStudentRecords(query);
      if (sequence !== state.studentSearchSequences[key]) return;
      if (result.message && !result.matches.length) { renderStudentSearchStatus(input, result.message); return; }
      renderStudentSearchResults(input, result.matches);
    }, 250);
  }
  function studentLookupInputByKey(key) {
    return all("[data-student-search-key]").find(function (input) { return input.dataset.studentSearchKey === key; }) || null;
  }
  function choosePerson(scope,title) {
    return new Promise(function (resolve,reject) {
      state.personLookupResolve={resolve:resolve,reject:reject,scope:scope};
      el("person-lookup-title").textContent=title||"Choose person";
      el("person-lookup-input").dataset.lookup=scope;
      el("person-lookup-input").value="";
      clearLookupSelection(el("person-lookup-input"));
      ensureStudentLookup(el("person-lookup-input"));
      el("person-lookup-modal").hidden=false;
      setTimeout(function(){el("person-lookup-input").focus();},50);
    });
  }
  function closePersonLookup() {
    if(state.personLookupResolve)state.personLookupResolve.reject(new Error("No person selected."));
    state.personLookupResolve=null; el("person-lookup-modal").hidden=true;
  }
  function workspaceDefaultView() {
    if (isKitchenWorkspace()) return "meal-service";
    if (isClinicWorkspace()) return "clinic-service";
    if (isAccommodationWorkspace()) return "accommodation-service";
    if (isSecurityWorkspace()) return "duties";
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
    if (data && ["unauthorized", "locked"].indexOf(data.status) >= 0 && name !== "ops_login" && state.session) {
      signOut(false);
      throw new Error(data.message || "Your session has ended.");
    }
    el("connection-state").textContent = "Connected";
    el("connection-state").className = "status-pill green";
    return data;
  }

  function dispatchPassEmail() {
    if (state.client.functions && typeof state.client.functions.invoke === "function") {
      state.client.functions.invoke("pass-email-worker").catch(function () {});
    }
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

  function selectedLoginDepartment() {
    var slug = value("login-department");
    return (state.catalog.departments || []).find(function (department) { return department.slug === slug; }) || null;
  }

  function isDepartmentPinSetupMode() {
    var department = selectedLoginDepartment();
    return value("access-type") === "department" && !!department && (!department.login_enabled || state.pinSetupMode);
  }

  function updateDepartmentLoginForm() {
    var departmentLogin = value("access-type") === "department";
    var department = selectedLoginDepartment();
    var setupMode = isDepartmentPinSetupMode();
    var currentPinField = el("access-code-field");
    var setupPanel = el("department-pin-setup");
    var setupCode = el("department-setup-code");
    var newPin = el("department-new-pin");
    var confirmPin = el("department-confirm-pin");

    el("department-login-field").hidden = !departmentLogin;
    el("login-department").required = departmentLogin;
    currentPinField.hidden = setupMode;
    el("access-code").required = !setupMode;
    setupPanel.hidden = !setupMode;
    setupCode.required = setupMode;
    newPin.required = setupMode;
    confirmPin.required = setupMode;

    el("use-department-setup").hidden = !(
      departmentLogin && department && department.login_enabled && department.pin_setup_available && !setupMode
    );
    el("use-existing-pin").hidden = !(setupMode && department && department.login_enabled);
    el("login-submit").textContent = setupMode ? "Set PIN and open workspace" : "Open workspace";

    if (setupMode) {
      el("department-pin-setup-message").textContent = department.pin_setup_available
        ? "A one-time setup code is ready. It expires " + formatDateTime(department.pin_setup_expires_at) + ". Enter it once, then choose the four-digit PIN your department will share."
        : "Ask School Administration to issue a one-time setup code. Refresh this page after the code has been issued. The code expires after 24 hours and works once.";
    }
  }

  async function loadCatalog() {
    var data = await rpc("ops_catalog");
    state.catalog = data;
    fillSelect(el("login-department"), data.departments || [], { id: "slug", label: "name", first: "Choose department" });
    updateDepartmentLoginForm();
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

  function readGatePassLink() {
    var params = new URLSearchParams(window.location.search || "");
    var passId = String(params.get("pass") || "").trim();
    var action = String(params.get("pass_action") || "view").toLowerCase();
    var access = String(params.get("access") || "").toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(passId)) return null;
    if (["view","approved","rejected"].indexOf(action) < 0) action = "view";
    if (["management","administrator","student_leadership"].indexOf(access) < 0) access = "management";
    return { passId:passId, action:action, access:access, handled:false };
  }

  async function openLinkedGatePass() {
    var link = state.gatePassLink;
    if (!link || link.handled || !state.session || state.session.role !== link.access) return;
    link.handled = true;
    switchView("student-services");
    activateStudentServicesTab("passes");
    try {
      await openStudentPass(link.passId);
      var target = el("ss-pass-actions").querySelector('[data-decision="' + link.action + '"]');
      if (link.action === "rejected") el("ss-pass-comments").focus();
      else if (link.action === "approved" && state.session.role === "management") el("ss-senior-role").focus();
      else if (target) target.focus();
      if (link.action !== "view") toast("Review the pass, choose the correct senior role, then confirm your decision.");
      window.history.replaceState({},document.title,window.location.pathname);
    } catch (error) {
      link.handled = false;
      toast(error.message || "The linked gate pass could not be opened.",true);
    }
  }

  function showLogin() {
    el("login-screen").hidden = false;
    el("app-shell").hidden = true;
    el("access-type").value = state.gatePassLink ? state.gatePassLink.access : "department";
    el("department-login-field").hidden = !!state.gatePassLink;
    el("login-department").required = !state.gatePassLink;
    el("login-department").value = "";
    state.pinSetupMode = false;
    el("access-code").value = "";
    el("department-setup-code").value = "";
    el("department-new-pin").value = "";
    el("department-confirm-pin").value = "";
    el("access-code").pattern = "[0-9]{4}";
    var button = el("login-form").querySelector('button[type="submit"]');
    button.disabled = false; button.textContent = "Open workspace"; delete button.dataset.label;
    updateDepartmentLoginForm();
  }

  function showApp() {
    el("login-screen").hidden = true;
    el("app-shell").hidden = false;
    el("workspace-title").textContent = state.session.display_name || titleCase(state.session.role);
    el("workspace-subtitle").textContent = state.session.role === "department"
      ? (isKitchenWorkspace()
        ? "Daily meal service, food planning, stock and reporting"
        : isClinicWorkspace()
        ? "Clinic register, medication stock and reporting"
        : isAccommodationWorkspace()
        ? "Building-by-building student accommodation assignments and residence operations"
        : "Purpose-built operations, reporting and support requests")
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
      var departmentAllowed = role !== "department" || currentDepartmentSlug() === node.dataset.departmentSlug;
      node.hidden = !roleAllowed || !departmentAllowed;
    });
    all("[data-accommodation-only]").forEach(function (node) {
      node.hidden = role !== "department" || !isAccommodationWorkspace();
    });
    var overviewButton = el("main-nav").querySelector('[data-view="overview"]');
    if (overviewButton) overviewButton.hidden = role === "department" && (["kitchen", "clinic"].indexOf(currentDepartmentSlug()) >= 0 || isAccommodationWorkspace());
    applyDepartmentNavigation();
    all(".admin-department-field").forEach(function (node) { node.hidden = role === "department"; });
    if (el("members-hod-confirm-field")) el("members-hod-confirm-field").hidden = role !== "department";
    all(".department-entry").forEach(function (node) { node.hidden = role === "student_leadership"; });
    all("[data-ss-admin-only]").forEach(function (node) { node.hidden = role !== "administrator"; });
    el("overview-range-control").hidden = role === "administrator";
    el("tasks-description").textContent = role === "department"
      ? "Submit work for a day. Student Leadership chooses the session and student groups."
      : role === "student_leadership"
      ? "Approve, allocate and publish pending work from the same page."
      : role === "administrator"
      ? "View and export the school task list."
      : "Track open work and maintain the weekly duty roster from Duties.";
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
    el("overview-session-panel").hidden = conference || state.session.role === "administrator" || isLeadership();
    var banner = el("operating-mode-banner");
    banner.hidden = state.mode.mode === "normal" && !conference;
    banner.className = "operating-mode-banner " + (conference ? "conference" : state.mode.mode);
    el("operating-mode-title").textContent = state.mode.combined_label || state.mode.label || titleCase(state.mode.mode) + " Mode";
    el("operating-mode-message").textContent = conference
      ? (state.mode.holiday_mode ? "Holiday calendar rules remain active. " : "School Term calendar rules remain active. ") + "Conference Mode removes manual-work sessions and disables both meal check-in and collection. Record every piece of work as an Emergency task."
      : "Morning and Afternoon task sessions are available during Holiday Mode.";
    var kitchenForm = el("kitchen-checkin-form");
    var kitchenNotice = el("kitchen-conference-notice");
    var kitchenScannerLink = el("kitchen-scanner-link");
    if (kitchenForm) {
      all("input,select,button",kitchenForm).forEach(function (control) { control.disabled = conference; });
    }
    if (kitchenNotice) kitchenNotice.hidden = !conference;
    if (kitchenScannerLink) kitchenScannerLink.hidden = conference;
    if (conference && el("kitchen-scanner-state")) {
      el("kitchen-scanner-state").className = "status-pill red";
      el("kitchen-scanner-state").textContent = "Conference Mode";
      el("kitchen-scan-result").className = "scan-result error";
      el("kitchen-scan-result").innerHTML = "<strong>Meal collection disabled</strong><span>Conference Mode is on.</span>";
    } else if (!conference && el("kitchen-scanner-state")) {
      el("kitchen-scanner-state").className = "status-pill green";
      el("kitchen-scanner-state").textContent = "Ready to scan";
      el("kitchen-scan-result").className = "scan-result neutral";
      el("kitchen-scan-result").textContent = "Waiting for the next student card.";
    }
    if (conference) {
      if (el("work-priority")) {
        el("work-priority").value = "crucial";
        el("work-priority").disabled = true;
        el("work-crucial-field").hidden = false;
        el("work-crucial-reason").required = true;
      }
      var active = el("main-nav").querySelector("button.active");
      if (active && ["requests","planner","assignments"].indexOf(active.dataset.view) >= 0) switchView("tasks");
    } else if (el("work-priority")) el("work-priority").disabled = false;
  }

  async function signOut(callServer) {
    if (callServer !== false && state.session && state.session.session_token) {
      try { await rpc("ops_logout", { p_session_token: state.session.session_token }); } catch (error) { /* local logout still proceeds */ }
    }
    state.session = null;
    state.pinSetupMode = false;
    state.pinSetupOverview = { setups: [] };
    state.generatedPinSetupCodes = {};
    state.initialViewApplied = false;
    state.data = null;
    state.studentServices = null;
    state.planning = { current_duty: {}, duties: [], department_group_counts: [], standing_rules: [] };
    state.duties = { current_week: null, weeks: [], gate_assignments: [], permissions: {} };
    state.serviceDutyDraft = { week_start: null, kitchen_people: [], toilet_people: [], dirty: false };
    state.accommodation = null;
    state.accommodationBuilding = null;
    state.accommodationEdit = null;
    state.studentEdit = null;
    state.passReview = null;
    sessionStorage.removeItem("amfcc_ops_session");
    showLogin();
  }

  async function loadData(showMessage) {
    if (!state.session) return;
    var from = value("range-from") || today();
    state.mode = await rpc("system_mode_status");
    var data = await rpc("ops_bootstrap_v2", {
      p_session_token: state.session.session_token,
      p_from_date: from,
      p_to_date: addDays(from, 62)
    });
    state.data = data;
    state.pinSetupOverview = { setups: [] };
    if (state.session.role === "administrator") {
      try {
        state.pinSetupOverview = await rpc("ops_department_pin_setup_overview", { p_session_token: state.session.session_token });
      } catch (setupError) {
        var setupMessage = String(setupError && setupError.message || setupError || "");
        if (!/ops_department_pin_setup_overview|schema cache|could not find the function/i.test(setupMessage)) throw setupError;
      }
    }
    state.groups = await rpc("ops_group_planner", {
      p_session_token: state.session.session_token,
      p_from_date: from,
      p_to_date: addDays(from, 21)
    });
    state.planning = await rpc("ops_planning_dashboard_v2", {
      p_session_token: state.session.session_token,
      p_from_week: mondayFor(today()),
      p_to_week: addDays(mondayFor(today()), 120)
    });
    state.duties = hasDutiesWorkspace() ? await rpc("ops_duties_dashboard", {
      p_session_token: state.session.session_token,
      p_from_week: mondayFor(today()),
      p_to_week: addDays(mondayFor(today()), 120)
    }) : { current_week: mondayFor(today()), weeks: [], gate_assignments: [], permissions: {} };
    (state.data.session_requests || []).forEach(function (request) {
      request.request_kind = (state.groups.request_kinds || {})[request.id] || "planned";
    });
    if (isDepartment()) await loadDepartmentTools(currentDepartmentId());
    if (isAccommodationWorkspace()) await loadAccommodation();
    else state.accommodation = null;
    if (!isDepartment()) await loadStudentServices();
    else state.studentServices = null;
    renderAll();
    await openLinkedGatePass();
    if (showMessage) toast("Workspace refreshed.");
  }

  async function refreshPlannerLive() {
    if (!state.session || ["student_leadership","management"].indexOf(state.session.role)<0 || document.hidden) return;
    if (all(".planner-approval-popover",el("planner-board")).some(function(node){return !node.hidden;})) return;
    var from=value("range-from")||today();
    try {
      var data=await rpc("ops_bootstrap_v2",{p_session_token:state.session.session_token,p_from_date:from,p_to_date:addDays(from,62)});
      var groups=await rpc("ops_group_planner",{p_session_token:state.session.session_token,p_from_date:from,p_to_date:addDays(from,62)});
      var planning=await rpc("ops_planning_dashboard_v2",{p_session_token:state.session.session_token,p_from_week:mondayFor(today()),p_to_week:addDays(mondayFor(today()),120)});
      var duties=hasDutiesWorkspace()?await rpc("ops_duties_dashboard",{p_session_token:state.session.session_token,p_from_week:mondayFor(today()),p_to_week:addDays(mondayFor(today()),120)}):state.duties;
      state.data=data;state.groups=groups;state.planning=planning;state.duties=duties;
      (state.data.session_requests||[]).forEach(function(request){request.request_kind=(state.groups.request_kinds||{})[request.id]||"planned";});
      populateWorkspaceInputs();renderSummary();renderDutyRoster();renderDutiesWorkspace();renderTasks();renderDepartmentMemberSummary();renderMembersWorkspace();renderRequests();renderPlanner();renderStandingDepartments();renderOverviewSessions();
      el("planner-live-state").textContent="Live · "+new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
      el("planner-live-state").className="status-pill green";
    } catch(error) {
      el("planner-live-state").textContent="Refresh failed";el("planner-live-state").className="status-pill red";
    }
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
    var selectors = ["task-department","request-department","daily-department","period-department","transfer-from","transfer-to","task-list-department","action-department","tools-department","standing-department","members-department"];
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
    if (el("standing-slot-options")) {
      el("standing-slot-options").innerHTML = '<legend>Sessions</legend><p class="field-help">Leave every session unticked to reserve the department for every session.</p>' + requestSlots.map(function (slot) {
        return '<label><input type="checkbox" name="standing-slot" value="' + escapeHtml(slot.code) + '"> ' + escapeHtml(slot.name) + '</label>';
      }).join("");
    }
    if (!isDepartment() && el("tools-department") && !el("tools-department").value && departments.length) el("tools-department").value = departments[0].id;
    configureReportingSection("daily");
    configureReportingSection("period");

    refreshLookupLists();
  }

  function renderSummary() {
    var todayIso = today();
    var openTasks = (state.data.tasks || []).filter(function (t) { return ["done","cancelled"].indexOf(t.status) < 0; });
    var sessions = isConference() ? [] : (state.data.work_sessions || []).filter(function (s) { return s.work_date >= todayIso && s.status !== "cancelled"; });
    var pending = isConference() ? [] : (state.data.session_requests || []).filter(function (r) { return r.status === "pending"; });
    var reports = (state.data.reports || []).filter(function (r) { return ["submitted","verified","returned"].indexOf(r.status) >= 0; });
    var counts = state.studentServices && state.studentServices.counts || {};
    var fourthCard = isLeadership()
      ? [(state.data.notifications || []).filter(function (notice) { return !notice.read; }).length,"Unread notifications",false,"overview",null]
      : [reports.length,isDepartment() ? "Reports in review" : "Reports needing action",reports.some(function (r) { return r.status === "returned"; }),isDepartment() ? "daily-report" : "reports",null];
    var cards = state.session.role === "administrator" ? [
      [openTasks.length,"Open tasks",openTasks.some(function (t) { return t.status === "blocked"; }),"tasks",null],
      [counts.on_campus || 0,"Students on campus",false,"student-services","campus:IN"],
      [counts.off_campus || 0,"Students off campus",false,"student-services","campus:OUT"],
      [counts.pending_passes || 0,"Pending passes",Number(counts.pending_passes || 0) > 0,"student-services","passes:pending"],
      [counts.overdue_passes || 0,"Overdue passes",Number(counts.overdue_passes || 0) > 0,"student-services","passes:OVERDUE"]
    ] : [
      [openTasks.length,"Open tasks",openTasks.some(function (t) { return t.status === "blocked"; }),"tasks",null],
      [sessions.length,"Upcoming sessions",false,"overview",null],
      [pending.length,"Tasks waiting for allocation",pending.length > 0 && !isDepartment(),"tasks",null],
      fourthCard
    ];
    el("summary-cards").innerHTML = cards.map(function (card) {
      return '<button type="button" class="summary-card summary-button' + (card[2] ? " alert" : "") + '" data-open-view="' + escapeHtml(card[3]) + '"' + (card[4] ? ' data-open-target="' + escapeHtml(card[4]) + '"' : '') + '><span class="label">' + escapeHtml(card[1]) + '</span><span class="value">' + card[0] + "</span></button>";
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
      var planSession = findPlanSession(session.id) || {};
      var namedMembers = planSession.department_members || [];
      var assignedCount = allocations.reduce(function (sum, a) { return sum + Number(a.headcount || 0); }, 0) + namedMembers.length;
      var actions = "";
      if (isDepartment() && session.department_id === currentDepartmentId() && ["published","in_progress"].indexOf(session.status) >= 0) {
        actions = '<label>Updated by<input class="session-actor" list="department-member-options" data-lookup="department-member" placeholder="Search department member"></label><div class="card-actions">' + (session.status === "published" ? '<button class="button secondary session-status" data-id="' + session.id + '" data-status="in_progress">Start session</button>' : '') + '<button class="button primary session-status" data-id="' + session.id + '" data-status="completed">Complete session</button></div>';
      }
      return '<article class="data-card"><div class="card-top"><div><h3>' + escapeHtml(department ? department.name : "Department") + '</h3><p>' + escapeHtml(formatDate(session.work_date)) + " · " + escapeHtml(slot ? slot.name : "Session") + '</p></div>' + statusPill(session.status) + '</div><div class="card-meta"><span>' + assignedCount + " / " + session.allocated_headcount + ' assigned</span></div>' + (labels ? '<p><strong>Groups:</strong> ' + escapeHtml(labels) + "</p>" : '') + (namedMembers.length ? '<p><strong>Department members:</strong> ' + namedMembers.map(function (person) { return escapeHtml(person.full_name); }).join(", ") + '</p>' : '') + (!labels && !namedMembers.length ? '<p class="muted">Student Leadership has not published manpower details yet.</p>' : '') + actions + "</article>";
    }).join("") : "No sessions published yet.";
  }

  function renderNotifications() {
    var items = state.data.notifications || [];
    var unread = items.filter(function (n) { return !n.read; }).length;
    el("notification-count").textContent = String(unread);
    el("notification-list").classList.toggle("empty-state", !items.length);
    el("notification-list").innerHTML = items.length ? items.slice(0, 10).map(function (notice) {
      var target = notice.link_type === "report" ? "reports" : notice.link_type === "gate_pass" ? "student-services" : "tasks";
      var openTarget = notice.link_type === "gate_pass" ? ' data-open-target="passes:ALL"' : "";
      return '<article class="data-card notification-card ' + (notice.read ? "read" : "") + '" data-open-view="' + target + '"' + openTarget + '><div class="card-top"><div><h3>' + escapeHtml(notice.title) + '</h3><p>' + escapeHtml(notice.message) + '</p></div>' + (!notice.read ? '<button class="button quiet mark-read" data-id="' + notice.id + '">Mark read</button>' : '') + '</div><div class="card-meta"><span>' + escapeHtml(formatDate(notice.created_at)) + "</span></div></article>";
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

  function renderDutyRoster() {
    var planning = state.planning || {}, current = planning.current_duty || {}, duties = planning.duties || [];
    el("overview-prefect-duty").textContent = current.prefect_on_duty || "Not entered";
    el("overview-senior-duty").textContent = current.senior_prefect_on_duty || "Not entered";
    el("duty-current-summary").textContent = current.prefect_on_duty
      ? current.prefect_on_duty + " / " + current.senior_prefect_on_duty
      : "Not entered";
    el("duty-roster-list").classList.toggle("empty-state", !duties.length);
    el("duty-roster-list").innerHTML = duties.length ? duties.map(function (duty) {
      return '<button type="button" class="compact-row duty-edit" data-week="' + escapeHtml(duty.week_start) + '"><span><strong>' + escapeHtml(formatDate(duty.week_start)) + '</strong><small>Prefect: ' + escapeHtml(duty.prefect_on_duty) + ' · Senior: ' + escapeHtml(duty.senior_prefect_on_duty) + '</small></span><span class="button quiet">Edit</span></button>';
    }).join("") : "No duty weeks entered yet.";
  }

  function dutyWeek(weekStart) {
    return (state.duties.weeks || []).find(function (item) { return item.week_start === weekStart; }) || {};
  }

  function dutyPersonById(studentId) {
    return lookupPool("student").find(function (person) { return String(person.id || person.student_id) === String(studentId || ""); }) || null;
  }

  function dutyGender(person) {
    var gender = String(person && person.gender || "").trim().toLowerCase();
    return gender === "male" || gender === "female" ? gender : "";
  }

  function dutyGenderCounts(type) {
    return (state.serviceDutyDraft[type + "_people"] || []).reduce(function (counts, person) {
      var gender = dutyGender(person);
      counts.total += 1;
      if (gender) counts[gender] += 1;
      return counts;
    }, { total: 0, male: 0, female: 0 });
  }

  function validateDutyLimit(type) {
    var counts = dutyGenderCounts(type);
    if (counts.total > 4 || counts.male > 2 || counts.female > 2 || counts.male + counts.female !== counts.total) {
      throw new Error(titleCase(type) + " duty can contain up to 2 men and 2 women.");
    }
  }

  function renderDutyPeople(type) {
    var key = type + "_people";
    var rows = state.serviceDutyDraft[key] || [];
    var target = el("service-duty-" + type + "-list");
    target.classList.toggle("empty-state", !rows.length);
    target.innerHTML = rows.length ? rows.map(function (person) {
      var gender = dutyGender(person);
      return '<div class="duty-person-row" data-student="' + escapeHtml(person.student_id) + '"><span><strong>' + escapeHtml(person.full_name) + '</strong><small>' + escapeHtml(gender ? titleCase(gender) : "Gender not recorded") + ' · ' + (person.assignment_source === "kitchen_rotation" ? "Copied from last week’s kitchen duty" : "Selected exact student record") + '</small></span><button class="button quiet remove-duty-person" data-duty-type="' + type + '" type="button">Remove</button></div>';
    }).join("") : "No students added.";
    var counts = dutyGenderCounts(type);
    el("service-duty-" + type + "-count").textContent = counts.total + " of 4 students · " + counts.male + " men · " + counts.female + " women";
  }

  function populateServiceDutyForm(weekStart, preserveDirty) {
    var normalized = mondayFor(weekStart || today());
    if (preserveDirty && state.serviceDutyDraft.dirty && state.serviceDutyDraft.week_start === normalized) {
      el("service-duty-week").value = normalized;
      renderDutyPeople("kitchen");
      renderDutyPeople("toilet");
      return;
    }
    var week = dutyWeek(normalized);
    el("service-duty-week").value = normalized;
    el("service-duty-bell").value = week.bell_ringer || "";
    state.serviceDutyDraft = {
      week_start: normalized,
      kitchen_people: (week.kitchen_people || []).map(function (person) {
        return Object.assign({}, dutyPersonById(person.student_id) || {}, person);
      }),
      toilet_people: (week.toilet_people || []).map(function (person) {
        return Object.assign({}, dutyPersonById(person.student_id) || {}, person);
      }),
      dirty: false
    };
    renderDutyPeople("kitchen");
    renderDutyPeople("toilet");
    var rotated = state.serviceDutyDraft.toilet_people.filter(function (person) { return person.assignment_source === "kitchen_rotation"; }).length;
    el("service-duty-rotation-note").textContent = rotated
      ? rotated + " student" + (rotated === 1 ? " was" : "s were") + " copied automatically from the previous week’s kitchen duty."
      : "Kitchen duty from the previous week will appear here automatically.";
  }

  function renderServiceDutyWeeks() {
    var weeks = (state.duties.weeks || []).filter(function (week) {
      return week.bell_ringer || (week.kitchen_people || []).length || (week.toilet_people || []).length;
    });
    el("service-duty-weeks").classList.toggle("empty-state", !weeks.length);
    el("service-duty-weeks").innerHTML = weeks.length ? weeks.map(function (week) {
      var kitchen = (week.kitchen_people || []).map(function (person) { return person.full_name; }).join(", ") || "Not entered";
      var toilet = (week.toilet_people || []).map(function (person) { return person.full_name; }).join(", ") || "Not entered";
      return '<button type="button" class="compact-row service-duty-edit" data-week="' + escapeHtml(week.week_start) + '"><span><strong>' + escapeHtml(formatDate(week.week_start)) + ' to ' + escapeHtml(formatDate(addDays(week.week_start, 6))) + '</strong><small class="duty-week-detail">Bell: ' + escapeHtml(week.bell_ringer || "Not entered") + '<br>Kitchen: ' + escapeHtml(kitchen) + '<br>Toilet: ' + escapeHtml(toilet) + '</small></span><span class="button quiet">Edit</span></button>';
    }).join("") : "No bell, kitchen or toilet duty weeks entered yet.";
  }

  function gateRowsForDate(dutyDate) {
    return (state.duties.gate_assignments || []).filter(function (row) { return row.duty_date === dutyDate; });
  }

  function gateStudentName(rows, slotCode) {
    var row = rows.find(function (item) { return item.slot_code === slotCode; });
    return row ? row.student_name : "";
  }

  function populateGateDutyForm(dutyDate) {
    var selectedDate = dutyDate || today();
    var rows = gateRowsForDate(selectedDate);
    el("gate-duty-date").value = selectedDate;
    el("gate-duty-2200").value = gateStudentName(rows, "22_00");
    el("gate-duty-0000").value = gateStudentName(rows, "00_02");
    el("gate-duty-0200").value = gateStudentName(rows, "02_04");
  }

  function renderGateDutyDays() {
    var dates = [];
    (state.duties.gate_assignments || []).forEach(function (row) {
      if (dates.indexOf(row.duty_date) < 0) dates.push(row.duty_date);
    });
    dates.sort();
    el("gate-duty-days").classList.toggle("empty-state", !dates.length);
    el("gate-duty-days").innerHTML = dates.length ? dates.map(function (date) {
      var rows = gateRowsForDate(date);
      return '<button type="button" class="compact-row gate-duty-edit" data-date="' + escapeHtml(date) + '"><span><strong>' + escapeHtml(formatDate(date)) + '</strong><small class="gate-slot-stack"><span>10 pm: ' + escapeHtml(gateStudentName(rows, "22_00") || "Not entered") + '</span><span>12 am: ' + escapeHtml(gateStudentName(rows, "00_02") || "Not entered") + '</span><span>2 am: ' + escapeHtml(gateStudentName(rows, "02_04") || "Not entered") + '</span></small></span><span class="button quiet">Edit</span></button>';
    }).join("") : "No gate-duty days entered yet.";
  }

  function renderDutiesWorkspace() {
    if (!hasDutiesWorkspace()) return;
    if (isLeadership()) {
      populateServiceDutyForm(state.serviceDutyDraft.week_start || state.duties.current_week || mondayFor(today()), true);
      renderServiceDutyWeeks();
    }
    var actorScope = isLeadership() ? "leadership" : "department-member";
    el("gate-duty-actor").dataset.lookup = actorScope;
    clearLookupSelection(el("gate-duty-actor"));
    ensureStudentLookup(el("gate-duty-actor"));
    if (isLeadership() || isSecurityWorkspace()) {
      populateGateDutyForm(value("gate-duty-date") || today());
      renderGateDutyDays();
    }
  }

  function renderReportsAttention() {
    var reports = (state.data.reports || []).filter(function (report) {
      return ["submitted","verified","returned"].indexOf(report.status) >= 0;
    });
    el("overview-report-count").textContent = String(reports.length);
    el("overview-report-list").classList.toggle("empty-state", !reports.length);
    el("overview-report-list").innerHTML = reports.length ? reports.slice(0, 5).map(function (report) {
      return '<article class="data-card"><div class="card-top"><div><h3>' + escapeHtml(departmentPath(report.department_id)) + '</h3><p>' + escapeHtml(titleCase(report.report_type)) + ' · ' + escapeHtml(formatDate(report.period_end)) + '</p></div>' + statusPill(report.status) + '</div></article>';
    }).join("") : "No reports need attention.";
  }

  function departmentGroupCounts(departmentId) {
    var result = {};
    (state.groups.groups || []).forEach(function (group) { result[group.code] = 0; });
    (state.planning.department_group_counts || []).filter(function (item) {
      return item.department_id === departmentId;
    }).forEach(function (item) { result[item.group_code] = Number(item.member_count || 0); });
    return result;
  }

  function renderDepartmentMemberSummary() {
    if (!isDepartment()) return;
    var members = departmentMembers(currentDepartmentId());
    var total = members.length;
    var details = members.map(function (person) { return person.full_name; }).join(", ");
    el("department-member-summary").innerHTML = total
      ? '<strong>' + total + ' named department member' + (total === 1 ? "" : "s") + ' included automatically.</strong> ' + escapeHtml(details) + '.'
      : '<strong>No department members are configured yet.</strong> Open Department members to add the exact students.';
  }

  function loadRosterEditor(departmentId) {
    state.editingRosterDepartmentId = departmentId || null;
    state.editingRoster = departmentMembers(departmentId).map(function (person) {
      return { student_id: person.student_id, full_name: person.full_name, member_role: person.member_role === "hod" ? "hod" : "member" };
    });
    refreshLookupLists();
    renderMemberEditor();
  }

  function renderMemberEditor() {
    var box = el("department-member-editor");
    if (!box) return;
    var rows = state.editingRoster || [];
    box.classList.toggle("empty-state", !rows.length);
    box.innerHTML = rows.length ? rows.map(function (person) {
      return '<div class="member-editor-row" data-student="' + escapeHtml(person.student_id) + '"><span><strong>' + escapeHtml(person.full_name) + '</strong><small>' + (person.member_role === "hod" ? "HOD" : "Department member") + '</small></span><select class="member-editor-role" aria-label="Role for ' + escapeHtml(person.full_name) + '"><option value="member"' + (person.member_role === "member" ? " selected" : "") + '>Member</option><option value="hod"' + (person.member_role === "hod" ? " selected" : "") + '>HOD</option></select><button class="button quiet remove-department-member" type="button">Remove</button></div>';
    }).join("") : "No members listed. Use the lookup above to add the first person.";
  }

  function renderMembersWorkspace() {
    var departmentId = selectedMembersDepartmentId();
    if (!departmentId && !isDepartment()) {
      var departments = (state.data.departments || []).filter(function (department) { return department.active !== false && department.workspace_enabled !== false; });
      if (departments.length) {
        el("members-department").value = departments[0].id;
        departmentId = departments[0].id;
      }
    }
    if (state.editingRosterDepartmentId !== departmentId) loadRosterEditor(departmentId);
    else {
      refreshLookupLists();
      renderMemberEditor();
    }
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
      var metadata = task.metadata && typeof task.metadata === "object" ? task.metadata : {};
      var displayType = isConference() ? "emergency" : task.task_type;
      var displayPriority = isConference() ? "critical" : task.priority;
      var peopleText = metadata.simple_request
        ? Number(metadata.department_member_count || 0) + " named department + " + Number(metadata.extra_people_requested || 0) + " extra = " + Number(task.requested_people || 0)
        : String(task.requested_people || 0);
      var memberNames = Array.isArray(metadata.department_members) ? metadata.department_members.map(function (person) { return person.full_name; }).filter(Boolean) : [];
      return '<article class="data-card ' + (task.status === "blocked" || isConference() ? "alert" : "") + '"><div class="card-top"><div><h3>' + escapeHtml(task.title) + '</h3><p>' + escapeHtml(department ? department.name : "") + " · " + escapeHtml(titleCase(displayType)) + " · " + escapeHtml(titleCase(task.cadence)) + '</p></div>' + statusPill(task.status) + '</div>' + (task.description ? '<p>' + escapeHtml(task.description) + "</p>" : "") + (metadata.work_location ? '<p><strong>Location:</strong> ' + escapeHtml(metadata.work_location) + '</p>' : '') + (memberNames.length ? '<p><strong>Department members:</strong> ' + memberNames.map(escapeHtml).join(", ") + '</p>' : '') + (metadata.crucial_reason ? '<p class="priority-reason"><strong>Why crucial:</strong> ' + escapeHtml(metadata.crucial_reason) + '</p>' : '') + '<div class="card-meta"><span>Priority: ' + escapeHtml(titleCase(displayPriority)) + '</span><span>Working day: ' + escapeHtml(formatDate(task.due_date)) + '</span><span>People: ' + escapeHtml(peopleText) + '</span><span>Owner: ' + escapeHtml(task.owner_name || "Not assigned") + '</span></div></article>';
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
    var groups = state.groups.groups || [];
    var slots = isConference() ? [] : (state.data.time_slots || []).filter(function (slot) {
      return !state.groups.holiday_mode || ["morning","afternoon"].indexOf(slot.code) >= 0;
    });
    el("group-capacity-cards").innerHTML = groups.map(function (group) {
      return '<article class="summary-card"><div class="label">' + escapeHtml(group.label) + '</div><div class="value">' + Number(group.total || 0) + '</div><small>total available pool</small></article>';
    }).join("");
    el("pending-task-count").textContent = String(requests.length);
    el("planner-board").classList.toggle("empty-state", !requests.length);
    el("planner-board").innerHTML = requests.length ? requests.map(function (request) {
      var department = departmentById(request.department_id);
      var task = (request.task_ids || []).map(taskById).filter(Boolean)[0];
      var metadata = task && task.metadata && typeof task.metadata === "object" ? task.metadata : {};
      var namedMembers = Array.isArray(metadata.department_members) ? metadata.department_members : [];
      var memberCount = Number(metadata.department_member_count || namedMembers.length || 0);
      var extraNeeded = Math.max(0, Number(request.requested_headcount || 0) - memberCount);
      var slotOptions = '<option value="">Choose session</option>' + slots.map(function (slot) {
        return '<option value="' + escapeHtml(slot.id) + '" data-code="' + escapeHtml(slot.code) + '">' + escapeHtml(slot.name) + '</option>';
      }).join("");
      var groupInputs = groups.map(function (group) {
        return '<label>' + escapeHtml(group.label) + '<input class="planner-group" data-group="' + escapeHtml(group.code) + '" type="number" min="0" max="' + Number(group.total || 0) + '" value="0"><small class="group-remaining" data-group-remaining="' + escapeHtml(group.code) + '">' + Number(group.total || 0) + ' available before this plan</small></label>';
      }).join("");
      var location = metadata.work_location ? '<p class="task-location"><strong>Location:</strong> ' + escapeHtml(metadata.work_location) + '</p>' : '';
      var memberLine = namedMembers.length ? '<p class="named-members"><strong>Department members:</strong> ' + namedMembers.map(function (person) { return escapeHtml(person.full_name); }).join(", ") + '</p>' : '<p class="muted">No named department members were included when this task was submitted.</p>';
      return '<article class="planner-card ' + (request.request_kind === "unexpected" ? "warning" : "") + '" data-request="' + request.id + '" data-work-date="' + escapeHtml(request.work_date) + '" data-department="' + escapeHtml(request.department_id) + '" data-member-count="' + memberCount + '"><div class="card-top"><div><h3>' + escapeHtml(task ? task.title : department ? department.name : "Department task") + '</h3><p>' + escapeHtml(department ? department.name : "Department") + ' · ' + escapeHtml(formatDate(request.work_date)) + ' · ' + escapeHtml(titleCase(request.request_kind || "planned")) + '</p></div><span class="count-badge">' + request.requested_headcount + ' people</span></div>' + location + memberLine + (metadata.crucial_reason ? '<p class="priority-reason"><strong>Why crucial:</strong> ' + escapeHtml(metadata.crucial_reason) + '</p>' : '') + '<div class="card-actions planner-primary-actions"><button class="button primary planner-open-approve" type="button">Approve</button><button class="button danger planner-decline" type="button">Reject</button></div><div class="planner-approval-popover" hidden><div class="inline-plan-grid"><label>Work day<input class="planner-work-date" type="date" min="' + today() + '" max="' + addDays(today(), 120) + '" value="' + escapeHtml(request.work_date) + '" required></label><label>Session<select class="planner-slot" required>' + slotOptions + '</select></label><label>Approved total<input class="planner-allocation" type="number" min="' + memberCount + '" max="100" value="' + request.requested_headcount + '"></label></div><fieldset class="cohort-fieldset planner-cohorts"><legend>Allocate ' + extraNeeded + ' additional student' + (extraNeeded === 1 ? "" : "s") + '</legend>' + groupInputs + '</fieldset><label>Decision note<textarea class="planner-notes" rows="2" placeholder="Optional note for the department"></textarea></label><div class="allocation-check">Groups total <strong>0</strong> of <strong>' + extraNeeded + '</strong> additional students.</div><div class="card-actions"><button class="button primary planner-confirm" type="button">Publish task</button><button class="button quiet planner-cancel-approve" type="button">Cancel</button></div></div></article>';
    }).join("") : "No pending requests.";
    all(".planner-card", el("planner-board")).forEach(updatePlannerCardAvailability);
    renderVisualPlan();
  }

  function plannerSlots() {
    return isConference() ? [] : (state.data.time_slots || []).filter(function (slot) {
      return !state.groups.holiday_mode || ["morning","afternoon"].indexOf(slot.code) >= 0;
    });
  }

  function groupLabel(code) {
    var group = (state.groups.groups || []).find(function (item) { return item.code === code; });
    return group ? String(group.label || "").toLowerCase() : titleCase(code).toLowerCase();
  }

  function visualPlanCard(session) {
    var tasks = session.tasks || [];
    var taskTitle = tasks.map(function (task) { return task.title; }).join(" / ") || "Department task";
    var locations = tasks.map(function (task) { return task.location; }).filter(Boolean);
    var groups = (session.groups || []).filter(function (group) { return Number(group.headcount || 0) > 0; }).map(function (group) {
      return Number(group.headcount) + " " + groupLabel(group.group_code);
    });
    var members = (session.department_members || []).map(function (person) { return person.full_name; });
    var manpower = groups.concat(members.length ? [members.length + " named department member" + (members.length === 1 ? "" : "s")] : []);
    return '<article class="visual-task-card" draggable="true" data-session-id="' + escapeHtml(session.id) + '" data-slot-id="' + escapeHtml(session.slot_id) + '" data-work-date="' + escapeHtml(session.work_date) + '"><div class="card-top"><div><h4>' + escapeHtml(taskTitle) + '</h4><p>' + escapeHtml(session.department_name + " · " + session.slot_name) + '</p></div><span class="drag-handle" title="Drag to move" aria-hidden="true">⋮⋮</span></div>' + (locations.length ? '<p class="task-location"><strong>Location:</strong> ' + locations.map(escapeHtml).join(", ") + '</p>' : '') + (groups.length ? '<p><strong>Groups:</strong> ' + groups.map(escapeHtml).join(", ") + '</p>' : '') + (members.length ? '<p><strong>Department members:</strong> ' + members.map(escapeHtml).join(", ") + '</p>' : '') + '<div class="card-meta"><span>' + escapeHtml(manpower.join(" · ") || String(session.allocated_headcount || 0) + " people") + '</span></div><button class="button quiet planner-move-button" type="button" data-session-id="' + escapeHtml(session.id) + '">Move</button></article>';
  }

  function renderVisualPlan() {
    var board = el("visual-plan-board");
    if (!board) return;
    var sessions = (state.planning.plan_sessions || []).filter(function (session) {
      return ["published","in_progress","draft"].indexOf(session.status) >= 0;
    });
    var daily = state.plannerView !== "weekly";
    var day = value("planner-day") || today();
    var week = mondayFor(value("planner-week") || day);
    el("planner-daily-button").classList.toggle("active", daily);
    el("planner-weekly-button").classList.toggle("active", !daily);
    el("planner-day-field").hidden = !daily;
    el("planner-week-field").hidden = daily;
    el("visual-plan-heading").textContent = daily ? "Daily plan · " + formatDate(day) : "Weekly plan · " + formatDate(week);
    el("visual-plan-help").textContent = daily ? "Drag a task to another session. Use Move on an iPad if dragging is inconvenient." : "Drag a task to another day. Its session stays the same unless you use Move.";
    var columns;
    if (daily) {
      columns = plannerSlots().map(function (slot) {
        return { key: slot.id, title: slot.name, date: day, slotId: slot.id, sessions: sessions.filter(function (session) { return session.work_date === day && session.slot_id === slot.id; }) };
      });
    } else {
      columns = Array.from({ length: 7 }).map(function (_, index) {
        var date = addDays(week,index);
        return { key: date, title: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][index] + " " + new Date(date + "T12:00:00").getDate(), date: date, slotId: "", sessions: sessions.filter(function (session) { return session.work_date === date; }) };
      });
    }
    var visibleCount = columns.reduce(function (total, column) { return total + column.sessions.length; },0);
    board.classList.toggle("empty-state", !columns.length);
    board.classList.toggle("weekly", !daily);
    board.innerHTML = columns.length ? columns.map(function (column) {
      return '<section class="plan-column drop-zone" data-drop-date="' + escapeHtml(column.date) + '" data-drop-slot="' + escapeHtml(column.slotId) + '"><header><strong>' + escapeHtml(column.title) + '</strong><span>' + column.sessions.length + '</span></header><div class="plan-column-cards">' + (column.sessions.length ? column.sessions.map(visualPlanCard).join("") : '<div class="drop-placeholder">Drop task here</div>') + '</div></section>';
    }).join("") : "No work sessions are available in Conference Mode.";
    board.classList.toggle("has-no-tasks", !visibleCount);
  }

  function findPlanSession(sessionId) {
    return (state.planning.plan_sessions || []).find(function (session) { return session.id === sessionId; });
  }

  function openPlannerMove(sessionId) {
    var session = findPlanSession(sessionId);
    if (!session) return;
    el("planner-move-session-id").value = session.id;
    el("planner-move-date").value = session.work_date;
    el("planner-move-date").min = today();
    el("planner-move-date").max = addDays(today(),120);
    fillSelect(el("planner-move-slot"),plannerSlots(),{ first:"Choose session" });
    el("planner-move-slot").value = session.slot_id;
    el("planner-move-modal").hidden = false;
  }

  async function movePlannedSession(sessionId,workDate,slotId,busyTarget) {
    var actor = requireLookup("planner-actor","leadership");
    setBusy(busyTarget,true,"Moving...");
    try {
      var result = await rpc("ops_move_planned_session",{
        p_session_token:state.session.session_token,p_session_id:sessionId,
        p_work_date:workDate,p_slot_id:slotId,p_actor_student_id:actor.student_id || actor.id
      });
      if (result.status !== "success") throw new Error(result.message || "The task could not be moved.");
      await loadData(false);
      toast("Task moved.");
    } finally { setBusy(busyTarget,false); }
  }

  function standingReserved(groupCode, workDate, slotCode, currentDepartmentId) {
    var day = new Date(workDate + "T12:00:00").getDay() || 7;
    return (state.planning.standing_rules || []).filter(function (rule) {
      return rule.active && rule.department_id !== currentDepartmentId
        && (rule.days_of_week || []).map(Number).indexOf(day) >= 0
        && (!(rule.slot_codes || []).length || (rule.slot_codes || []).indexOf(slotCode) >= 0);
    }).reduce(function (sum, rule) {
      return sum + Number(departmentGroupCounts(rule.department_id)[groupCode] || 0);
    }, 0);
  }

  function updatePlannerCardAvailability(card) {
    if (!card) return;
    var slotSelect = card.querySelector(".planner-slot");
    var selected = slotSelect && slotSelect.options[slotSelect.selectedIndex];
    var slotId = slotSelect ? slotSelect.value : "";
    var slotCode = selected && selected.dataset.code || "";
    var approved = Number(card.querySelector(".planner-allocation").value || 0);
    var memberCount = Number(card.dataset.memberCount || 0);
    var expectedExtra = Math.max(0, approved - memberCount);
    var request = (state.data.session_requests || []).find(function (item) { return item.id === card.dataset.request; }) || {};
    var task = (request.task_ids || []).map(taskById).filter(Boolean)[0] || {};
    var metadata = task.metadata && typeof task.metadata === "object" ? task.metadata : {};
    var memberGroups = metadata.department_member_groups || {};
    var sum = 0;
    all(".planner-group", card).forEach(function (input) {
      var group = (state.groups.groups || []).find(function (item) { return item.code === input.dataset.group; }) || {};
      var allocated = slotId ? (state.groups.allocations || []).filter(function (item) {
        return item.group_code === input.dataset.group && item.work_date === card.dataset.workDate && item.slot_id === slotId;
      }).reduce(function (total, item) { return total + Number(item.headcount || 0); }, 0) : 0;
      var reserved = slotCode ? standingReserved(input.dataset.group, card.dataset.workDate, slotCode, card.dataset.department) : 0;
      var remaining = Math.max(0, Number(group.total || 0) - allocated - reserved - Number(memberGroups[input.dataset.group] || 0));
      input.max = String(remaining);
      var note = card.querySelector('[data-group-remaining="' + input.dataset.group + '"]');
      if (note) note.textContent = slotId ? remaining + " remaining for this session" : Number(group.total || 0) + " in the available pool";
      sum += Number(input.value || 0);
    });
    var check = card.querySelector(".allocation-check");
    if (check) {
      check.classList.toggle("invalid", sum !== expectedExtra);
      check.innerHTML = 'Groups total <strong>' + sum + '</strong> of <strong>' + expectedExtra + '</strong> additional students. <strong>' + memberCount + '</strong> named department members are already included.';
    }
  }

  function renderStandingDepartments() {
    var rules = state.planning.standing_rules || [];
    var configured = {};
    (state.planning.department_group_counts || []).forEach(function (item) { configured[item.department_id] = true; });
    var ids = Object.keys(configured);
    rules.forEach(function (rule) { if (ids.indexOf(rule.department_id) < 0) ids.push(rule.department_id); });
    el("standing-department-list").classList.toggle("empty-state", !ids.length);
    el("standing-department-list").innerHTML = ids.length ? ids.map(function (id) {
      var department = departmentById(id), rule = rules.find(function (item) { return item.department_id === id; }) || {};
      var total = Object.keys(departmentGroupCounts(id)).reduce(function (sum, code) { return sum + Number(departmentGroupCounts(id)[code] || 0); }, 0);
      var schedule = rule.active ? ((rule.days_of_week || []).length === 7 ? "Every day" : (rule.days_of_week || []).length + " selected day(s)") + " · " + ((rule.slot_codes || []).length ? (rule.slot_codes || []).map(titleCase).join(", ") : "every session") : "Not always on";
      return '<button type="button" class="compact-row standing-edit" data-department="' + escapeHtml(id) + '"><span><strong>' + escapeHtml(department ? department.name : "Department") + '</strong><small>' + total + ' department members · ' + escapeHtml(schedule) + '</small></span><span class="button quiet">Edit</span></button>';
    }).join("") : "No department member counts have been entered yet.";
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
      if (["submitted"].indexOf(report.status) >= 0 && ["management","administrator"].indexOf(state.session.role) >= 0) actions.push('<button class="button secondary report-transition" data-id="' + report.id + '" data-status="verified">Verify</button>');
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
      "it-department": { eyebrow:"IT operations",title:"IT service desk, assets and secure access",description:"Manage technology work, devices, network issues and repairs, with secure links to the school asset register and password vault.",plan:"Plan IT maintenance and improvements",planTypeLabel:"IT work type",planTypePlaceholder:"Incident, maintenance, installation or improvement",planTitleLabel:"System or work item",planTitlePlaceholder:"Describe the IT work",stock:"Register device, part or supply",stockNameLabel:"Device, part or supply",stockCategoryLabel:"Asset category",stockCategoryPlaceholder:"Enter the category used by IT",stockUnitPlaceholder:"device, cable, licence, item",log:"Record incident or service work",logTypeLabel:"IT record type",logTypePlaceholder:"Incident, repair, setup, update or inspection",logTitleLabel:"System or issue",logTitlePlaceholder:"What was worked on?",quantityLabel:"Devices affected",nav:{tasks:"IT work queue",requests:"Support requests",tools:"IT tools and service"},externalTools:[{label:"Open AssetTiger",url:"https://www.assettiger.com/",description:"School asset register"},{label:"Open password vault",url:"https://vault.bitwarden.com/",description:"Bitwarden secure vault"}],workflow:[["Service desk","Record faults, fixes and follow-up work."],["Asset register","Open AssetTiger for the authoritative device and equipment record."],["Passwords and access","Open Bitwarden for shared credentials. Passwords are never stored in this site."]]},
      "husbandry": { eyebrow:"Animal husbandry",title:"Animal care and production",description:"Plan animal care, manage feed and supplies, and record health, production and losses.",plan:"Plan animal care",planTypeLabel:"Care plan type",planTypePlaceholder:"Routine, health, breeding or facility work",planTitleLabel:"Animal group or work",planTitlePlaceholder:"Describe the care plan",stock:"Add feed or husbandry supply",stockNameLabel:"Feed, medicine or supply",stockCategoryLabel:"Supply category",stockCategoryPlaceholder:"Enter the husbandry category",stockUnitPlaceholder:"kg, bag, bottle, item",log:"Record animal care or production",logTypeLabel:"Husbandry record type",logTypePlaceholder:"Feeding, health, breeding, production or loss",logTitleLabel:"Animal group or event",quantityLabel:"Animals or output",nav:{tasks:"Animal care work",tools:"Animal care and feed"},workflow:[["Daily animal care","Plan routine care and facility work."],["Feed and supplies","Track quantities received, used and remaining."],["Health and production","Record checks, treatment, output and losses."]]},
      "horticulture": { eyebrow:"Horticulture operations",title:"Open Field and Greenhouses",description:"One Horticulture workspace for crop planning, inputs, harvests and two separate reporting sections.",plan:"Plan crop work",planTypeLabel:"Crop plan type",planTypePlaceholder:"Planting, watering, crop care or harvest",planTitleLabel:"Crop, field or greenhouse",planTitlePlaceholder:"Describe the crop plan",stock:"Add seed, input or material",stockNameLabel:"Seed, input or material",stockCategoryLabel:"Input category",stockCategoryPlaceholder:"Enter the horticulture category",stockUnitPlaceholder:"kg, litre, tray, packet, item",log:"Record crop or harvest activity",logTypeLabel:"Crop record type",logTypePlaceholder:"Planting, watering, treatment, harvest or loss",logTitleLabel:"Crop and section",quantityLabel:"Area or output",nav:{tasks:"Crop work",requests:"Request field support","daily-report":"Section report","period-report":"Section summaries",tools:"Crops, inputs and harvests"},workflow:[["Open Field","Plan field work and submit its report separately."],["Greenhouses","Manage Greenhouses 1, 2 and 3 and submit one Greenhouses report."],["Inputs and harvests","Track seed, materials, treatments, output and losses."]]},
      "maintenance": { eyebrow:"Maintenance operations",title:"Faults, repairs and preventive work",description:"Run the maintenance job queue, manage parts and tools, and record repair history.",plan:"Plan maintenance jobs",planTypeLabel:"Maintenance type",planTypePlaceholder:"Fault, repair, inspection or preventive work",planTitleLabel:"Asset or location",planTitlePlaceholder:"What needs maintenance?",stock:"Add spare, material or tool",stockNameLabel:"Part, material or tool",stockCategoryLabel:"Maintenance category",stockCategoryPlaceholder:"Enter the maintenance category",stockUnitPlaceholder:"item, metre, litre, box",log:"Record job progress or equipment work",logTypeLabel:"Maintenance record type",logTypePlaceholder:"Inspection, repair, servicing or completion",logTitleLabel:"Asset, location or job",quantityLabel:"Items or hours",nav:{tasks:"Maintenance jobs",requests:"Request work crew",tools:"Repairs, spares and tools"},workflow:[["Fault queue","Turn faults into trackable repair jobs."],["Preventive work","Plan inspections and regular servicing."],["Spares and tools","Track parts, materials, equipment and usage."]]},
      "painting": { eyebrow:"Painting operations",title:"Painting jobs and materials",description:"Plan surfaces and rooms, manage paint and tools, and record preparation and completion.",plan:"Plan painting jobs",planTypeLabel:"Job type",planTypePlaceholder:"Preparation, painting, touch-up or restoration",planTitleLabel:"Area or item",planTitlePlaceholder:"What is being painted?",stock:"Add paint, material or tool",stockNameLabel:"Paint, material or tool",stockCategoryLabel:"Material category",stockCategoryPlaceholder:"Enter the painting category",stockUnitPlaceholder:"litre, tin, roll, item",log:"Record painting progress",logTypeLabel:"Painting record type",logTypePlaceholder:"Preparation, coat, completion, usage or issue",logTitleLabel:"Area or job",quantityLabel:"Area or material",nav:{tasks:"Painting jobs",tools:"Jobs, paint and tools"},workflow:[["Job preparation","Plan surfaces, colours and preparation work."],["Paint and materials","Track paint, consumables and tools."],["Progress records","Record coats, completed areas and issues."]]},
      "flowers-orchids": { eyebrow:"Flowers and Orchids operations",title:"Flowers, orchids and harvests",description:"One combined workspace for flower beds, orchid care, growing inputs, harvests, losses and distribution.",plan:"Plan flower and orchid work",planTypeLabel:"Cultivation plan type",planTypePlaceholder:"Planting, watering, orchid care or harvest",planTitleLabel:"Bed, orchid area, variety or work",stock:"Add seed, input or material",stockNameLabel:"Seed, input or material",stockCategoryLabel:"Growing category",stockCategoryPlaceholder:"Enter the Flowers and Orchids category",stockUnitPlaceholder:"packet, tray, litre, kg, item",log:"Record flower or orchid activity",logTypeLabel:"Cultivation record type",logTypePlaceholder:"Planting, orchid care, treatment, harvest, distribution or loss",logTitleLabel:"Bed, orchid area, variety or event",quantityLabel:"Stems, plants or output",nav:{tasks:"Flowers and Orchids work",tools:"Cultivation and harvests"},workflow:[["Flower beds","Plan planting, watering, care and harvest work."],["Orchid care","Track specialised orchid care and growing conditions."],["Harvest and inputs","Record materials, output, distribution and losses."]]},
      "poultry": { eyebrow:"Poultry operations",title:"Layers and Broilers",description:"One Poultry workspace for layer flocks, broiler batches, feed, health, egg production, growth and losses, with separate reporting sections.",plan:"Plan poultry work",planTypeLabel:"Flock plan type",planTypePlaceholder:"Layers, broilers, feeding, health, housing or production",planTitleLabel:"Flock, batch or work",stock:"Add feed or poultry supply",stockNameLabel:"Feed, medicine or supply",stockCategoryLabel:"Poultry category",stockCategoryPlaceholder:"Enter the poultry category",stockUnitPlaceholder:"kg, bag, bottle, tray, item",log:"Record flock or production activity",logTypeLabel:"Poultry record type",logTypePlaceholder:"Eggs, feed, growth, health, mortality or transfer",logTitleLabel:"Flock, batch or event",quantityLabel:"Birds or output",nav:{tasks:"Poultry work",requests:"Request flock support","daily-report":"Section report","period-report":"Section summaries",tools:"Flocks, feed and production"},workflow:[["Layers","Manage layer care, feed and egg production, then report under Layers."],["Broilers","Manage broiler batches, feed, growth and losses, then report under Broilers."],["Shared supplies","Track feed, medicines, equipment and movements for the whole Poultry department."]]},
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
    var focusedProfiles = {
      "offices": { eyebrow:"Office operations",title:"Office services, records and supplies",description:"Coordinate office support, document movement, service requests and shared supplies.",plan:"Plan office services",stock:"Add office supply or controlled item",log:"Record office service or document activity",nav:{tasks:"Office work",tools:"Services, records and supplies"},workflow:[["Office support","Plan reception, filing and administrative support."],["Document flow","Record documents received, routed and completed."],["Office supplies","Track stationery and shared controlled items."]]},
      "administrators-office": { eyebrow:"Administrator's Office",title:"Administrator's Office workflow",description:"Manage the Administrator's Office diary, follow-ups, records and controlled resources.",plan:"Plan Administrator's Office work",stock:"Add office resource",log:"Record decision, follow-up or completed action",nav:{tasks:"Office actions",tools:"Diary, actions and records"},workflow:[["Executive diary","Plan meetings, deadlines and required preparation."],["Action follow-up","Record instructions and completion status."],["Controlled records","Track files and office resources."]]},
      "motor-mechanics": { eyebrow:"Motor mechanics",title:"Vehicle repairs, servicing and workshop work",description:"Plan diagnostics and repairs, track workshop parts and record vehicle service history.",plan:"Plan workshop jobs",stock:"Add spare part, fluid or tool",log:"Record diagnosis, repair or service",nav:{tasks:"Workshop jobs",tools:"Vehicles, parts and repairs"},workflow:[["Vehicle queue","Plan diagnosis, servicing and repair jobs."],["Parts and tools","Track spares, fluids and workshop equipment."],["Service history","Record faults, work completed and roadworthiness checks."]]},
      "grounds": { eyebrow:"Grounds operations",title:"Campus grounds and outdoor areas",description:"Plan grounds care, manage outdoor tools and supplies, and record completed areas and issues.",plan:"Plan grounds work",stock:"Add grounds material or tool",log:"Record grounds activity",nav:{tasks:"Grounds work",tools:"Areas, tools and upkeep"},workflow:[["Area rounds","Plan sweeping, clearing and outdoor upkeep."],["Tools and materials","Track grounds equipment and consumables."],["Completed areas","Record work, hazards and follow-up."]]},
      "lawn-cutting": { eyebrow:"Lawn cutting",title:"Lawn schedule, machines and fuel",description:"Schedule lawn areas, track cutters, fuel and parts, and record completed work and faults.",plan:"Plan lawn cutting",stock:"Add fuel, part or machine item",log:"Record lawn work or machine use",nav:{tasks:"Lawn schedule",tools:"Areas, machines and fuel"},workflow:[["Cutting schedule","Plan each lawn area and frequency."],["Machine readiness","Track fuel, blades, parts and faults."],["Area completion","Record areas cut and work still open."]]},
      "security": { eyebrow:"Security operations",title:"Security posts, rounds and incidents",description:"Plan security coverage, track operational equipment and record rounds, handovers and incidents.",plan:"Plan security coverage",stock:"Add security equipment or supply",log:"Record round, handover or incident",nav:{tasks:"Security duties",tools:"Posts, rounds and equipment"},workflow:[["Post coverage","Plan security posts and relief."],["Rounds and handovers","Record patrols and shift information."],["Incident follow-up","Record operational incidents and required action."]]},
      "immigration": { eyebrow:"Immigration support",title:"Student immigration records and deadlines",description:"Plan permit work, track document requirements and record submissions and follow-ups without storing secrets.",plan:"Plan immigration case work",stock:"Add form or office resource",log:"Record submission or follow-up",nav:{tasks:"Immigration actions",tools:"Cases, deadlines and records"},workflow:[["Deadline calendar","Plan permit and document deadlines."],["Submission checklist","Track required non-confidential documents."],["Follow-up record","Record submissions, responses and next steps."]]},
      "chapel": { eyebrow:"Chapel operations",title:"Chapel programme and readiness",description:"Plan chapel services, spaces and support needs, then record attendance totals and operational issues.",plan:"Plan chapel programme",stock:"Add chapel supply or equipment",log:"Record service or chapel activity",nav:{tasks:"Chapel work",tools:"Programme, space and supplies"},workflow:[["Service programme","Plan services and preparation work."],["Space readiness","Track seating, equipment and supplies."],["Service record","Record totals, issues and follow-up."]]},
      "compassion-house": { eyebrow:"Compassion House",title:"Compassion House service and resources",description:"Plan support activities, track supplies and record service totals and practical follow-up.",plan:"Plan Compassion House work",stock:"Add support supply or equipment",log:"Record service activity",nav:{tasks:"Support work",tools:"Activities and supplies"},workflow:[["Support activities","Plan practical service work."],["Resource position","Track donated and operational supplies."],["Service record","Record activity totals and follow-up needs."]]},
      "international-student-representatives": { eyebrow:"International students",title:"International student representation",description:"Track non-confidential student concerns, meetings, support actions and institutional follow-up.",plan:"Plan representative work",stock:"Add office resource",log:"Record meeting or support action",nav:{tasks:"Representation actions",tools:"Meetings and follow-up"},workflow:[["Student concerns","Record themes without exposing private case details."],["Meetings","Plan representative meetings and agendas."],["Follow-up","Track agreed institutional actions."]]},
      "toilets": { eyebrow:"Sanitation operations",title:"Toilet areas, cleaning and supplies",description:"Schedule sanitation rounds, track cleaning materials and record completed areas, faults and restocking.",plan:"Plan sanitation rounds",stock:"Add cleaning material or equipment",log:"Record sanitation check or cleaning",nav:{tasks:"Sanitation work",tools:"Areas, checks and supplies"},workflow:[["Area schedule","Plan Hallelujah, Berea, Jubilee and Administration areas."],["Cleaning supplies","Track chemicals, paper and equipment."],["Checks and faults","Record completed rounds and maintenance needs."]]},
      "hosting": { eyebrow:"Hosting operations",title:"Guest hosting and service readiness",description:"Plan guest arrival and hosting requirements, track service items and record handovers and issues.",plan:"Plan hosting service",stock:"Add hosting supply or equipment",log:"Record guest service or handover",nav:{tasks:"Hosting work",tools:"Guests, service and supplies"},workflow:[["Arrival plan","Prepare guest arrival and hosting responsibilities."],["Service readiness","Track rooms, refreshments and required items."],["Handover","Record completed service and open issues."]]},
      "student-accommodation": { eyebrow:"Student accommodation",title:"Residence readiness and accommodation work",description:"Plan residence work, track room resources and record inspections, faults and operational follow-up.",plan:"Plan accommodation work",stock:"Add room or residence resource",log:"Record inspection, fault or handover",nav:{tasks:"Residence work",tools:"Rooms, inspections and resources"},workflow:[["Residence readiness","Plan room and common-area work."],["Room resources","Track accommodation equipment and supplies."],["Inspections","Record checks, faults and completion."]]},
      "prayer": { eyebrow:"Prayer operations",title:"Prayer programme and support",description:"Plan prayer activities, spaces and support needs and record participation totals and follow-up.",plan:"Plan prayer activity",stock:"Add prayer programme supply",log:"Record prayer activity",nav:{tasks:"Prayer programme",tools:"Activities and support"},workflow:[["Programme","Plan prayer times and preparation."],["Space and support","Track rooms and required items."],["Activity record","Record totals and operational follow-up."]]},
      "legacy-cafe": { eyebrow:"Legacy Cafe",title:"Cafe service, stock and sales activity",description:"Plan cafe service, manage food and beverage stock and record output, usage, wastage and issues.",plan:"Plan cafe service",stock:"Add cafe product or ingredient",log:"Record cafe service or stock activity",nav:{tasks:"Cafe work",tools:"Service, stock and records"},workflow:[["Service plan","Plan products and service periods."],["Stock position","Track products, ingredients and supplies."],["Usage and wastage","Record output, loss and service issues."]]},
      "protocol": { eyebrow:"Protocol operations",title:"Protocol, ceremonies and guest movement",description:"Plan ceremonial order, guest reception and movement, track protocol materials and record event delivery.",plan:"Plan protocol assignment",stock:"Add protocol item or equipment",log:"Record protocol event or handover",nav:{tasks:"Protocol assignments",tools:"Events, movement and materials"},workflow:[["Ceremonial plan","Set order, timing and responsibilities."],["Guest movement","Plan reception, escort and seating."],["Event record","Record delivery, handovers and issues."]]},
      "sports": { eyebrow:"Sports operations",title:"Sports programme, equipment and facilities",description:"Plan training and fixtures, track sports equipment and record participation, results and facility issues.",plan:"Plan sports activity",stock:"Add sports equipment or supply",log:"Record training, fixture or equipment use",nav:{tasks:"Sports work",tools:"Programme and equipment"},workflow:[["Programme","Plan training, fixtures and preparation."],["Equipment","Track balls, kits and facility items."],["Activity record","Record participation, results and issues."]]},
      "church-representative": { eyebrow:"Church representation",title:"Church liaison and follow-up",description:"Plan liaison activities, record non-confidential communication and track institutional follow-up.",plan:"Plan church liaison",stock:"Add liaison resource",log:"Record meeting or communication",nav:{tasks:"Liaison actions",tools:"Meetings and follow-up"},workflow:[["Liaison calendar","Plan meetings and church engagements."],["Communication record","Record key non-confidential outcomes."],["Action follow-up","Track institutional responses and completion."]]},
      "orchard": { eyebrow:"Orchard operations",title:"Trees, inputs and harvests",description:"Plan orchard care, track inputs and equipment and record treatment, harvests, losses and issues.",plan:"Plan orchard work",stock:"Add orchard input or tool",log:"Record tree care or harvest",nav:{tasks:"Orchard work",tools:"Trees, inputs and harvests"},workflow:[["Tree care","Plan pruning, watering and maintenance."],["Inputs","Track treatments, tools and materials."],["Harvest record","Record output, losses and distribution."]]},
      "generator": { eyebrow:"Generator operations",title:"Generator readiness, fuel and servicing",description:"Plan generator checks, track fuel and spares and record runtime, servicing, faults and handovers.",plan:"Plan generator work",stock:"Add fuel, spare or service item",log:"Record runtime, check or fault",nav:{tasks:"Generator work",tools:"Fuel, checks and servicing"},workflow:[["Readiness checks","Plan routine inspections and test runs."],["Fuel and spares","Track fuel, oil, filters and parts."],["Runtime history","Record hours, faults and servicing."]]},
      "logistics": { eyebrow:"Logistics operations",title:"Movements, deliveries and event support",description:"Plan deliveries and resource movement, track logistics equipment and record handovers and completion.",plan:"Plan logistics movement",stock:"Add logistics equipment or supply",log:"Record delivery, movement or handover",nav:{tasks:"Logistics queue",tools:"Movements and resources"},workflow:[["Movement plan","Schedule deliveries and resource movement."],["Resource readiness","Track trolleys, containers and supplies."],["Handover record","Record delivery, receipt and open issues."]]},
      "flags": { eyebrow:"Flags operations",title:"Flags, display schedule and condition",description:"Plan flag display, track each flag and fitting and record condition, placement and replacement needs.",plan:"Plan flag display",stock:"Add flag, fitting or supply",log:"Record placement or condition check",nav:{tasks:"Flag duties",tools:"Displays and condition"},workflow:[["Display schedule","Plan raising, lowering and event displays."],["Flag register","Track flags, poles and fittings."],["Condition checks","Record damage, cleaning and replacement."]]},
      "gongs": { eyebrow:"Gongs operations",title:"Gong schedule, locations and condition",description:"Plan gong duties, track instruments and fittings and record use, condition and repair needs.",plan:"Plan gong duty",stock:"Add gong, fitting or supply",log:"Record use or condition check",nav:{tasks:"Gong duties",tools:"Schedule and equipment"},workflow:[["Duty schedule","Plan times, locations and responsible members."],["Equipment","Track gongs and fittings."],["Condition record","Record use, damage and repair needs."]]}
    };
    return Object.assign({}, base, profiles[slug] || focusedProfiles[slug] || {});
  }

  function applyDepartmentNavigation() {
    var defaults = { overview:"Overview",tasks:"Tasks",members:"Department members",requests:"Sessions","daily-report":"Daily report","period-report":"Weekly / monthly",tools:"Department tools",transfers:"Transfers" };
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
    var serviceLink = tools.department_slug === "kitchen"
      ? '<button class="button primary" type="button" data-open-view="meal-service">Meal service</button>'
      : tools.department_slug === "clinic"
      ? '<button class="button primary" type="button" data-open-view="clinic-service">Clinic register</button>'
      : ["conference-centre", "student-accommodation"].indexOf(tools.department_slug) >= 0 && isAccommodationWorkspace()
      ? '<button class="button primary" type="button" data-open-view="accommodation-service">Accommodation assignments</button>'
      : "";
    var externalLinks = (profile.externalTools || []).filter(function (tool) { return /^https:\/\//i.test(tool.url || ""); }).map(function (tool) {
      return '<a class="button primary" href="' + escapeHtml(tool.url) + '" target="_blank" rel="noopener noreferrer" title="' + escapeHtml(tool.description || tool.label) + '">' + escapeHtml(tool.label) + '</a>';
    }).join("");
    el("tool-quick-links").innerHTML = externalLinks + serviceLink + '<a class="button secondary" href="#tool-plan-form">Planning</a><a class="button secondary" href="#tool-stock-item-form">Stock and usage</a><a class="button secondary" href="#tool-log-form">Activity records</a>';

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

  async function loadAccommodation() {
    if (!isAccommodationWorkspace()) {
      state.accommodation = null;
      return;
    }
    var result = await rpc("ops_accommodation_dashboard", {
      p_session_token: state.session.session_token
    });
    if (!result || result.status !== "success") {
      throw new Error(result && result.message || "Accommodation assignments could not be loaded.");
    }
    state.accommodation = result;
    var choices = (result.buildings || []).map(function (building) { return building.name; });
    if (state.accommodationBuilding !== "__unassigned__" && choices.indexOf(state.accommodationBuilding) < 0) {
      state.accommodationBuilding = choices[0] || "__unassigned__";
    }
  }

  function accommodationStudents() {
    return state.accommodation && Array.isArray(state.accommodation.students) ? state.accommodation.students : [];
  }

  function accommodationBuildings() {
    return state.accommodation && Array.isArray(state.accommodation.buildings) ? state.accommodation.buildings : [];
  }

  function accommodationStudentById(studentId) {
    return accommodationStudents().find(function (student) {
      return String(student.student_id) === String(studentId);
    }) || null;
  }

  function accommodationSelectedStudents() {
    var selected = state.accommodationBuilding || "__unassigned__";
    return accommodationStudents().filter(function (student) {
      return selected === "__unassigned__" ? !student.is_allocated : student.residence === selected;
    });
  }

  function renderAccommodation() {
    if (!isAccommodationWorkspace() || !state.accommodation) return;

    var buildings = accommodationBuildings();
    var names = buildings.map(function (building) { return building.name; });
    if (state.accommodationBuilding !== "__unassigned__" && names.indexOf(state.accommodationBuilding) < 0) {
      state.accommodationBuilding = names[0] || "__unassigned__";
    }

    var assigned = accommodationStudents().filter(function (student) { return student.is_allocated; }).length;
    var unassigned = Number(state.accommodation.unassigned_count || 0);
    var selectedRows = accommodationSelectedStudents();
    var selectedLabel = state.accommodationBuilding === "__unassigned__" ? "Unassigned students" : state.accommodationBuilding;

    el("accommodation-summary").innerHTML = [
      [buildings.length, "Buildings"],
      [assigned, "Assigned students"],
      [unassigned, "Unassigned students"],
      [selectedRows.length, "In selected view"]
    ].map(function (item) {
      return '<article class="summary-card"><div class="label">' + escapeHtml(item[1]) + '</div><div class="value">' + escapeHtml(item[0]) + '</div></article>';
    }).join("");

    var buildingButtons = buildings.map(function (building) {
      var active = state.accommodationBuilding === building.name;
      var detail = building.room_count + (Number(building.room_count) === 1 ? " room" : " rooms");
      return '<button type="button" role="tab" aria-selected="' + (active ? "true" : "false") + '" class="accommodation-building-choice' + (active ? " active" : "") + '" data-accommodation-building="' + escapeHtml(building.name) + '"><strong>' + escapeHtml(building.name) + '</strong><span>' + escapeHtml(building.student_count) + ' students · ' + escapeHtml(detail) + '</span></button>';
    });
    buildingButtons.push('<button type="button" role="tab" aria-selected="' + (state.accommodationBuilding === "__unassigned__" ? "true" : "false") + '" class="accommodation-building-choice unassigned' + (state.accommodationBuilding === "__unassigned__" ? " active" : "") + '" data-accommodation-building="__unassigned__"><strong>Unassigned</strong><span>' + escapeHtml(unassigned) + ' students</span></button>');
    el("accommodation-building-tabs").innerHTML = buildingButtons.join("");

    el("accommodation-selected-building").textContent = selectedLabel;
    el("accommodation-selected-count").textContent = String(selectedRows.length);
    el("accommodation-selected-detail").textContent = state.accommodationBuilding === "__unassigned__"
      ? "Active students who do not currently have an accommodation assignment."
      : "Only students assigned to " + state.accommodationBuilding + " are shown.";

    var query = value("accommodation-search").toLowerCase();
    var rows = selectedRows.filter(function (student) {
      return !query || [student.student_name, student.room, student.bed, student.allocation_status]
        .join(" ").toLowerCase().indexOf(query) >= 0;
    }).sort(function (left, right) {
      var byRoom = String(left.room || "").localeCompare(String(right.room || ""), undefined, { numeric: true, sensitivity: "base" });
      return byRoom || String(left.student_name || "").localeCompare(String(right.student_name || ""));
    });

    el("accommodation-rows").innerHTML = rows.length ? rows.map(function (student) {
      return '<tr><td><span class="service-person"><strong>' + escapeHtml(student.student_name) + '</strong><small>' + escapeHtml(student.gender || "Student") + '</small></span></td><td>' + escapeHtml(student.room || "—") + '</td><td>' + escapeHtml(student.bed || "—") + '</td><td>' + statusPill(student.allocation_status || "unassigned") + '</td><td>' + escapeHtml(student.updated_at ? formatDateTime(student.updated_at) : "Not assigned") + '</td><td><button class="button quiet accommodation-edit-student" type="button" data-student-id="' + escapeHtml(student.student_id) + '">' + (student.is_allocated ? "Edit" : "Assign") + '</button></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty-state">No students match this building view.</td></tr>';

    el("accommodation-building-options").innerHTML = names.map(function (name) {
      return '<option value="' + escapeHtml(name) + '"></option>';
    }).join("");
  }

  function toggleAccommodationEditFields() {
    var remove = el("accommodation-remove").checked;
    ["accommodation-edit-building", "accommodation-edit-status", "accommodation-edit-room", "accommodation-edit-bed"].forEach(function (id) {
      el(id).disabled = remove;
    });
    el("accommodation-edit-building").required = !remove;
  }

  function openAccommodationEdit(studentId) {
    var student = accommodationStudentById(studentId);
    if (!student) return toast("Student record not found. Refresh and try again.", true);
    state.accommodationEdit = Object.assign({}, student);
    var current = student.is_allocated
      ? [student.residence, student.room, student.bed].filter(Boolean).join(" · ") + " · " + titleCase(student.allocation_status)
      : "No current accommodation assignment";
    el("accommodation-student-summary").innerHTML = '<strong>' + escapeHtml(student.student_name) + '</strong><br><span class="service-secondary">' + escapeHtml(current) + '</span>';
    el("accommodation-edit-building").value = student.residence || (state.accommodationBuilding === "__unassigned__" ? "" : state.accommodationBuilding || "");
    el("accommodation-edit-room").value = student.room || "";
    el("accommodation-edit-bed").value = student.bed || "";
    el("accommodation-edit-status").value = ["waiting", "allocated", "checked_in", "checked_out"].indexOf(student.allocation_status) >= 0 ? student.allocation_status : "allocated";
    el("accommodation-remove").checked = false;
    el("accommodation-remove").disabled = !student.is_allocated;
    el("accommodation-remove-field").hidden = !student.is_allocated;
    toggleAccommodationEditFields();
    el("accommodation-modal").hidden = false;
    setTimeout(function () { el("accommodation-edit-building").focus(); }, 50);
  }

  function closeAccommodationEdit() {
    state.accommodationEdit = null;
    el("accommodation-modal").hidden = true;
  }

  async function saveAccommodationEdit(form) {
    var student = state.accommodationEdit;
    if (!student) throw new Error("Choose an exact student record first.");
    var remove = el("accommodation-remove").checked;
    var building = value("accommodation-edit-building");
    if (!remove && !building) throw new Error("Choose or enter a building.");
    setBusy(form, true, "Saving...");
    try {
      var result = await rpc("ops_update_student_accommodation", {
        p_session_token: state.session.session_token,
        p_student_id: String(student.student_id),
        p_residence: building || null,
        p_room: value("accommodation-edit-room") || null,
        p_bed: value("accommodation-edit-bed") || null,
        p_allocation_status: value("accommodation-edit-status"),
        p_remove: remove
      });
      if (!result || result.status !== "success") throw new Error(result && result.message || "Accommodation was not saved.");
      state.accommodationBuilding = remove ? "__unassigned__" : building;
      closeAccommodationEdit();
      await loadAccommodation();
      renderAccommodation();
      el("accommodation-student").value = "";
      clearLookupSelection(el("accommodation-student"));
      toast(result.message || "Accommodation assignment saved.");
    } finally {
      setBusy(form, false);
    }
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
    if (!field || isConference() || !el("view-meal-service").classList.contains("active")) return;
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
      box.innerHTML = '<strong>Collection recorded</strong><span>' + escapeHtml(name + " · " + result.meal_session) + "</span>";
      stateBox.className = "status-pill green";
      stateBox.textContent = "Saved";
      if (navigator.vibrate) navigator.vibrate(80);
    } else if (result.status === "duplicate") {
      box.className = "scan-result warning";
      box.innerHTML = '<strong>Already collected</strong><span>' + escapeHtml(name + " · " + (result.meal_session || value("kitchen-meal"))) + "</span>";
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
    if (isConference()) {
      renderKitchenResult({ status:"conference_disabled", message:"Meal collection is unavailable while Conference Mode is on." }, "");
      return;
    }
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
    var responses = await Promise.all([
      rpc("ops_kitchen_service", { p_session_token: state.session.session_token, p_action: "dashboard", p_payload: { service_date: today() } }),
      rpc("ops_kitchen_meal_check_in_counts", { p_session_token: state.session.session_token, p_service_date: today() })
    ]);
    var result = responses[0];
    var checkins = responses[1];
    if (result.status !== "success") throw new Error(result.message || "Kitchen totals could not be loaded.");
    if (checkins.status !== "success") throw new Error(checkins.message || "Meal check-in counts could not be loaded.");
    var meals = ["Breakfast","Lunch","Break-fast 4pm","Supper"];
    var checkinMeals = ["Breakfast","Lunch","Break-fast 4pm"];
    el("kitchen-checkin-counts").innerHTML = checkinMeals.map(function (meal) { return '<article class="summary-card"><div class="label">' + escapeHtml(meal) + ' check-ins</div><div class="value">' + Number((checkins.counts || {})[meal] || 0) + '</div></article>'; }).join("");
    el("kitchen-checkin-mode").className = "status-pill " + (checkins.check_in_enabled ? "green" : "amber");
    el("kitchen-checkin-mode").textContent = checkins.conference_mode ? "Conference: not needed" : checkins.holiday_mode ? "Holiday: not needed" : "School Term";
    el("kitchen-counts").innerHTML = meals.map(function (meal) { return '<article class="summary-card"><div class="label">' + escapeHtml(meal) + ' portions</div><div class="value">' + Number((result.counts || {})[meal] || 0) + '</div></article>'; }).join("");
    var recent = result.recent || [];
    el("kitchen-recent").classList.toggle("empty-state", !recent.length);
    el("kitchen-recent").innerHTML = recent.length ? recent.map(function (checkin) {
      var childText = Number(checkin.child_portions || 0) > 0 ? " · " + Number(checkin.child_portions) + " child portion" + (Number(checkin.child_portions) === 1 ? "" : "s") : "";
      var roleText = checkin.recipient_role === "additional" ? " · Additional student" : "";
      return '<article class="data-card"><div class="card-top"><div><h3>' + escapeHtml(checkin.full_name) + '</h3><p>' + escapeHtml(checkin.registration_number + " · " + checkin.meal_session + roleText + childText) + '</p></div><span class="status-pill green">' + escapeHtml(formatDateTime(checkin.checked_in_at)) + '</span></div></article>';
    }).join("") : "No collections recorded yet.";
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

  function serviceStudentRecord(person) {
    return serviceStudentByRegistration(person && person.registration_number) || person || {};
  }

  function serviceGenderMatches(person, filter) {
    if (!filter || filter === "ALL") return true;
    return String(serviceStudentRecord(person).gender || "").toUpperCase() === String(filter).toUpperCase();
  }

  function serviceCampusStatusMatches(person, filter) {
    if (!filter || filter === "ALL") return true;
    return String(serviceStudentRecord(person).status || "UNKNOWN").toUpperCase() === String(filter).toUpperCase();
  }

  function servicePersonMatches(person, gender, year, campusStatus) {
    var record = serviceStudentRecord(person);
    return serviceGenderMatches(record, gender) && serviceYearMatches(record.registration_number, year) && serviceCampusStatusMatches(record, campusStatus);
  }

  async function loadStudentServices() {
    if (!state.session || isDepartment()) return;
    var bridge = studentBridgePin();
    var result;
    if (state.session.role === "administrator") {
      result = await rpc("admin_services_dashboard_v3", {
        p_pin: bridge,
        p_term_id: state.studentTermId ? Number(state.studentTermId) : null
      });
    } else {
      result = await rpc("student_services_dashboard_v4", { p_pin: bridge });
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
    var data = state.studentServices || {}, q = value("ss-campus-search").toLowerCase(), filter = value("ss-campus-filter"), gender = value("ss-campus-gender"), year = value("ss-campus-year");
    var rows = (data.students || []).filter(function (student) {
      var statusMatch = filter === "ALL" || filter === student.status || filter === "BED_REST" && student.bed_rest;
      return statusMatch && servicePersonMatches(student, gender, year, "ALL") && (student.student_name + " " + student.registration_number).toLowerCase().indexOf(q) >= 0;
    });
    el("ss-campus-rows").innerHTML = rows.length ? rows.map(function (student) {
      var health = [];
      if (student.bed_rest) health.push('<span class="service-pill bed-rest">Allowed bed rest</span>');
      if (state.session.role === "administrator" && student.maternity) health.push('<span class="service-pill bed-rest">Maternity</span>');
      return '<tr><td>' + serviceStudentName(student) + '</td><td>' + escapeHtml(student.registration_number) + '</td><td><span class="service-pill ' + escapeHtml(student.status) + '">' + escapeHtml(student.status === "IN" ? "On campus" : student.status === "OUT" ? "Off campus" : "Unknown") + '</span></td><td>' + (health.join(" ") || '<span class="service-secondary">None</span>') + '</td><td>' + escapeHtml(formatDateTime(student.last_movement_at)) + '</td><td><button class="button quiet ss-edit-student" data-registration="' + escapeHtml(student.registration_number) + '" type="button">Edit</button></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty-state">No matching students.</td></tr>';
  }

  function renderStudentAccommodation() {
    var data = state.studentServices || {}, admin = state.session.role === "administrator", q = value("ss-accommodation-search").toLowerCase(), filter = value("ss-accommodation-filter"), gender = value("ss-accommodation-gender"), year = value("ss-accommodation-year"), campus = value("ss-accommodation-campus");
    var rows = (data.students || []).filter(function (student) {
      var statusMatch = filter === "ALL" || filter === "ALLOCATED" && student.residence || filter === "NOT_ALLOCATED" && !student.residence || filter === "BED_REST" && student.bed_rest;
      var hay = [student.student_name, student.registration_number, student.residence, student.room].join(" ").toLowerCase();
      return statusMatch && servicePersonMatches(student, gender, year, campus) && hay.indexOf(q) >= 0;
    });
    el("ss-accommodation-rows").innerHTML = rows.length ? rows.map(function (student) {
      var feeCell = admin ? '<td><span class="service-pill ' + (student.fees_paid === false ? "unpaid" : "paid") + '">' + (student.fees_paid === false ? "Not paid" : "Paid") + "</span></td>" : "";
      return '<tr><td>' + serviceStudentName(student) + '</td><td>' + escapeHtml(student.registration_number) + '</td><td>' + escapeHtml(student.residence || "Not allocated") + '</td><td>' + escapeHtml(student.room || "—") + '</td><td>' + escapeHtml(student.bed || "—") + '</td>' + feeCell + '<td>' + escapeHtml(titleCase(student.accommodation_status || "Not allocated")) + '</td><td><button class="button quiet ss-edit-student" data-registration="' + escapeHtml(student.registration_number) + '" type="button">Edit</button></td></tr>';
    }).join("") : '<tr><td colspan="8" class="empty-state">No matching accommodation records.</td></tr>';
  }

  function renderStudentPasses() {
    var data = state.studentServices || {}, q = value("ss-pass-search").toLowerCase(), filter = value("ss-pass-filter"), gender = value("ss-pass-gender"), year = value("ss-pass-year"), campus = value("ss-pass-campus");
    var archivedStatuses = ["rejected","cancelled"];
    var rows = (data.gate_passes || []).filter(function (pass) {
      var archived = archivedStatuses.indexOf(pass.status) >= 0;
      if (state.showPassArchive !== archived) return false;
      var statusMatch = filter === "ALL" || filter === "OVERDUE" && pass.overdue || pass.status === filter;
      var people = servicePassPeople(pass);
      var personMatch = people.some(function (person) { return servicePersonMatches(person, gender, year, campus); });
      var hay = people.map(function (person) { return person.student_name + " " + person.registration_number; }).join(" ") + " " + (pass.destination || "");
      return statusMatch && personMatch && hay.toLowerCase().indexOf(q) >= 0;
    });
    el("ss-pass-permission-note").textContent = state.showPassArchive ? "Rejected and cancelled passes are kept here for reference." : isLeadership() ? "Student Leadership can view all people and decisions on a pass. Approval remains view only." : state.session.role === "administrator" ? "School Administration can amend departure and return times and make the Administrator decision." : "Management can record a Principal, Dean, or Director decision.";
    el("ss-pass-filter").hidden = state.showPassArchive;
    el("ss-pass-archive-toggle").textContent = state.showPassArchive ? "Back to current passes" : "View rejected and cancelled passes";
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
    var q = value("ss-fee-search").toLowerCase(), filter = value("ss-fee-filter"), gender = value("ss-fee-gender"), year = value("ss-fee-year"), campus = value("ss-fee-campus");
    var rows = (data.students || []).filter(function (student) {
      var statusMatch = filter === "ALL" || filter === "PAID" && student.fees_paid !== false || filter === "UNPAID" && student.fees_paid === false;
      return statusMatch && servicePersonMatches(student, gender, year, campus) && (student.student_name + " " + student.registration_number).toLowerCase().indexOf(q) >= 0;
    });
    el("ss-fee-rows").innerHTML = rows.length ? rows.map(function (student) {
      var paid = student.fees_paid !== false;
      return '<tr><td>' + serviceStudentName(student) + '</td><td>' + escapeHtml(student.registration_number) + '</td><td>' + escapeHtml(selected.term_name || "Current term") + '</td><td>' + escapeHtml(formatDate(selected.fees_due_date)) + '</td><td><button class="button ' + (paid ? "secondary" : "danger") + ' ss-fee-toggle" data-registration="' + escapeHtml(student.registration_number) + '" data-paid="' + paid + '" type="button">' + (paid ? "Paid" : "Not paid") + '</button></td><td>' + escapeHtml(formatDateTime(student.fee_updated_at)) + "</td></tr>";
    }).join("") : '<tr><td colspan="6" class="empty-state">No matching fee records.</td></tr>';
  }

  function renderStudentDuty() {
    var data = state.studentServices || {}, q = value("ss-duty-search").toLowerCase(), gender = value("ss-duty-gender"), year = value("ss-duty-year"), campus = value("ss-duty-campus");
    var rows = (data.gate_duty_today || []).filter(function (row) { return servicePersonMatches(row, gender, year, campus) && (row.student_name + " " + row.registration_number).toLowerCase().indexOf(q) >= 0; });
    el("ss-duty-rows").innerHTML = rows.length ? rows.map(function (row) {
      return '<tr><td>' + escapeHtml(formatDateTime(row.scanned_at)) + '</td><td>' + serviceStudentName(row) + '</td><td>' + escapeHtml(row.registration_number) + '</td><td><span class="service-pill ' + escapeHtml(row.direction) + '">' + escapeHtml(row.direction) + '</span></td><td>' + escapeHtml(row.source || row.record_source || "Recorded") + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty-state">No gate-duty records today.</td></tr>';
  }

  function renderStudentRecent() {
    var data = state.studentServices || {}, q = value("ss-recent-search").toLowerCase(), gender = value("ss-recent-gender"), year = value("ss-recent-year"), campus = value("ss-recent-campus");
    var rows = (data.recent_movements || []).filter(function (row) { return servicePersonMatches(row, gender, year, campus) && (row.student_name + " " + row.registration_number).toLowerCase().indexOf(q) >= 0; });
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
    dispatchPassEmail();
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
    var setupMap = {};
    (state.pinSetupOverview.setups || []).forEach(function (setup) { setupMap[setup.department_id] = setup; });
    el("department-access-list").innerHTML = departments.map(function (department) {
      var setup = setupMap[department.id] || { setup_status: "not_issued" };
      var generated = state.generatedPinSetupCodes[department.id];
      var setupText = setup.setup_status === "active"
        ? "One-time setup code is active until " + formatDateTime(setup.expires_at) + "."
        : setup.setup_status === "locked"
        ? "Setup code is locked until " + formatDateTime(setup.locked_until) + ". Issue a new code if access is urgent."
        : setup.setup_status === "expired"
        ? "The previous setup code expired. Issue a new one when the department is ready."
        : setup.setup_status === "used"
        ? "The previous setup code was used."
        : "No one-time setup code has been issued.";
      var setupButton = department.login_enabled
        ? "Issue self-service PIN-change code"
        : setup.setup_status === "active" ? "Replace first-login code" : "Generate first-login code";
      var reveal = generated
        ? '<div class="setup-code-reveal" role="status"><span>Share privately with ' + escapeHtml(department.name) + '. This code is shown only here.</span><strong>' + escapeHtml(generated.setup_code) + '</strong><span>Expires ' + escapeHtml(formatDateTime(generated.expires_at)) + ' and works once.</span></div>'
        : "";
      return '<article class="access-card">'
        + '<div class="card-top"><div><h3>' + escapeHtml(department.name) + '</h3><p class="muted">' + (department.login_enabled ? "Department PIN is active" : "Waiting for its first PIN") + '</p></div>' + statusPill(department.login_enabled ? "green" : "amber") + '</div>'
        + '<p class="setup-status">' + escapeHtml(setupText) + '</p>'
        + '<form class="department-setup-form" data-department="' + department.id + '"><label>Issued by<input class="setup-code-actor" list="student-name-options" data-lookup="student" placeholder="Search exact student record" required></label><button class="button primary" type="submit">' + escapeHtml(setupButton) + '</button></form>'
        + reveal
        + '<details><summary>Administrator set the PIN directly</summary><form class="department-code-form" data-department="' + department.id + '"><label>New 4-digit PIN<input type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" required autocomplete="new-password"></label><label>Recorded by<input class="code-actor" list="student-name-options" data-lookup="student" placeholder="Search exact student record" required></label><button class="button secondary" type="submit">Set PIN directly</button></form></details>'
        + '</article>';
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
    renderDutyRoster();
    renderDutiesWorkspace();
    renderReportsAttention();
    renderTasks();
    renderDepartmentMemberSummary();
    renderMembersWorkspace();
    renderRequests();
    renderPlanner();
    renderStandingDepartments();
    renderReports();
    renderTransfers();
    renderTools();
    renderAccommodation();
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
    if (view === "accommodation-service" && isAccommodationWorkspace() && !state.accommodation) {
      loadAccommodation().then(renderAccommodation).catch(function (error) { toast(error.message, true); });
    }
  }

  function openTarget(button) {
    if (!button) return;
    switchView(button.dataset.openView);
    var target = button.dataset.openTarget || "";
    if (target.indexOf("campus:") === 0) {
      activateStudentServicesTab("campus");
      el("ss-campus-filter").value = target.split(":")[1];
      renderStudentCampus();
    } else if (target.indexOf("passes:") === 0) {
      activateStudentServicesTab("passes");
      el("ss-pass-filter").value = target.split(":")[1];
      renderStudentPasses();
    }
    if (button.dataset.openTaskSection === "duty") {
      el("duty-roster-panel").open = true;
      el("duty-roster-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function populateDutyForm(weekStart) {
    var duty = (state.planning.duties || []).find(function (item) { return item.week_start === weekStart; }) || {};
    el("duty-week-start").value = weekStart || mondayFor(today());
    el("duty-prefect").value = duty.prefect_on_duty || "";
    el("duty-senior-prefect").value = duty.senior_prefect_on_duty || "";
    el("duty-notes").value = duty.notes || "";
    el("duty-roster-panel").open = true;
  }

  function populateStandingForm(departmentId) {
    var counts = departmentGroupCounts(departmentId);
    var rule = (state.planning.standing_rules || []).find(function (item) { return item.department_id === departmentId; }) || {};
    el("standing-department").value = departmentId || "";
    ["year1_men","year1_ladies","year2_men","year2_ladies"].forEach(function (code) {
      el("standing-" + code.replace(/_/g, "-")).value = Number(counts[code] || 0);
    });
    el("standing-active").checked = !!rule.active;
    all('input[name="standing-day"]', el("standing-department-form")).forEach(function (input) {
      input.checked = !(rule.days_of_week || []).length || (rule.days_of_week || []).map(Number).indexOf(Number(input.value)) >= 0;
    });
    all('input[name="standing-slot"]', el("standing-department-form")).forEach(function (input) {
      input.checked = (rule.slot_codes || []).indexOf(input.value) >= 0;
    });
    el("standing-departments-panel").open = true;
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
    if (!departmentId) throw new Error("Choose a reporting section before saving this report.");
    var actor=requireLookup("daily-actor","staff");
    var staff=value("daily-staff")?requireLookup("daily-staff","staff"):null;
    return {
      actor_name: actor.full_name, department_id: departmentId, report_type: "daily",
      report_date: reportDate, period_start: reportDate, period_end: reportDate,
      staff_on_duty: staff?staff.full_name:"", work_completed: value("daily-completed"),
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
    if (!departmentId) throw new Error("Choose a reporting section before saving this report.");
    var actor=requireLookup("period-actor","staff");
    return {
      actor_name: actor.full_name, department_id: departmentId,
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
      await loadData(false);
      toast(submit ? "Report submitted." : "Draft saved.");
    } catch (error) { toast(error.message, true); }
    finally { setBusy(button, false); }
  }

  function bindEvents() {
    document.addEventListener("focusin", function (event) {
      var input = event.target.closest && event.target.closest("[data-lookup]");
      if (input) ensureStudentLookup(input);
    });
    document.addEventListener("input", function (event) {
      var input = event.target.closest && event.target.closest("[data-lookup]");
      if (!isStudentLookupInput(input)) return;
      clearLookupSelection(input);
      queueStudentSearch(input);
    });
    document.addEventListener("click", function (event) {
      var option = event.target.closest && event.target.closest(".student-search-option[data-student-search-key]");
      if (option) {
        var input = studentLookupInputByKey(option.dataset.studentSearchKey);
        if (input) {
          var scope = input.dataset.lookup;
          var person = lookupPool(scope).find(function (candidate) {
            return (option.dataset.studentId && lookupPersonId(candidate) === option.dataset.studentId)
              || (option.dataset.registrationNumber && lookupRegistration(candidate) === option.dataset.registrationNumber);
          });
          if (person) {
            setLookupSelection(input, person);
            hideStudentSearchResults(input);
            input.focus();
          }
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!event.target.closest || !event.target.closest(".student-search-field")) hideAllStudentSearchResults();
    });
    document.addEventListener("submit", function (event) {
      var invalid = all("[data-lookup]", event.target).find(function (input) {
        return String(input.value || "").trim() && !exactLookup(input.dataset.lookup,input.value,input);
      });
      if (invalid) {
        event.preventDefault();
        event.stopImmediatePropagation();
        invalid.focus();
        toast("Choose an exact name from the lookup list.",true);
      }
    },true);
    document.addEventListener("change",function (event) {
      var input = event.target.closest && event.target.closest("[data-lookup]");
      if (!input || !String(input.value || "").trim()) return;
      var person = exactLookup(input.dataset.lookup,input.value,input);
      if (person && input.dataset.lookup !== "staff") setLookupSelection(input, person);
      else if (person) input.value = person.full_name;
    });
    el("access-type").addEventListener("change", function () {
      state.pinSetupMode = false;
      el("access-code").inputMode = "numeric";
      el("access-code").maxLength = 4;
      el("access-code").pattern = "[0-9]{4}";
      updateDepartmentLoginForm();
    });
    el("login-department").addEventListener("change", function () {
      state.pinSetupMode = false;
      el("access-code").value = "";
      el("department-setup-code").value = "";
      el("department-new-pin").value = "";
      el("department-confirm-pin").value = "";
      updateDepartmentLoginForm();
    });
    el("use-department-setup").addEventListener("click", function () {
      state.pinSetupMode = true;
      el("access-code").value = "";
      updateDepartmentLoginForm();
      el("department-setup-code").focus();
    });
    el("use-existing-pin").addEventListener("click", function () {
      state.pinSetupMode = false;
      el("department-setup-code").value = "";
      el("department-new-pin").value = "";
      el("department-confirm-pin").value = "";
      updateDepartmentLoginForm();
      el("access-code").focus();
    });

    el("login-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var setupMode = isDepartmentPinSetupMode();
      setBusy(event.currentTarget, true, setupMode ? "Creating PIN..." : "Opening...");
      try {
        var chosenPin = value("access-code");
        var setupResult = null;
        if (setupMode) {
          chosenPin = value("department-new-pin");
          if (chosenPin !== value("department-confirm-pin")) throw new Error("The two new PIN entries do not match.");
          setupResult = await rpc("ops_claim_department_pin", {
            p_department_slug: value("login-department"),
            p_setup_code: value("department-setup-code"),
            p_new_pin: chosenPin,
            p_confirm_pin: value("department-confirm-pin")
          });
          if (setupResult.status !== "success") throw new Error(setupResult.message || "The department PIN could not be created.");
          await loadCatalog();
        }
        var result = await rpc("ops_login", { p_access_type: value("access-type"), p_department_slug: value("login-department"), p_access_code: chosenPin });
        if (result.status !== "success") throw new Error(result.message || "Sign-in failed.");
        storeSession(result); showApp(); await loadData(false); toast(setupResult ? "Department PIN created and workspace opened." : "Workspace opened.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("logout-button").addEventListener("click", function () { signOut(true); });
    el("refresh-button").addEventListener("click", function () { loadData(true).catch(function (error) { toast(error.message, true); }); });
    el("range-from").addEventListener("change", function () { loadData(false).catch(function (error) { toast(error.message, true); }); });
    el("main-nav").addEventListener("click", function (event) { var button = event.target.closest("button[data-view]"); if (button) switchView(button.dataset.view); });
    el("app-shell").addEventListener("click", function (event) { var button = event.target.closest("[data-open-view]"); if (button) openTarget(button); });

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
    ["ss-campus-search","ss-campus-gender","ss-campus-year","ss-campus-filter"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentCampus); });
    ["ss-accommodation-search","ss-accommodation-gender","ss-accommodation-year","ss-accommodation-campus","ss-accommodation-filter"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentAccommodation); });
    ["ss-pass-search","ss-pass-gender","ss-pass-year","ss-pass-campus","ss-pass-filter"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentPasses); });
    el("ss-pass-archive-toggle").addEventListener("click", function () {
      state.showPassArchive = !state.showPassArchive;
      el("ss-pass-filter").value = "ALL";
      renderStudentPasses();
    });
    ["ss-duty-search","ss-duty-gender","ss-duty-year","ss-duty-campus"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentDuty); });
    ["ss-recent-search","ss-recent-gender","ss-recent-year","ss-recent-campus"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentRecent); });
    ["ss-fee-search","ss-fee-gender","ss-fee-year","ss-fee-campus","ss-fee-filter"].forEach(function (id) { el(id).addEventListener(id.indexOf("search") >= 0 ? "input" : "change", renderStudentFees); });

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

    el("work-priority").addEventListener("change", function () {
      var crucial = isConference() || value("work-priority") === "crucial";
      el("work-crucial-field").hidden = !crucial;
      el("work-crucial-reason").required = crucial;
    });
    el("work-unexpected").addEventListener("change", function () {
      if (this.checked) {
        el("work-date").value = today();
        el("work-date").min = today();
        el("work-date").max = today();
      } else {
        el("work-date").min = addDays(today(), 1);
        el("work-date").max = addDays(today(), 120);
        if (el("work-date").value <= today()) el("work-date").value = addDays(today(), 1);
      }
    });
    el("work-request-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Submitting...");
      var actor;
      try { actor = requireLookup("work-actor","department-member"); }
      catch (lookupError) { setBusy(event.currentTarget,false); toast(lookupError.message,true); return; }
      var payload = {
        title: value("work-title"), description: value("work-description"), location:value("work-location"), work_date: value("work-date"),
        unexpected: el("work-unexpected").checked, priority: isConference() ? "crucial" : value("work-priority"),
        crucial_reason: value("work-crucial-reason"), cadence: value("work-cadence"),
        extra_people: parseNumber(value("work-extra-people")) || 0, actor_student_id:actor.student_id || actor.id
      };
      try {
        var result = await rpc("ops_submit_work_request_v3", { p_session_token: state.session.session_token, p_payload: payload });
        if (result.status !== "success") throw new Error(result.message || "The task could not be submitted.");
        event.currentTarget.reset();
        el("work-date").value = addDays(today(), 1);
        el("work-date").min = addDays(today(), 1);
        el("work-date").max = addDays(today(), 120);
        el("work-crucial-field").hidden = true;
        el("work-crucial-reason").required = false;
        await loadData(false);
        toast(result.conference_task_only ? "Emergency task saved." : "Task sent to Student Leadership.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("task-filter").addEventListener("change", renderTasks);
    el("task-list-department").addEventListener("change", renderTasks);

    el("members-department").addEventListener("change",function(){loadRosterEditor(this.value);});
    el("add-department-member").addEventListener("click",function(){
      try {
        var student=requireLookup("member-lookup","student");
        if((state.editingRoster||[]).some(function(person){return person.student_id===(student.id||student.student_id);}))throw new Error("That student is already listed.");
        state.editingRoster.push({student_id:student.id||student.student_id,full_name:student.full_name,member_role:value("member-role")||"member"});
        el("member-lookup").value=""; renderMemberEditor();
      } catch(error){toast(error.message,true);}
    });
    el("department-member-editor").addEventListener("click",function(event){
      var button=event.target.closest(".remove-department-member"); if(!button)return;
      var row=button.closest(".member-editor-row"); state.editingRoster=state.editingRoster.filter(function(person){return person.student_id!==row.dataset.student;}); renderMemberEditor();
    });
    el("department-member-editor").addEventListener("change",function(event){
      if(!event.target.matches(".member-editor-role"))return;
      var row=event.target.closest(".member-editor-row"),person=state.editingRoster.find(function(item){return item.student_id===row.dataset.student;});
      if(person)person.member_role=event.target.value;
    });
    el("department-members-form").addEventListener("submit",async function(event){
      event.preventDefault(); var form=event.currentTarget; setBusy(form,true,"Saving...");
      try {
        var actorId=null;
        if(isDepartment()){var hod=requireLookup("members-hod-confirm","department-hod");actorId=hod.student_id||hod.id;}
        var result=await rpc("ops_save_department_members",{
          p_session_token:state.session.session_token,p_department_id:selectedMembersDepartmentId(),
          p_members:state.editingRoster.map(function(person){return{student_id:person.student_id,member_role:person.member_role};}),
          p_actor_student_id:actorId
        });
        if(result.status!=="success")throw new Error(result.message||"The department roster could not be saved.");
        state.editingRosterDepartmentId=null; await loadData(false); toast("Department members saved.");
      }catch(error){toast(error.message,true);}finally{setBusy(form,false);}
    });

    el("export-task-list").addEventListener("click", function () {
      try {
        var departmentFilter = value("task-list-department"), filter = value("task-filter") || "open";
        var rows = (state.data.tasks || []).filter(function (task) {
          if (departmentFilter && task.department_id !== departmentFilter) return false;
          if (filter === "open") return ["done","cancelled"].indexOf(task.status) < 0;
          if (filter === "done") return task.status === "done";
          if (filter === "blocked") return task.status === "blocked";
          return true;
        }).map(function (task) {
          var metadata = task.metadata && typeof task.metadata === "object" ? task.metadata : {};
          return {
            department: departmentPath(task.department_id), task: task.title, description: task.description || "",
            location: metadata.work_location || "",
            working_day: task.due_date || "", status: task.status, priority: isConference() ? "critical" : task.priority,
            recurrence: task.cadence, department_members: metadata.department_member_count || 0,
            department_member_names: Array.isArray(metadata.department_members) ? metadata.department_members.map(function(person){return person.full_name;}).join("; ") : "",
            extra_people: metadata.extra_people_requested || 0, total_people: task.requested_people || 0,
            owner: task.owner_name || "", crucial_reason: metadata.crucial_reason || ""
          };
        });
        downloadCsv(rows, "amfcc-task-list-" + today() + ".csv");
      } catch (error) { toast(error.message, true); }
    });

    el("duty-roster-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Saving...");
      try {
        var prefect = requireLookup("duty-prefect","second-year");
        var senior = requireLookup("duty-senior-prefect","senior");
        var actor = requireLookup("duty-actor","leadership");
        var result = await rpc("ops_save_weekly_duty_v2", {
          p_session_token: state.session.session_token, p_week_start: value("duty-week-start"),
          p_prefect_student_id: prefect.student_id || prefect.id,
          p_senior_prefect_student_id: senior.student_id || senior.id,
          p_notes: value("duty-notes"), p_actor_student_id: actor.student_id || actor.id
        });
        if (result.status !== "success") throw new Error(result.message || "The duty roster was not saved.");
        await loadData(false); toast("Duty roster saved.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("duty-roster-list").addEventListener("click", function (event) {
      var button = event.target.closest(".duty-edit"); if (button) populateDutyForm(button.dataset.week);
    });

    async function addServiceDutyPerson(type) {
      try {
        var input = el("service-duty-" + type + "-input");
        var person = exactLookup("student", input.value, input);
        if (!person) {
          var search = await searchStudentRecords(input.value);
          var eligible = (search.matches || []).map(function (match) { return allowedLookupMatch("student", match); }).filter(Boolean);
          if (eligible.length === 1) person = eligible[0];
        }
        if (!person) throw new Error("Choose one student from the search results before adding the name.");
        var key = type + "_people";
        var studentId = person.id || person.student_id;
        if (state.serviceDutyDraft[key].some(function (item) { return String(item.student_id) === String(studentId); })) {
          throw new Error(person.full_name + " is already listed for " + type + " duty.");
        }
        if (state.serviceDutyDraft[key].length >= 4) throw new Error(titleCase(type) + " duty already has four students.");
        var gender = dutyGender(person);
        if (!gender) throw new Error(person.full_name + " does not have a recorded gender. Update the student record before assigning this duty.");
        var counts = dutyGenderCounts(type);
        if (counts[gender] >= 2) throw new Error(titleCase(type) + " duty already has two " + (gender === "male" ? "men" : "women") + ".");
        setLookupSelection(input, person);
        state.serviceDutyDraft[key].push({ student_id: studentId, full_name: person.full_name, gender: gender, assignment_source: "manual" });
        state.serviceDutyDraft.dirty = true;
        input.value = "";
        clearLookupSelection(input);
        hideStudentSearchResults(input);
        renderDutyPeople(type);
      } catch (error) { toast(error.message, true); }
    }

    el("service-duty-kitchen-add").addEventListener("click", function () { void addServiceDutyPerson("kitchen"); });
    el("service-duty-toilet-add").addEventListener("click", function () { void addServiceDutyPerson("toilet"); });
    el("service-duty-week").addEventListener("change", function () { populateServiceDutyForm(this.value); });
    el("service-duty-form").addEventListener("input", function (event) {
      if (event.target.id !== "service-duty-week") state.serviceDutyDraft.dirty = true;
    });
    el("service-duty-kitchen-list").addEventListener("click", removeServiceDutyPerson);
    el("service-duty-toilet-list").addEventListener("click", removeServiceDutyPerson);
    function removeServiceDutyPerson(event) {
      var button = event.target.closest(".remove-duty-person"); if (!button) return;
      var row = button.closest(".duty-person-row"), type = button.dataset.dutyType, key = type + "_people";
      state.serviceDutyDraft[key] = state.serviceDutyDraft[key].filter(function (person) { return String(person.student_id) !== String(row.dataset.student); });
      state.serviceDutyDraft.dirty = true;
      renderDutyPeople(type);
    }
    el("service-duty-weeks").addEventListener("click", function (event) {
      var button = event.target.closest(".service-duty-edit");
      if (button) { populateServiceDutyForm(button.dataset.week); el("service-duty-panel").scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
    el("service-duty-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Saving...");
      try {
        if (value("service-duty-kitchen-input") || value("service-duty-toilet-input")) throw new Error("Click Add student so every selected name appears in the duty list before saving.");
        validateDutyLimit("kitchen");
        validateDutyLimit("toilet");
        var bell = value("service-duty-bell") ? requireLookup("service-duty-bell", "student") : null;
        var actor = value("service-duty-actor") ? requireLookup("service-duty-actor", "leadership") : null;
        var kitchenDepartment = departmentBySlug("kitchen");
        var toiletDepartment = departmentBySlug("toilets");
        if (!kitchenDepartment || !toiletDepartment) throw new Error("Kitchen or Toilets is missing from the department setup.");
        var result = await rpc("ops_save_service_duties", {
          p_session_token: state.session.session_token,
          p_week_start: value("service-duty-week"),
          p_bell_student_id: bell ? bell.id || bell.student_id : null,
          p_kitchen_department_id: kitchenDepartment.id,
          p_toilet_department_id: toiletDepartment.id,
          p_kitchen_students: state.serviceDutyDraft.kitchen_people.map(function (person) { return person.student_id; }),
          p_toilet_students: state.serviceDutyDraft.toilet_people.map(function (person) { return person.student_id; }),
          p_actor_student_id: actor ? actor.student_id || actor.id : null
        });
        if (result.status !== "success") throw new Error(result.message || "The weekly duties were not saved.");
        state.serviceDutyDraft.week_start = value("service-duty-week");
        state.serviceDutyDraft.dirty = false;
        await loadData(false); toast("Duty changes saved. You can return later to complete the week.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });

    el("gate-duty-date").addEventListener("change", function () { populateGateDutyForm(this.value); });
    el("gate-duty-days").addEventListener("click", function (event) {
      var button = event.target.closest(".gate-duty-edit");
      if (button) { populateGateDutyForm(button.dataset.date); el("gate-duty-panel").scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
    el("gate-duty-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Saving...");
      try {
        var actorScope = isLeadership() ? "leadership" : "department-member";
        var assignments = [
          ["22_00", requireLookup("gate-duty-2200", "student")],
          ["00_02", requireLookup("gate-duty-0000", "student")],
          ["02_04", requireLookup("gate-duty-0200", "student")]
        ].map(function (entry) { return { slot_code: entry[0], student_id: entry[1].id || entry[1].student_id }; });
        var actor = requireLookup("gate-duty-actor", actorScope);
        var result = await rpc("ops_save_gate_duty", {
          p_session_token: state.session.session_token,
          p_duty_date: value("gate-duty-date"),
          p_assignments: assignments,
          p_actor_student_id: actor.student_id || actor.id
        });
        if (result.status !== "success") throw new Error(result.message || "Gate duty was not saved.");
        await loadData(false); toast("Gate duty saved for all three slots.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });

    el("standing-department").addEventListener("change", function () { if (this.value) populateStandingForm(this.value); });
    el("standing-department-list").addEventListener("click", function (event) {
      var button = event.target.closest(".standing-edit"); if (button) populateStandingForm(button.dataset.department);
    });
    el("standing-department-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Saving...");
      var counts = ["year1_men","year1_ladies","year2_men","year2_ladies"].map(function (code) {
        return { group_code: code, member_count: Number(value("standing-" + code.replace(/_/g, "-")) || 0) };
      });
      var days = all('input[name="standing-day"]:checked', event.currentTarget).map(function (input) { return Number(input.value); });
      var slots = all('input[name="standing-slot"]:checked', event.currentTarget).map(function (input) { return input.value; });
      try {
        var actor = requireLookup("standing-actor","leadership");
        var result = await rpc("ops_save_department_planning", {
          p_session_token: state.session.session_token, p_department_id: value("standing-department"),
          p_group_counts: counts, p_active: el("standing-active").checked,
          p_days_of_week: days, p_slot_codes: slots, p_actor_name: actor.full_name
        });
        if (result.status !== "success") throw new Error(result.message || "The department setup was not saved.");
        await loadData(false); toast("Department setup saved.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });

    el("planner-board").addEventListener("click", async function (event) {
      var button = event.target.closest(".planner-open-approve,.planner-confirm,.planner-cancel-approve,.planner-decline"); if (!button) return;
      var card = button.closest(".planner-card");
      var popover = card.querySelector(".planner-approval-popover");
      if (button.classList.contains("planner-open-approve")) {
        popover.hidden = false;
        card.querySelector(".planner-primary-actions").hidden = true;
        updatePlannerCardAvailability(card);
        card.querySelector(".planner-slot").focus();
        return;
      }
      if (button.classList.contains("planner-cancel-approve")) {
        popover.hidden = true;
        card.querySelector(".planner-primary-actions").hidden = false;
        return;
      }
      setBusy(button, true, "Saving...");
      try {
        var actor = requireLookup("planner-actor","leadership");
        var decline = button.classList.contains("planner-decline");
        var note = decline ? window.prompt("Optional reason for rejecting this task:","") || "" : card.querySelector(".planner-notes").value;
        if (decline && !window.confirm("Reject this department task?")) return;
        var allocations = all(".planner-group", card).map(function (input) { return { group_code: input.dataset.group, headcount: Number(input.value || 0) }; });
        var result = await rpc("ops_plan_work_request_v3", {
          p_session_token: state.session.session_token, p_request_id: card.dataset.request,
          p_decision: decline ? "declined" : "approved", p_slot_id: decline ? null : card.querySelector(".planner-slot").value || null,
          p_work_date: decline ? null : card.querySelector(".planner-work-date").value,
          p_allocated_headcount: decline ? null : Number(card.querySelector(".planner-allocation").value || 0),
          p_allocations: decline ? [] : allocations, p_notes: note,
          p_actor_student_id: actor.student_id || actor.id
        });
        if (result.status !== "success") throw new Error(result.message || "The allocation could not be saved.");
        await loadData(false); toast(decline ? "Task rejected." : "Task approved, allocated and published.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(button, false); }
    });
    el("planner-board").addEventListener("input", function (event) {
      if (event.target.matches(".planner-group,.planner-allocation")) updatePlannerCardAvailability(event.target.closest(".planner-card"));
    });
    el("planner-board").addEventListener("change", function (event) {
      if (event.target.matches(".planner-slot,.planner-work-date")) {
        var card = event.target.closest(".planner-card");
        if (event.target.matches(".planner-work-date")) card.dataset.workDate = event.target.value;
        updatePlannerCardAvailability(card);
      }
    });

    el("planner-daily-button").addEventListener("click",function () { state.plannerView="daily"; renderVisualPlan(); });
    el("planner-weekly-button").addEventListener("click",function () { state.plannerView="weekly"; el("planner-week").value=mondayFor(value("planner-day")||today()); renderVisualPlan(); });
    el("planner-day").addEventListener("change",renderVisualPlan);
    el("planner-week").addEventListener("change",function () { this.value=mondayFor(this.value||today()); renderVisualPlan(); });
    el("visual-plan-board").addEventListener("click",function (event) {
      var button=event.target.closest(".planner-move-button"); if(button) openPlannerMove(button.dataset.sessionId);
    });
    el("visual-plan-board").addEventListener("dragstart",function (event) {
      var card=event.target.closest(".visual-task-card"); if(!card)return;
      state.draggedSessionId=card.dataset.sessionId; card.classList.add("dragging");
      if(event.dataTransfer){event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",state.draggedSessionId);}
    });
    el("visual-plan-board").addEventListener("dragend",function (event) {
      var card=event.target.closest(".visual-task-card"); if(card)card.classList.remove("dragging");
      state.draggedSessionId=null; all(".drop-zone",el("visual-plan-board")).forEach(function(zone){zone.classList.remove("drag-over");});
    });
    el("visual-plan-board").addEventListener("dragover",function (event) {
      var zone=event.target.closest(".drop-zone"); if(!zone)return; event.preventDefault(); zone.classList.add("drag-over");
    });
    el("visual-plan-board").addEventListener("dragleave",function (event) { var zone=event.target.closest(".drop-zone"); if(zone)zone.classList.remove("drag-over"); });
    el("visual-plan-board").addEventListener("drop",function (event) {
      var zone=event.target.closest(".drop-zone"); if(!zone)return; event.preventDefault(); zone.classList.remove("drag-over");
      var sessionId=state.draggedSessionId || (event.dataTransfer&&event.dataTransfer.getData("text/plain"));
      var session=findPlanSession(sessionId); if(!session)return;
      var slotId=zone.dataset.dropSlot || session.slot_id;
      movePlannedSession(sessionId,zone.dataset.dropDate,slotId,zone).catch(function(error){toast(error.message,true);});
    });
    el("planner-move-close").addEventListener("click",function(){el("planner-move-modal").hidden=true;});
    el("planner-move-modal").addEventListener("click",function(event){if(event.target===this)this.hidden=true;});
    el("planner-move-form").addEventListener("submit",function(event){
      event.preventDefault(); var form=event.currentTarget;
      movePlannedSession(value("planner-move-session-id"),value("planner-move-date"),value("planner-move-slot"),form).then(function(){el("planner-move-modal").hidden=true;}).catch(function(error){toast(error.message,true);});
    });
    el("person-lookup-close").addEventListener("click",closePersonLookup);
    el("person-lookup-modal").addEventListener("click",function(event){if(event.target===this)closePersonLookup();});
    el("person-lookup-form").addEventListener("submit",function(event){
      event.preventDefault();
      try{
        var pending=state.personLookupResolve;if(!pending)return;
        var person=requireLookup("person-lookup-input",pending.scope);state.personLookupResolve=null;el("person-lookup-modal").hidden=true;pending.resolve(person);
      }catch(error){toast(error.message,true);}
    });

    el("overview-sessions").addEventListener("click", async function (event) {
      var button = event.target.closest(".session-status"); if (!button) return; setBusy(button, true, "Saving...");
      try { var input=button.closest(".data-card").querySelector(".session-actor"); var person=requireLookup(input,"department-member"); await command("update_session_status", { session_id: button.dataset.id, status: button.dataset.status, actor_name: person.full_name }); await loadData(false); toast("Session updated."); }
      catch (error) { toast(error.message, true); } finally { setBusy(button, false); }
    });
    el("notification-list").addEventListener("click", async function (event) {
      var button = event.target.closest(".mark-read"); if (!button) return;
      event.stopPropagation();
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
      try { var departmentId = reportDepartmentId("period"); if (!departmentId) throw new Error("Choose a reporting section before generating this report."); var result = await rpc("ops_generate_report", { p_session_token: state.session.session_token, p_report_type: value("period-type"), p_department_id: departmentId, p_period_start: value("period-start"), p_period_end: value("period-end") }); if (result.status !== "success") throw new Error(result.message || "Report could not be generated."); populatePeriodPreview(result); toast("Report generated from source records."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("save-period-draft").addEventListener("click", function (event) { savePeriod(false, event.currentTarget); });
    el("period-report-form").addEventListener("submit", function (event) { event.preventDefault(); savePeriod(true, event.currentTarget); });

    el("transfer-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Recording...");
      var payload = { from_department_id: isDepartment() ? currentDepartmentId() : value("transfer-from"), to_department_id: value("transfer-to"), transfer_date: value("transfer-date"), reference: value("transfer-reference"), actor_name: value("transfer-actor"), notes: value("transfer-notes"), items: [{ item_name: value("transfer-item"), quantity: parseNumber(value("transfer-quantity")), unit: value("transfer-unit") }] };
      try { payload.actor_name=requireLookup("transfer-actor","student").full_name; await command("create_transfer", payload); event.currentTarget.reset(); el("transfer-date").value = today(); await loadData(false); toast("Transfer recorded."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });
    el("transfer-list").addEventListener("click", async function (event) {
      var button = event.target.closest(".receive-transfer"); if (!button) return;
      var notes = button.dataset.decision === "disputed" ? window.prompt("Reason for dispute:", "") : "";
      try { var person=await choosePerson("student","Choose receiving person"); await command("receive_transfer", { transfer_id: button.dataset.id, decision: button.dataset.decision, actor_name: person.full_name, notes: notes }); await loadData(false); toast("Transfer updated."); }
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

    el("accommodation-refresh").addEventListener("click", async function () {
      setBusy(this, true, "Refreshing...");
      try {
        await loadAccommodation();
        renderAccommodation();
        toast("Accommodation assignments refreshed.");
      } catch (error) { toast(error.message, true); }
      finally { setBusy(this, false); }
    });
    el("accommodation-building-tabs").addEventListener("click", function (event) {
      var button = event.target.closest("[data-accommodation-building]");
      if (!button) return;
      state.accommodationBuilding = button.dataset.accommodationBuilding;
      el("accommodation-search").value = "";
      renderAccommodation();
    });
    el("accommodation-search").addEventListener("input", renderAccommodation);
    el("accommodation-rows").addEventListener("click", function (event) {
      var button = event.target.closest(".accommodation-edit-student");
      if (button) openAccommodationEdit(button.dataset.studentId);
    });
    el("accommodation-find-form").addEventListener("submit", function (event) {
      event.preventDefault();
      try {
        var person = requireLookup("accommodation-student", "student");
        openAccommodationEdit(lookupPersonId(person));
      } catch (error) { toast(error.message, true); }
    });
    el("accommodation-remove").addEventListener("change", toggleAccommodationEditFields);
    el("accommodation-close").addEventListener("click", closeAccommodationEdit);
    el("accommodation-cancel").addEventListener("click", closeAccommodationEdit);
    el("accommodation-modal").addEventListener("click", function (event) {
      if (event.target === this) closeAccommodationEdit();
    });
    el("accommodation-form").addEventListener("submit", function (event) {
      event.preventDefault();
      saveAccommodationEdit(event.currentTarget).catch(function (error) { toast(error.message, true); });
    });

    el("report-review-filter").addEventListener("change", renderReports);
    el("report-review-list").addEventListener("click", async function (event) {
      var button = event.target.closest(".report-transition"); if (!button) return;
      var reason = button.dataset.status === "returned" ? window.prompt("Why is this report being returned?", "") : "";
      if (button.dataset.status === "returned" && !reason) return;
      setBusy(button, true, "Saving...");
      try { var reviewer=requireLookup("reviewer-name","staff"); await command("transition_report", { report_id: button.dataset.id, target_status: button.dataset.status, reason: reason, actor_name: reviewer.full_name }); await loadData(false); toast("Report moved to " + titleCase(button.dataset.status) + "."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(button, false); }
    });
    el("management-action-form").addEventListener("submit", async function (event) {
      event.preventDefault(); setBusy(event.currentTarget, true, "Creating...");
      var payload = { department_id: value("action-department") || null, priority: value("action-priority"), summary: value("action-summary"), description: value("action-description"), owner_name: value("action-owner"), due_date: value("action-due-date") || null, actor_name: value("action-actor"), sync_to_jira: el("action-jira").checked };
      try { payload.owner_name=payload.owner_name?requireLookup("action-owner","student").full_name:""; payload.actor_name=requireLookup("action-actor","student").full_name; await command("save_management_action", payload); event.currentTarget.reset(); await loadData(false); toast("Management action created."); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(event.currentTarget, false); }
    });

    el("department-access-list").addEventListener("submit", async function (event) {
      var setupForm = event.target.closest(".department-setup-form");
      var pinForm = event.target.closest(".department-code-form");
      if (!setupForm && !pinForm) return;
      event.preventDefault();
      var form = setupForm || pinForm;
      setBusy(form, true, setupForm ? "Generating..." : "Setting...");
      try {
        if (setupForm) {
          var issuer = requireLookup(form.querySelector(".setup-code-actor"), "student");
          var setupResult = await rpc("ops_generate_department_pin_setup", {
            p_session_token: state.session.session_token,
            p_department_id: form.dataset.department,
            p_actor_name: issuer.full_name
          });
          if (setupResult.status !== "success") throw new Error(setupResult.message || "Setup code could not be generated.");
          state.generatedPinSetupCodes[form.dataset.department] = {
            setup_code: setupResult.setup_code,
            expires_at: setupResult.expires_at
          };
          form.reset();
          await loadCatalog();
          await loadData(false);
          toast("One-time department setup code generated.");
        } else {
          var actor = requireLookup(form.querySelector(".code-actor"), "student");
          var result = await rpc("ops_set_department_pin_v2", {
            p_session_token: state.session.session_token,
            p_department_id: form.dataset.department,
            p_pin: form.querySelector('input[type="password"]').value,
            p_actor_name: actor.full_name
          });
          if (result.status !== "success") throw new Error(result.message || "PIN could not be set.");
          delete state.generatedPinSetupCodes[form.dataset.department];
          form.reset();
          await loadCatalog();
          await loadData(false);
          toast("Department PIN set directly.");
        }
      } catch (error) { toast(error.message, true); }
      finally { setBusy(form, false); }
    });

    window.addEventListener("online", function () { if (state.session) loadData(false).catch(function () {}); });
    window.addEventListener("offline", function () { el("connection-state").textContent = "Offline"; el("connection-state").className = "status-pill red"; });
  }

  async function initialise() {
    state.gatePassLink = readGatePassLink();
    el("range-from").value = today();
    el("request-date").value = addDays(today(), 1);
    el("work-date").value = addDays(today(), 1);
    el("work-date").min = addDays(today(), 1);
    el("work-date").max = addDays(today(), 120);
    el("planner-day").value = today();
    el("planner-day").min = today();
    el("planner-day").max = addDays(today(),120);
    el("planner-week").value = mondayFor(today());
    el("planner-week").min = mondayFor(today());
    el("planner-week").max = addDays(mondayFor(today()),112);
    el("planner-move-date").min = today();
    el("planner-move-date").max = addDays(today(),120);
    el("duty-week-start").value = mondayFor(today());
    el("duty-week-start").min = addDays(mondayFor(today()), -14);
    el("duty-week-start").max = addDays(mondayFor(today()), 1825);
    el("service-duty-week").value = mondayFor(today());
    el("service-duty-week").min = addDays(mondayFor(today()), -14);
    el("service-duty-week").max = addDays(mondayFor(today()), 730);
    el("gate-duty-date").value = today();
    el("gate-duty-date").min = addDays(today(), -14);
    el("gate-duty-date").max = addDays(today(), 365);
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
    clearInterval(state.plannerTimer);
    state.plannerTimer=setInterval(refreshPlannerLive,30000);
    try {
      await loadCatalog();
      if (restoreSession() && (!state.gatePassLink || state.session.role === state.gatePassLink.access)) {
        showApp();
        try { await loadData(false); }
        catch (error) { toast(error.message, true); signOut(false); }
      } else {
        if (state.session && state.gatePassLink && state.session.role !== state.gatePassLink.access) {
          state.session = null;
          sessionStorage.removeItem("amfcc_ops_session");
        }
        showLogin();
      }
    } catch (error) {
      showLogin(); toast("Could not connect to the operations service. " + error.message, true);
    }

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  document.addEventListener("DOMContentLoaded", initialise);
})();
