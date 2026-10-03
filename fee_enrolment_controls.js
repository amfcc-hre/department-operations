(function () {
  "use strict";

  var feeClient = null;
  var feeData = null;
  var selected = new Set();
  var mounted = false;
  var loading = false;

  function session() {
    try { return JSON.parse(sessionStorage.getItem("amfcc_ops_session") || "null"); }
    catch (error) { return null; }
  }

  function allowed() {
    var s = session();
    return !!s && (
      s.role === "administrator" ||
      (s.role === "department" && s.department && s.department.slug === "administrators-office")
    );
  }

  function client() {
    if (feeClient) return feeClient;
    if (!window.supabase || !window.APP_CONFIG) return null;
    feeClient = window.supabase.createClient(
      window.APP_CONFIG.SUPABASE_URL,
      window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    return feeClient;
  }

  function node(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function money(value) {
    return "USD " + Number(value || 0).toFixed(2);
  }

  function statusText(row) {
    if (row.fee_status === "paid") return "PAID";
    if (row.fee_status === "arrears") return "ARREARS";
    return "NOT RECORDED";
  }

  function statusClass(row) {
    if (row.fee_status === "paid") return "green";
    if (row.fee_status === "arrears") return "amber";
    return "neutral";
  }

  function message(text, isError) {
    var box = document.getElementById("fee-enrolment-message");
    if (!box) return;
    box.textContent = text || "";
    box.style.color = isError ? "#9a2b25" : "#225c47";
  }

  function addStyles() {
    if (document.getElementById("fee-enrolment-style")) return;
    var style = document.createElement("style");
    style.id = "fee-enrolment-style";
    style.textContent =
      ".fee-enrolment-panel{margin-top:18px}" +
      ".fee-enrolment-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}" +
      ".fee-enrolment-toolbar input[type=search]{min-width:220px;flex:1 1 280px}" +
      ".fee-select-all{display:flex;align-items:center;gap:7px;font-weight:700}" +
      ".fee-select-all input,.fee-row-select{width:20px;min-height:20px}" +
      ".fee-name{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      ".fee-small{font-size:.82rem;color:#68776f}" +
      ".fee-dialog{border:0;border-radius:18px;max-width:680px;width:min(680px,calc(100% - 32px));padding:0;box-shadow:0 24px 80px rgba(0,0,0,.25)}" +
      ".fee-dialog::backdrop{background:rgba(5,24,17,.72)}" +
      ".fee-dialog-card{padding:22px}" +
      ".fee-dialog-head{display:flex;align-items:start;justify-content:space-between;gap:16px}" +
      ".fee-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0}" +
      ".fee-detail-grid>div{padding:10px;border:1px solid #dce4e1;border-radius:10px}" +
      ".fee-notice-text{white-space:pre-wrap;line-height:1.55;background:#f6f8f7;padding:14px;border-radius:10px}" +
      "@media(max-width:700px){.fee-detail-grid{grid-template-columns:1fr}.fee-enrolment-toolbar .button{width:100%}}";
    document.head.appendChild(style);
  }

  function ensureDialog() {
    var dialog = document.getElementById("fee-info-dialog");
    if (dialog) return dialog;

    dialog = node("dialog", "fee-dialog");
    dialog.id = "fee-info-dialog";

    var card = node("div", "fee-dialog-card");
    var head = node("div", "fee-dialog-head");
    var titleWrap = node("div");
    titleWrap.appendChild(node("p", "eyebrow", "Fee information"));
    var title = node("h2", null, "Student fee details");
    title.id = "fee-info-title";
    titleWrap.appendChild(title);

    var close = node("button", "button quiet", "Close");
    close.type = "button";
    close.addEventListener("click", function () { dialog.close(); });

    head.appendChild(titleWrap);
    head.appendChild(close);
    card.appendChild(head);

    var content = node("div");
    content.id = "fee-info-content";
    card.appendChild(content);
    dialog.appendChild(card);
    document.body.appendChild(dialog);
    return dialog;
  }

  function showInfo(row) {
    var dialog = ensureDialog();
    var content = document.getElementById("fee-info-content");
    content.replaceChildren();

    var grid = node("div", "fee-detail-grid");
    [
      ["Student", row.student_name || "—"],
      ["Registration", row.registration_number || "—"],
      ["Status", statusText(row)],
      ["Outstanding balance", money(row.outstanding_balance)],
      ["Registration email", row.student_email || "No registration email"],
      ["Last delivery", row.notice_last_delivery_status || "Not sent"]
    ].forEach(function (item) {
      var box = node("div");
      box.appendChild(node("strong", null, item[0]));
      box.appendChild(node("div", "fee-small", item[1]));
      grid.appendChild(box);
    });

    content.appendChild(grid);
    content.appendChild(node("h3", null, "Fee notice"));
    content.appendChild(node(
      "div",
      "fee-notice-text",
      row.notice_text || "No fee notice is available for this student."
    ));

    if (row.notice_last_sent_at) {
      content.appendChild(node(
        "p",
        "fee-small",
        "Last sent: " + new Date(row.notice_last_sent_at).toLocaleString()
      ));
    }

    dialog.showModal();
  }

  function reason(row) {
    if (row.fee_status === "paid") return "Fully paid";
    if (!row.student_email) return "No registration email";
    if (!row.notice_text) return "No notice available";
    return "Not eligible";
  }

  async function drainEmailQueue() {
    try {
      var c = client();
      if (c && c.functions && c.functions.invoke) {
        await c.functions.invoke("pass-email-worker", { body: { action: "drain" } });
      }
    } catch (error) {
      console.warn("Notice queued but immediate email drain could not be started.", error);
    }
  }

  async function send(ids) {
    if (!ids || !ids.length) {
      message("Select at least one eligible student.", true);
      return;
    }

    if (!window.confirm(
      "Send the individual fee notice to " + ids.length + " selected student" +
      (ids.length === 1 ? "" : "s") + "?"
    )) return;

    var s = session();
    var c = client();
    if (!s || !s.session_token || !c) {
      message("Your session is unavailable. Sign in again.", true);
      return;
    }

    message("Queueing fee notice" + (ids.length === 1 ? "" : "s") + "…", false);

    var response = await c.rpc("ops_send_fee_notices", {
      p_session_token: s.session_token,
      p_registration_ids: ids
    });

    if (response.error || !response.data || response.data.status !== "success") {
      message(
        (response.error && response.error.message) ||
        (response.data && response.data.message) ||
        "Fee notices could not be queued.",
        true
      );
      return;
    }

    if (Number(response.data.queued || 0) > 0) await drainEmailQueue();

    selected.clear();
    message(response.data.message || "Fee notices queued.", false);
    await load();
  }

  function visibleEligibleRows() {
    var search = String((document.getElementById("fee-enrolment-search") || {}).value || "")
      .trim().toLowerCase();

    return ((feeData && feeData.registrations) || []).filter(function (row) {
      var haystack = (String(row.student_name || "") + " " + String(row.registration_number || "")).toLowerCase();
      return (!search || haystack.indexOf(search) >= 0) && row.send_eligible;
    });
  }

  function syncSelectAll() {
    var all = document.getElementById("fee-enrolment-select-all");
    if (!all) return;

    var eligible = visibleEligibleRows();
    var selectedCount = eligible.filter(function (row) {
      return selected.has(row.registration_id);
    }).length;

    all.checked = eligible.length > 0 && selectedCount === eligible.length;
    all.indeterminate = selectedCount > 0 && selectedCount < eligible.length;
  }

  function render() {
    var body = document.getElementById("fee-enrolment-rows");
    if (!body || !feeData) return;

    body.replaceChildren();
    var search = String((document.getElementById("fee-enrolment-search") || {}).value || "")
      .trim().toLowerCase();

    var rows = (feeData.registrations || []).filter(function (row) {
      var haystack = (String(row.student_name || "") + " " + String(row.registration_number || "")).toLowerCase();
      return !search || haystack.indexOf(search) >= 0;
    });

    rows.forEach(function (row) {
      var tr = node("tr");

      var selectCell = node("td");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "fee-row-select";
      checkbox.disabled = !row.send_eligible;
      checkbox.checked = selected.has(row.registration_id);
      checkbox.setAttribute("aria-label", "Select " + (row.student_name || "student"));
      checkbox.addEventListener("change", function () {
        if (checkbox.checked) selected.add(row.registration_id);
        else selected.delete(row.registration_id);
        syncSelectAll();
      });
      selectCell.appendChild(checkbox);
      tr.appendChild(selectCell);

      var nameCell = node("td");
      var nameWrap = node("div", "fee-name");
      nameWrap.appendChild(node("strong", null, row.student_name || "—"));
      nameWrap.appendChild(node("span", "status-pill " + statusClass(row), statusText(row)));
      nameCell.appendChild(nameWrap);
      tr.appendChild(nameCell);

      tr.appendChild(node("td", null, row.registration_number || "—"));

      var feeCell = node("td");
      feeCell.appendChild(node("strong", null, money(row.outstanding_balance)));
      feeCell.appendChild(node("br"));
      var info = node("button", "button secondary", "Fee information");
      info.type = "button";
      info.addEventListener("click", function () { showInfo(row); });
      feeCell.appendChild(info);
      tr.appendChild(feeCell);

      tr.appendChild(node("td", null, row.student_email || "No registration email"));

      var noticeCell = node("td");
      if (row.send_eligible) {
        var sendButton = node("button", "button primary", "Send notice");
        sendButton.type = "button";
        sendButton.addEventListener("click", function () {
          send([row.registration_id]);
        });
        noticeCell.appendChild(sendButton);
      } else {
        noticeCell.appendChild(node("span", "fee-small", reason(row)));
      }
      tr.appendChild(noticeCell);

      body.appendChild(tr);
    });

    if (!rows.length) {
      var empty = node("tr");
      var cell = node("td", "empty-state", "No students match this search.");
      cell.colSpan = 6;
      empty.appendChild(cell);
      body.appendChild(empty);
    }

    syncSelectAll();
  }

  async function load() {
    if (loading || !allowed()) return;
    var panel = document.getElementById("fee-enrolment-panel");
    if (!panel) return;

    var s = session();
    var c = client();
    if (!s || !s.session_token || !c) return;

    loading = true;
    message("Loading fee information…", false);

    try {
      var term = document.getElementById("enrolment-term");
      var termId = term && Number(term.value) ? Number(term.value) : null;

      var response = await c.rpc("ops_fee_dashboard", {
        p_session_token: s.session_token,
        p_term_id: termId
      });

      if (response.error || !response.data || response.data.status !== "success") {
        throw new Error(
          (response.error && response.error.message) ||
          (response.data && response.data.message) ||
          "Fee information could not be loaded."
        );
      }

      feeData = response.data;
      selected.clear();
      render();
      message(
        "Fee information loaded. Nothing is sent unless you click Send notice or Send selected notices.",
        false
      );
    } catch (error) {
      message(error.message || "Fee information could not be loaded.", true);
    } finally {
      loading = false;
    }
  }

  function mount() {
    if (!allowed()) return;

    var view = document.getElementById("view-enrolment");
    if (!view) return;

    if (mounted && document.getElementById("fee-enrolment-panel")) return;
    mounted = true;

    addStyles();
    ensureDialog();

    var panel = node("article", "panel fee-enrolment-panel");
    panel.id = "fee-enrolment-panel";

    var heading = node("div", "panel-heading");
    var headingText = node("div");
    headingText.appendChild(node("h3", null, "Fee information and notices"));
    headingText.appendChild(node(
      "p",
      null,
      "Manage fee information here. Notices are manual only. Fully paid students cannot receive arrears notices, and the email address comes only from the submitted registration form."
    ));
    heading.appendChild(headingText);

    var refresh = node("button", "button secondary", "Refresh fees");
    refresh.type = "button";
    refresh.addEventListener("click", load);
    heading.appendChild(refresh);
    panel.appendChild(heading);

    var toolbar = node("div", "fee-enrolment-toolbar");

    var search = document.createElement("input");
    search.type = "search";
    search.id = "fee-enrolment-search";
    search.placeholder = "Search student or registration number";
    search.addEventListener("input", render);
    toolbar.appendChild(search);

    var selectLabel = node("label", "fee-select-all");
    var selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.id = "fee-enrolment-select-all";
    selectAll.addEventListener("change", function () {
      visibleEligibleRows().forEach(function (row) {
        if (selectAll.checked) selected.add(row.registration_id);
        else selected.delete(row.registration_id);
      });
      render();
    });
    selectLabel.appendChild(selectAll);
    selectLabel.appendChild(document.createTextNode(" Select all eligible"));
    toolbar.appendChild(selectLabel);

    var sendSelected = node("button", "button primary", "Send selected notices");
    sendSelected.type = "button";
    sendSelected.addEventListener("click", function () {
      send(Array.from(selected));
    });
    toolbar.appendChild(sendSelected);

    panel.appendChild(toolbar);

    var msg = node("div");
    msg.id = "fee-enrolment-message";
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    panel.appendChild(msg);

    var wrap = node("div", "table-wrap");
    var table = node("table", "service-table");
    var thead = node("thead");
    var header = node("tr");
    ["Select", "Student", "Registration", "Fee information", "Registration email", "Notice"].forEach(function (label) {
      header.appendChild(node("th", null, label));
    });
    thead.appendChild(header);
    table.appendChild(thead);

    var tbody = node("tbody");
    tbody.id = "fee-enrolment-rows";
    table.appendChild(tbody);
    wrap.appendChild(table);
    panel.appendChild(wrap);

    view.appendChild(panel);
    load();
  }

  function start() {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (document.getElementById("view-enrolment")) {
        mount();
        var term = document.getElementById("enrolment-term");
        if (term && !term.dataset.feeBound) {
          term.dataset.feeBound = "1";
          term.addEventListener("change", function () { setTimeout(load, 0); });
        }
      }
      if (attempts >= 120) clearInterval(timer);
    }, 500);

    document.addEventListener("click", function (event) {
      var tab = event.target && event.target.closest && event.target.closest('[data-view="enrolment"]');
      if (tab) setTimeout(function () { mount(); load(); }, 100);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
