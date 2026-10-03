
window.APP_CONFIG = {
  SUPABASE_URL: "https://sanabhuogxfpjstftoxt.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_X-FDnWgR8gUPFG05guHdCA_gijXfw4f",
};

(function () {
  if (document.body && document.body.dataset.itRegister) return;

  var feeState = {
    client: null,
    data: null,
    selected: new Set(),
    loading: false
  };

  function openTag(name) {
    return String.fromCharCode(60) + name;
  }

  function normalizeElement(node) {
    try {
      if (!node || node.nodeType !== 1) return;

      var raw = node.textContent || "";
      var close = String.fromCharCode(62);

      if (
        node.id === "view-enrolment" &&
        !node.querySelector("#enrolment-refresh") &&
        raw.indexOf(openTag('div class="view-heading"') + close) !== -1 &&
        raw.indexOf('id="enrolment-rows"') !== -1
      ) {
        node.innerHTML = raw;
      }

      if (
        node.id === "enrolment-term" &&
        raw.indexOf(openTag("option") ) !== -1
      ) {
        node.innerHTML = raw;
      }

      if (
        node.id === "enrolment-summary" &&
        raw.indexOf(openTag('div class="summary-card"')) !== -1
      ) {
        node.innerHTML = raw;
      }

      if (
        node.id === "enrolment-rows" &&
        raw.indexOf(openTag("tr")) !== -1
      ) {
        node.innerHTML = raw;
      }

      if (node.id === "view-enrolment") {
        var intro = node.querySelector(".view-heading .muted");
        if (intro && intro.textContent.indexOf("read-only") !== -1) {
          intro.textContent = "Track and manage every student through the term registration workflow.";
        }
      }
    } catch (error) {
      if (window.console) console.error("Term enrolment markup repair failed.", error);
    }
  }

  function normalizeTree(node) {
    if (!node || node.nodeType !== 1) return;
    normalizeElement(node);
    ["view-enrolment","enrolment-term","enrolment-summary","enrolment-rows"].forEach(function (id) {
      var child = node.querySelector && node.querySelector("#" + id);
      if (child) normalizeElement(child);
    });
  }

  var originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, referenceNode) {
    normalizeTree(newNode);
    return originalInsertBefore.call(this, newNode, referenceNode);
  };

  var originalAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function (newNode) {
    normalizeTree(newNode);
    return originalAppendChild.call(this, newNode);
  };

  function getSession() {
    try {
      return JSON.parse(sessionStorage.getItem("amfcc_ops_session") || "null");
    } catch (error) {
      return null;
    }
  }

  function canManageFees() {
    var session = getSession();
    return !!session && (
      session.role === "administrator" ||
      (
        session.role === "department" &&
        session.department &&
        session.department.slug === "administrators-office"
      )
    );
  }

  function getClient() {
    if (feeState.client) return feeState.client;
    if (!window.supabase || !window.APP_CONFIG) return null;
    feeState.client = window.supabase.createClient(
      window.APP_CONFIG.SUPABASE_URL,
      window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    return feeState.client;
  }

  function create(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function money(value) {
    return "USD " + Number(value || 0).toFixed(2);
  }

  function feeStatus(row) {
    if (row.fee_status === "paid") return "PAID";
    if (row.fee_status === "arrears") return "ARREARS";
    return "NOT RECORDED";
  }

  function setFeeMessage(text, error) {
    var box = document.getElementById("fee-enrolment-message");
    if (!box) return;
    box.textContent = text || "";
    box.className = error ? "fee-enrolment-message error" : "fee-enrolment-message";
  }

  function addStyles() {
    if (document.getElementById("fee-enrolment-styles")) return;
    var style = document.createElement("style");
    style.id = "fee-enrolment-styles";
    style.textContent =
      ".fee-enrolment-panel{margin-top:18px}" +
      ".fee-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:14px 0}" +
      ".fee-toolbar input[type=search]{min-width:240px;flex:1 1 280px}" +
      ".fee-select-all{display:flex;align-items:center;gap:7px;font-weight:800}" +
      ".fee-select-all input,.fee-row-check{width:20px;min-height:20px}" +
      ".fee-table{min-width:930px;width:100%;border-collapse:collapse}" +
      ".fee-table th,.fee-table td{padding:10px;border-bottom:1px solid #dce4e1;text-align:left;vertical-align:top}" +
      ".fee-student{display:flex;flex-wrap:wrap;gap:8px;align-items:center}" +
      ".fee-status{border:0;border-radius:999px;padding:5px 9px;font-size:.74rem;font-weight:900}" +
      ".fee-status.paid{background:#dff3e7;color:#175a35}" +
      ".fee-status.arrears{background:#f8dedb;color:#742925}" +
      ".fee-status.not-recorded{background:#edf1ee;color:#485a50}" +
      ".fee-actions{display:flex;flex-wrap:wrap;gap:7px}" +
      ".fee-muted{color:#66776f;font-size:.82rem}" +
      ".fee-enrolment-message{min-height:22px;color:#175a35;font-weight:750}" +
      ".fee-enrolment-message.error{color:#8a2522}" +
      ".fee-modal{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:18px;background:rgba(7,30,20,.72)}" +
      ".fee-modal[hidden]{display:none}" +
      ".fee-modal-card{position:relative;width:min(680px,100%);max-height:90vh;overflow:auto;padding:24px;border-radius:18px;background:#fff}" +
      ".fee-modal-close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.8rem}" +
      ".fee-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0}" +
      ".fee-detail-grid div{padding:10px;border:1px solid #dce4e1;border-radius:10px}" +
      ".fee-notice-copy{white-space:pre-wrap;line-height:1.55;padding:14px;border-radius:10px;background:#f6f8f7}" +
      "@media(max-width:680px){.fee-detail-grid{grid-template-columns:1fr}.fee-toolbar{align-items:stretch}.fee-toolbar .button{width:100%}}";
    document.head.appendChild(style);
  }

  function ensureFeeModal() {
    if (document.getElementById("fee-info-modal")) return;
    var modal = create("div", "fee-modal");
    modal.id = "fee-info-modal";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    var card = create("div", "fee-modal-card");
    var closeButton = create("button", "fee-modal-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.addEventListener("click", function () { modal.hidden = true; });

    var eyebrow = create("p", "eyebrow", "Fee information");
    var heading = create("h2", null, "Student fee details");
    heading.id = "fee-info-heading";
    modal.setAttribute("aria-labelledby", "fee-info-heading");

    var content = create("div");
    content.id = "fee-info-content";

    card.appendChild(closeButton);
    card.appendChild(eyebrow);
    card.appendChild(heading);
    card.appendChild(content);
    modal.appendChild(card);

    modal.addEventListener("click", function (event) {
      if (event.target === modal) modal.hidden = true;
    });

    document.body.appendChild(modal);
  }

  function showFeeInfo(row) {
    ensureFeeModal();
    var content = document.getElementById("fee-info-content");
    while (content.firstChild) content.removeChild(content.firstChild);

    var grid = create("div", "fee-detail-grid");
    [
      ["Student", row.student_name || "—"],
      ["Registration", row.registration_number || "—"],
      ["Status", feeStatus(row)],
      ["Outstanding balance", money(row.outstanding_balance)],
      ["Registration email", row.student_email || "No registration email"],
      ["Last notice", row.notice_last_delivery_status || "Not sent"]
    ].forEach(function (item) {
      var box = create("div");
      box.appendChild(create("strong", null, item[0]));
      box.appendChild(create("div", "fee-muted", item[1]));
      grid.appendChild(box);
    });

    content.appendChild(grid);
    content.appendChild(create("h3", null, "Notice"));
    content.appendChild(create("div", "fee-notice-copy", row.notice_text || "No fee notice is available for this student."));
    document.getElementById("fee-info-modal").hidden = false;
  }

  function ineligibleReason(row) {
    if (row.fee_status === "paid") return "Fully paid";
    if (!row.student_email) return "No registration email";
    if (!row.notice_text) return "No notice available";
    return "Not eligible to send";
  }

  async function invokeDrain() {
    try {
      var client = getClient();
      if (client && client.functions && client.functions.invoke) {
        await client.functions.invoke("pass-email-worker", { body: { action: "drain" } });
      }
    } catch (error) {
      if (window.console) console.warn("Fee notice queued; immediate email drain could not be started.", error);
    }
  }

  async function sendFeeNotices(ids) {
    if (!ids || !ids.length) {
      setFeeMessage("Select at least one student who is in arrears and has a registration email.", true);
      return;
    }

    if (!window.confirm("Send the individual fee notice to " + ids.length + " selected student" + (ids.length === 1 ? "" : "s") + "?")) return;

    var session = getSession();
    var client = getClient();
    if (!session || !session.session_token || !client) {
      setFeeMessage("Your session is not available. Sign in again.", true);
      return;
    }

    setFeeMessage("Queueing fee notice" + (ids.length === 1 ? "" : "s") + "…", false);

    var response = await client.rpc("ops_send_fee_notices", {
      p_session_token: session.session_token,
      p_registration_ids: ids
    });

    if (response.error || !response.data || response.data.status !== "success") {
      setFeeMessage(response.error && response.error.message || response.data && response.data.message || "Fee notices could not be queued.", true);
      return;
    }

    if (Number(response.data.queued || 0) > 0) {
      await invokeDrain();
    }

    feeState.selected.clear();
    setFeeMessage(response.data.message || "Fee notices queued.", false);
    await loadFees();
  }

  function renderFees() {
    var body = document.getElementById("fee-enrolment-rows");
    if (!body || !feeState.data) return;

    while (body.firstChild) body.removeChild(body.firstChild);

    var search = String((document.getElementById("fee-enrolment-search") || {}).value || "").trim().toLowerCase();
    var rows = feeState.data.registrations || [];

    rows.filter(function (row) {
      if (!search) return true;
      return (String(row.student_name || "") + " " + String(row.registration_number || "")).toLowerCase().indexOf(search) !== -1;
    }).forEach(function (row) {
      var tr = create("tr");

      var checkCell = create("td");
      var check = document.createElement("input");
      check.type = "checkbox";
      check.className = "fee-row-check";
      check.disabled = !row.send_eligible;
      check.checked = feeState.selected.has(row.registration_id);
      check.setAttribute("aria-label", "Select " + (row.student_name || "student"));
      check.addEventListener("change", function () {
        if (check.checked) feeState.selected.add(row.registration_id);
        else feeState.selected.delete(row.registration_id);
        syncSelectAll();
      });
      checkCell.appendChild(check);
      tr.appendChild(checkCell);

      var studentCell = create("td");
      var studentWrap = create("div", "fee-student");
      studentWrap.appendChild(create("strong", null, row.student_name || "—"));
      var status = create("button", "fee-status " + (row.fee_status || "not-recorded"), feeStatus(row));
      status.type = "button";
      status.disabled = true;
      studentWrap.appendChild(status);
      studentCell.appendChild(studentWrap);
      tr.appendChild(studentCell);

      tr.appendChild(create("td", null, row.registration_number || "—"));

      var infoCell = create("td");
      infoCell.appendChild(create("strong", null, money(row.outstanding_balance)));
      infoCell.appendChild(create("div", "fee-muted", row.payment_plan || ""));
      var infoButton = create("button", "button secondary", "Fee information");
      infoButton.type = "button";
      infoButton.addEventListener("click", function () { showFeeInfo(row); });
      infoCell.appendChild(infoButton);
      tr.appendChild(infoCell);

      tr.appendChild(create("td", null, row.student_email || "No registration email"));

      var noticeCell = create("td");
      if (row.send_eligible) {
        var sendButton = create("button", "button primary", "Send notice");
        sendButton.type = "button";
        sendButton.addEventListener("click", function () { sendFeeNotices([row.registration_id]); });
        noticeCell.appendChild(sendButton);
      } else {
        noticeCell.appendChild(create("span", "fee-muted", ineligibleReason(row)));
      }
      tr.appendChild(noticeCell);

      body.appendChild(tr);
    });

    if (!body.firstChild) {
      var empty = create("tr");
      var cell = create("td", "empty-state", "No students match this search.");
      cell.colSpan = 6;
      empty.appendChild(cell);
      empty.appendChild(empty);
    }

    syncSelectAll();
  }

  function eligibleVisibleRows() {
    var search = String((document.getElementById("fee-enrolment-search") || {}).value || "").trim().toLowerCase();
    return (feeState.data && feeState.data.registrations || []).filter(function (row) {
      var matches = !search || (String(row.student_name || "") + " " + String(row.registration_number || "")).toLowerCase().indexOf(search) !== -1;
      return matches && row.send_eligible;
    });
  }

  function syncSelectAll() {
    var box = document.getElementById("fee-enrolment-select-all");
    if (!box) return;
    var eligible = eligibleVisibleRows();
    box.checked = eligible.length > 0 && eligible.every(function (row) { return feeState.selected.has(row.registration_id); });
    box.indeterminate = eligible.some(function (row) { return feeState.selected.has(row.registration_id); }) && !box.checked;
  }

  async function loadFees() {
    if (feeState.loading || !canManageFees()) return;
    var panel = document.getElementById("fee-enrolment-panel");
    if (!panel) return;

    var session = getSession();
    var client = getClient();
    if (!session || !session.session_token || !client) return;

    feeState.loading = true;
    setFeeMessage("Loading fee information…", false);

    try {
      var termSelect = document.getElementById("enrolment-term");
      var termId = termSelect && Number(termSelect.value) ? Number(termSelect.value) : null;
      var response = await client.rpc("ops_fee_dashboard", {
        p_session_token: session.session_token,
        p_term_id: termId
      });

      if (response.error || !response.data || response.data.status !== "success") {
        throw new Error(response.error && response.error.message || response.data && response.data.message || "Fee information could not be loaded.");
      }

      feeState.data = response.data;
      feeState.selected.clear();
      renderFees();
      setFeeMessage("Fee information loaded. Notices are only sent when you click Send notice or Send selected notices.", false);
    } catch (error) {
      setFeeMessage(error.message || "Fee information could not be loaded.", true);
    } finally {
      feeState.loading = false;
    }
  }

  function ensureFeePanel() {
    if (!canManageFees()) return;

    var view = document.getElementById("view-enrolment");
    if (!view || document.getElementById("fee-enrolment-panel")) return;

    addStyles();
    ensureFeeModal();

    var panel = create("article", "panel fee-enrolment-panel");
    panel.id = "fee-enrolment-panel";

    var heading = create("div", "panel-heading");
    var headingText = create("div");
    headingText.appendChild(create("h3", null, "Fee information and notices"));
    headingText.appendChild(create("p", null, "Manage Term 3 fee information here. Notices are manual only. Fully paid students cannot be sent arrears notices, and student email comes only from the submitted registration form."));
    heading.appendChild(headingText);

    var refresh = create("button", "button secondary", "Refresh fees");
    refresh.type = "button";
    refresh.addEventListener("click", loadFees);
    heading.appendChild(refresh);
    panel.appendChild(heading);

    var toolbar = create("div", "fee-toolbar");

    var search = document.createElement("input");
    search.type = "search";
    search.id = "fee-enrolment-search";
    search.placeholder = "Search student or registration number";
    search.addEventListener("input", renderFees);
    toolbar.appendChild(search);

    var selectLabel = create("label", "fee-select-all");
    var selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.id = "fee-enrolment-select-all";
    selectAll.addEventListener("change", function () {
      eligibleVisibleRows().forEach(function (row) {
        if (selectAll.checked) feeState.selected.add(row.registration_id);
        else feeState.selected.delete(row.registration_id);
      });
      renderFees();
    });
    selectLabel.appendChild(selectAll);
    selectLabel.appendChild(document.createTextNode(" Select all eligible"));
    toolbar.appendChild(selectLabel);

    var sendSelected = create("button", "button primary", "Send selected notices");
    sendSelected.type = "button";
    sendSelected.addEventListener("click", function () {
      sendFeeNotices(Array.from(feeState.selected));
    });
    toolbar.appendChild(sendSelected);

    panel.appendChild(toolbar);

    var message = create("div", "fee-enrolment-message");
    message.id = "fee-enrolment-message";
    panel.appendChild(message);

    var wrap = create("div", "table-wrap");
    var table = create("table", "fee-table");
    var thead = create("thead");
    var headRow = create("tr");
    ["Select","Student","Registration","Fee information","Registration email","Notice"].forEach(function (label) {
      headRow.appendChild(create("th", null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = create("tbody");
    tbody.id = "fee-enrolment-rows";
    table.appendChild(tbody);
    wrap.appendChild(table);
    panel.appendChild(wrap);

    view.appendChild(panel);
    loadFees();
  }

  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      normalizeElement(mutation.target);
      Array.prototype.forEach.call(mutation.addedNodes || [], normalizeTree);
    });
    ensureFeePanel();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  var script = document.createElement("script");
  script.src = "enrolment_tracking.js?v=4";
  script.async = false;
  document.head.appendChild(script);

  document.addEventListener("click", function (event) {
    var tab = event.target && event.target.closest && event.target.closest('[data-view="enrolment"]');
    if (tab) {
      setTimeout(function () {
        normalizeTree(document.getElementById("view-enrolment"));
        ensureFeePanel();
        loadFees();
      }, 100);
    }
  });

  setTimeout(function () {
    normalizeTree(document.getElementById("view-enrolment"));
    ensureFeePanel();
  }, 500);
})();
