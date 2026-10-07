(function () {
  "use strict";

  var enrolmentData = null;
  var enrolmentClient = null;
  var bound = false;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function getSession() {
    try { return JSON.parse(sessionStorage.getItem("amfcc_ops_session") || "null"); }
    catch (error) { return null; }
  }

  function canView(session) {
    return !!session && (
      session.role === "administrator" ||
      (session.role === "department" && session.department && session.department.slug === "administrators-office")
    );
  }

  function getClient() {
    if (enrolmentClient) return enrolmentClient;
    if (!window.supabase || !window.APP_CONFIG) return null;
    enrolmentClient = window.supabase.createClient(
      window.APP_CONFIG.SUPABASE_URL,
      window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    return enrolmentClient;
  }

  function formatDateTime(value) {
    if (!value) return "—";
    var date = new Date(value);
    return isNaN(date.getTime()) ? String(value) : date.toLocaleString([], {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  }

  function ensureUi() {
    var nav = document.getElementById("main-nav");
    var shell = document.getElementById("app-shell");
    if (!nav || !shell) return false;

    var button = nav.querySelector('[data-view="enrolment"]');
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.view = "enrolment";
      button.dataset.roles = "administrator,department";
      button.dataset.departmentSlug = "administrators-office";
      button.textContent = "Term enrolment";
      var passesButton = nav.querySelector('[data-view="admin-office-passes"]');
      if (passesButton && passesButton.nextSibling) nav.insertBefore(button, passesButton.nextSibling);
      else nav.appendChild(button);
    }

    if (!document.getElementById("view-enrolment")) {
      var section = document.createElement("section");
      section.id = "view-enrolment";
      section.className = "view";
      section.setAttribute("aria-labelledby", "enrolment-heading");
      section.innerHTML =
        '<div class="view-heading">' +
          '<div><p class="eyebrow">Term enrolment</p><h2 id="enrolment-heading">Registration progress</h2>' +
          '<p class="muted">Track and manage every student through the term registration workflow.</p></div>' +
          '<button id="enrolment-refresh" class="button secondary" type="button">Refresh enrolment</button>' +
        '</div>' +
        '<div id="enrolment-summary" class="summary-grid"></div>' +
        '<article class="panel">' +
          '<div class="panel-heading"><div><h3>Student registration status</h3><p>Filter by term, status, current stage or class year.</p></div><span id="enrolment-count" class="count-badge">0</span></div>' +
          '<div class="service-toolbar">' +
            '<select id="enrolment-term" aria-label="Academic term"></select>' +
            '<input id="enrolment-search" type="search" placeholder="Search student or registration number">' +
            '<select id="enrolment-status" aria-label="Registration status">' +
              '<option value="ALL">All statuses</option><option value="not_started">Not started</option><option value="started">Started</option>' +
              '<option value="returned">Returned to student</option><option value="student_submitted">Student submitted</option>' +
              '<option value="waiting_accommodation">Waiting accommodation</option><option value="ready_final">Ready for final</option><option value="completed">Completed</option>' +
            '</select>' +
            '<select id="enrolment-stage" aria-label="Current registration stage">' +
              '<option value="ALL">All stages</option><option value="student_not_started">Student not started</option>' +
              '<option value="student_form">Student completing form</option><option value="returned_to_student">Returned to student</option>' +
              '<option value="administrators_office">Administrator\'s Office review</option><option value="fees">Fees review</option>' +
              '<option value="accommodation">Accommodation</option><option value="final_administration">Final administration</option><option value="completed">Completed</option>' +
            '</select>' +
            '<select id="enrolment-year" aria-label="Class year"><option value="ALL">All classes</option><option value="1">1st Year</option><option value="2">2nd Year</option><option value="3">3rd Year</option></select>' +
          '</div>' +
          '<div class="table-wrap"><table class="service-table"><thead><tr>' +
            '<th>Student</th><th>Registration</th><th>Class</th><th>Status</th><th>Current stage</th><th>Stage progress</th><th>Last updated</th>' +
          '</tr></thead><tbody id="enrolment-rows"></tbody></table></div>' +
        '</article>';

      var studentServices = document.getElementById("view-student-services");
      if (studentServices) shell.insertBefore(section, studentServices);
      else shell.appendChild(section);
    }

    if (!bound) bindEvents();
    syncVisibility();
    return true;
  }

  function syncVisibility() {
    var session = getSession();
    var button = document.querySelector('#main-nav [data-view="enrolment"]');
    var section = document.getElementById("view-enrolment");
    var allowed = canView(session);
    if (button) button.hidden = !allowed;
    if (section && !allowed && section.classList.contains("active")) {
      section.classList.remove("active");
      var fallback = document.querySelector('#main-nav [data-view="overview"]');
      if (fallback) fallback.click();
    }
  }

  async function loadEnrolment(termId) {
    var session = getSession();
    if (!canView(session)) return;
    var client = getClient();
    if (!client) throw new Error("Supabase is not ready.");
    var response = await client.rpc("ops_term_enrolment_dashboard", {
      p_session_token: session.session_token,
      p_term_id: termId ? Number(termId) : null
    });
    if (response.error) throw response.error;
    if (!response.data || response.data.status !== "success") {
      throw new Error(response.data && response.data.message || "Term enrolment could not be loaded.");
    }
    enrolmentData = response.data;
    renderEnrolment();
  }

  function progressText(row) {
    var student = row.student_submitted_at ? "Student ✓" : "Student —";
    var admin = row.admin_office_required === false ? "Admin Office: Not required" : row.admin_office_complete ? "Admin Office ✓" : "Admin Office —";
    var fees = row.fees_complete ? "Fees —" : "Fees —";
    var accommodation = row.accommodation_complete ? "Accommodation ✓" : "Accommodation —";
    return [student, admin, fees, accommodation].join(" · ");
  }

  function statusClass(row) {
    if (row.completed_at || row.status === "completed") return "green";
    if (row.status === "returned") return "amber";
    return "neutral";
  }

  function renderEnrolment() {
    if (!enrolmentData || enrolmentData.status !== "success") return;

    var terms = enrolmentData.terms || [];
    var selected = enrolmentData.selected_term || {};
    var termSelect = document.getElementById("enrolment-term");
    if (termSelect) {
      termSelect.innerHTML = terms.map(function (term) {
        var label = term.term_name + (term.registration_is_open ? " · Open" : "");
        return '<option value="' + esc(term.id) + '">' + esc(label) + '</option>';
      }).join("");
      termSelect.value = String(selected.id || "");
    }

    var summary = enrolmentData.summary || {};
    var cards = [
      ["Expected", summary.expected || 0],
      ["Not started", summary.not_started || 0],
      ["Started", summary.started || 0],
      ["Returned", summary.returned || 0],
      ["Submitted", summary.student_submitted || 0],
      ["Waiting accommodation", summary.waiting_accommodation || 0],
      ["Ready final", summary.ready_final || 0],
      ["Completed", summary.completed || 0]
    ];
    document.getElementById("enrolment-summary").innerHTML = cards.map(function (card) {
      return '<div class="summary-card"><strong>' + esc(card[1]) + '</strong><span>' + esc(card[0]) + '</span></div>';
    }).join("");

    var search = String(document.getElementById("enrolment-search").value || "").toLowerCase();
    var status = document.getElementById("enrolment-status").value;
    var stage = document.getElementById("enrolment-stage").value;
    var year = document.getElementById("enrolment-year").value;
    var allRows = enrolmentData.registrations || [];
    var rows = allRows.filter(function (row) {
      var haystack = (String(row.student_name || "") + " " + String(row.registration_number || "")).toLowerCase();
      return (!search || haystack.indexOf(search) >= 0) &&
        (status === "ALL" || row.status === status) &&
        (stage === "ALL" || row.stage === stage) &&
        (year === "ALL" || String(row.class_year) === year);
    });

    document.getElementById("enrolment-count").textContent = rows.length + " of " + allRows.length;
    document.getElementById("enrolment-rows").innerHTML = rows.map(function (row) {
      return '<tr>' +
        '<td><strong>' + esc(row.student_name) + '</strong>' + (row.registration_category === 'executive_missions' ? '<br><small>Executive / missions</small>' : '') + '</td>' +
        '<td>' + esc(row.registration_number) + '</td>' +
        '<td>' + esc(row.class_year ? row.class_year + (row.class_year === 1 ? "st" : row.class_year === 2 ? "nd" : "rd") + " Year" : "—") + '</td>' +
        '<td><span class="status-pill ' + statusClass(row) + '">' + esc(row.status_label || row.status) + '</span></td>' +
        '<td><strong>' + esc(row.stage_label || "—") + '</strong></td>' +
        '<td><span class="service-secondary">' + esc(progressText(row)) + '</span></td>' +
        '<td>' + esc(formatDateTime(row.updated_at || row.completed_at || row.student_submitted_at || row.student_started_at)) + '</td>' +
      '</tr>';
    }).join("") || '<tr><td colspan="7" class="empty-state">No registrations match these filters.</td></tr>';
  }

  function bindEvents() {
    bound = true;
    var button = document.querySelector('#main-nav [data-view="enrolment"]');
    if (button) button.addEventListener("click", function () {
      loadEnrolment(document.getElementById("enrolment-term").value || null).catch(function (error) {
        if (window.console) console.error(error);
      });
    });
    document.getElementById("enrolment-refresh").addEventListener("click", function () {
      loadEnrolment(document.getElementById("enrolment-term").value || null).catch(function (error) {
        if (window.console) console.error(error);
      });
    });
    document.getElementById("enrolment-term").addEventListener("change", function () {
      loadEnrolment(this.value).catch(function (error) { if (window.console) console.error(error); });
    });
    ["enrolment-search","enrolment-status","enrolment-stage","enrolment-year"].forEach(function (id) {
      var node = document.getElementById(id);
      node.addEventListener(id === "enrolment-search" ? "input" : "change", renderEnrolment);
    });
  }

  function start() {
    if (!ensureUi()) return;
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      syncVisibility();
      var section = document.getElementById("view-enrolment");
      if (section && section.classList.contains("active") && !enrolmentData && canView(getSession())) {
        loadEnrolment(null).catch(function (error) { if (window.console) console.error(error); });
      }
      if (attempts > 120) clearInterval(timer);
    }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

