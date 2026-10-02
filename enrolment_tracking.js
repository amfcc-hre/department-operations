(function () {
  "use strict";

  var enrolmentData = null;
  var enrolmentClient = null;
  var bound = false;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/&lt;/g, "&amp;lt;").replace(/&gt;/g, "&amp;gt;")
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
        '&lt;div class="view-heading"&gt;' +
          '&lt;div&gt;&lt;p class="eyebrow"&gt;Term enrolment&lt;/p&gt;&lt;h2 id="enrolment-heading"&gt;Registration progress&lt;/h2&gt;' +
          '&lt;p class="muted"&gt;Track every student through the term registration workflow. This view is read-only.&lt;/p&gt;&lt;/div&gt;' +
          '&lt;button id="enrolment-refresh" class="button secondary" type="button"&gt;Refresh enrolment&lt;/button&gt;' +
        '&lt;/div&gt;' +
        '&lt;div id="enrolment-summary" class="summary-grid"&gt;&lt;/div&gt;' +
        '&lt;article class="panel"&gt;' +
          '&lt;div class="panel-heading"&gt;&lt;div&gt;&lt;h3&gt;Student registration status&lt;/h3&gt;&lt;p&gt;Filter by term, status, current stage or class year.&lt;/p&gt;&lt;/div&gt;&lt;span id="enrolment-count" class="count-badge"&gt;0&lt;/span&gt;&lt;/div&gt;' +
          '&lt;div class="service-toolbar"&gt;' +
            '&lt;select id="enrolment-term" aria-label="Academic term"&gt;&lt;/select&gt;' +
            '&lt;input id="enrolment-search" type="search" placeholder="Search student or registration number"&gt;' +
            '&lt;select id="enrolment-status" aria-label="Registration status"&gt;' +
              '&lt;option value="ALL"&gt;All statuses&lt;/option&gt;&lt;option value="not_started"&gt;Not started&lt;/option&gt;&lt;option value="started"&gt;Started&lt;/option&gt;' +
              '&lt;option value="returned"&gt;Returned to student&lt;/option&gt;&lt;option value="student_submitted"&gt;Student submitted&lt;/option&gt;' +
              '&lt;option value="waiting_accommodation"&gt;Waiting accommodation&lt;/option&gt;&lt;option value="ready_final"&gt;Ready for final&lt;/option&gt;&lt;option value="completed"&gt;Completed&lt;/option&gt;' +
            '&lt;/select&gt;' +
            '&lt;select id="enrolment-stage" aria-label="Current registration stage"&gt;' +
              '&lt;option value="ALL"&gt;All stages&lt;/option&gt;&lt;option value="student_not_started"&gt;Student not started&lt;/option&gt;' +
              '&lt;option value="student_form"&gt;Student completing form&lt;/option&gt;&lt;option value="returned_to_student"&gt;Returned to student&lt;/option&gt;' +
              '&lt;option value="administrators_office"&gt;Administrator\'s Office review&lt;/option&gt;&lt;option value="fees"&gt;Fees review&lt;/option&gt;' +
              '&lt;option value="accommodation"&gt;Accommodation&lt;/option&gt;&lt;option value="final_administration"&gt;Final administration&lt;/option&gt;&lt;option value="completed"&gt;Completed&lt;/option&gt;' +
            '&lt;/select&gt;' +
            '&lt;select id="enrolment-year" aria-label="Class year"&gt;&lt;option value="ALL"&gt;All classes&lt;/option&gt;&lt;option value="1"&gt;1st Year&lt;/option&gt;&lt;option value="2"&gt;2nd Year&lt;/option&gt;&lt;option value="3"&gt;3rd Year&lt;/option&gt;&lt;/select&gt;' +
          '&lt;/div&gt;' +
          '&lt;div class="table-wrap"&gt;&lt;table class="service-table"&gt;&lt;thead&gt;&lt;tr&gt;' +
            '&lt;th&gt;Student&lt;/th&gt;&lt;th&gt;Registration&lt;/th&gt;&lt;th&gt;Class&lt;/th&gt;&lt;th&gt;Status&lt;/th&gt;&lt;th&gt;Current stage&lt;/th&gt;&lt;th&gt;Stage progress&lt;/th&gt;&lt;th&gt;Last updated&lt;/th&gt;' +
          '&lt;/tr&gt;&lt;/thead&gt;&lt;tbody id="enrolment-rows"&gt;&lt;/tbody&gt;&lt;/table&gt;&lt;/div&gt;' +
        '&lt;/article&gt;';

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
    var admin = row.admin_office_complete ? "Admin Office ✓" : "Admin Office —";
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
        return '&lt;option value="' + esc(term.id) + '"&gt;' + esc(label) + '&lt;/option&gt;';
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
      return '&lt;div class="summary-card"&gt;&lt;strong&gt;' + esc(card[1]) + '&lt;/strong&gt;&lt;span&gt;' + esc(card[0]) + '&lt;/span&gt;&lt;/div&gt;';
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
      return '&lt;tr&gt;' +
        '&lt;td&gt;&lt;strong&gt;' + esc(row.student_name) + '&lt;/strong&gt;&lt;/td&gt;' +
        '&lt;td&gt;' + esc(row.registration_number) + '&lt;/td&gt;' +
        '&lt;td&gt;' + esc(row.class_year ? row.class_year + (row.class_year === 1 ? "st" : row.class_year === 2 ? "nd" : "rd") + " Year" : "—") + '&lt;/td&gt;' +
        '&lt;td&gt;&lt;span class="status-pill ' + statusClass(row) + '"&gt;' + esc(row.status_label || row.status) + '&lt;/span&gt;&lt;/td&gt;' +
        '&lt;td&gt;&lt;strong&gt;' + esc(row.stage_label || "—") + '&lt;/strong&gt;&lt;/td&gt;' +
        '&lt;td&gt;&lt;span class="service-secondary"&gt;' + esc(progressText(row)) + '&lt;/span&gt;&lt;/td&gt;' +
        '&lt;td&gt;' + esc(formatDateTime(row.updated_at || row.completed_at || row.student_submitted_at || row.student_started_at)) + '&lt;/td&gt;' +
      '&lt;/tr&gt;';
    }).join("") || '&lt;tr&gt;&lt;td colspan="7" class="empty-state"&gt;No registrations match these filters.&lt;/td&gt;&lt;/tr&gt;';
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
