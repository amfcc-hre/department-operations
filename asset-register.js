(function () {
  "use strict";
  var api, mounted = false, items = [], canWrite = false, loaded = false, loading = false;
  var epoch = 0, busy = new Set(), editing = null, savingForm = false, refreshQueued = false, timer = null;
  var fields = ["description", "asset_tag_id", "quantity", "status", "site", "location", "brand", "category", "model", "serial_no", "minimum_stock"];
  var filters = ["category", "site", "location", "status", "stock"];
  var fieldIds = { description: "asset-description", asset_tag_id: "asset-tag", quantity: "asset-quantity", status: "asset-status", site: "asset-site", location: "asset-location", brand: "asset-brand", category: "asset-category", model: "asset-model", serial_no: "asset-serial", minimum_stock: "asset-minimum" };
  function el(id) { return document.getElementById(id); }
  function html(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function value(id) { return el(id).value.trim(); }
  function number(value) { return Number(value).toLocaleString(); }
  function allowed() {
    var session = api && api.getSession();
    return !!session && (session.role === "management" || session.role === "administrator" || (session.role === "department" && session.department && session.department.slug === "it-department"));
  }
  function active() { return el("view-assets").classList.contains("active") && allowed(); }
  function level(item) { return item.quantity === 0 ? "out" : item.minimum_stock != null && item.quantity <= item.minimum_stock ? "low" : "healthy"; }
  function levelLabel(item) { return { out: "Out of stock", low: "Low stock", healthy: "In stock" }[level(item)]; }
  function message(text, error) {
    var node = el("asset-message");
    node.textContent = text || ""; node.hidden = !text; node.classList.toggle("error", !!error);
  }
  function findItem(id) { return items.find(function (item) { return item.id === id; }); }
  function validNumber(raw, nullable) {
    if (raw === "") return !!nullable;
    return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= 2147483647;
  }
  function totals() {
    return items.reduce(function (s, item) { s.units += item.quantity; s[level(item)] += 1; return s; }, { units: 0, low: 0, out: 0, healthy: 0 });
  }
  function filteredItems() {
    var terms = value("asset-search").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    var selected = {};
    filters.forEach(function (key) { selected[key] = value("asset-filter-" + key); });
    var result = items.filter(function (item) {
      var haystack = fields.map(function (key) { return item[key] == null ? "" : item[key]; }).join(" ").toLocaleLowerCase();
      if (!terms.every(function (term) { return haystack.indexOf(term) >= 0; })) return false;
      for (var i = 0; i < 4; i++) {
        var key = filters[i], wanted = selected[key];
        if (wanted && (wanted === "__blank__" ? !!item[key] : item[key] !== wanted)) return false;
      }
      var stock = level(item);
      return !selected.stock || (selected.stock === "attention" ? stock !== "healthy" : stock === selected.stock);
    });
    var sort = value("asset-sort");
    result.sort(function (a, b) {
      var delta = sort === "quantity-asc" ? a.quantity - b.quantity : sort === "quantity-desc" ? b.quantity - a.quantity : sort === "updated" ? String(b.updated_at).localeCompare(String(a.updated_at)) : 0;
      return delta || a.description.localeCompare(b.description) || a.id.localeCompare(b.id);
    });
    return result;
  }
  function options() {
    ["category", "site", "location", "status"].forEach(function (key) {
      var node = el("asset-filter-" + key), previous = node.value;
      var first = { category: "All categories", site: "All sites", location: "All locations", status: "All statuses" }[key];
      var choices = Array.from(new Set(items.map(function (item) { return item[key]; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b); });
      node.innerHTML = '<option value="">' + first + '</option>' + choices.map(function (choice) { return '<option value="' + html(choice) + '">' + html(choice) + '</option>'; }).join("");
      var blanks = items.filter(function (item) { return !item[key]; }).length;
      if (blanks) node.insertAdjacentHTML("beforeend", '<option value="__blank__">Not specified (' + number(blanks) + ')</option>');
      node.value = previous;
      if (node.selectedIndex < 0) node.value = "";
    });
    ["status", "site", "location", "brand", "category"].forEach(function (key) {
      var choices = items.map(function (item) { return item[key]; }).filter(Boolean);
      if (key === "status") choices = choices.concat(["Available", "In use", "Under repair", "Retired"]);
      if (key === "site") choices.push("IT Store");
      el("asset-" + key + "-options").innerHTML = Array.from(new Set(choices)).sort().map(function (choice) { return '<option value="' + html(choice) + '"></option>'; }).join("");
    });
  }
  function renderGroups(key, target) {
    var groups = {};
    items.forEach(function (item) { var name = item[key] || "Not specified"; if (!groups[name]) groups[name] = { count: 0, units: 0, attention: 0 }; groups[name].count++; groups[name].units += item.quantity; groups[name].attention += level(item) !== "healthy" ? 1 : 0; });
    var names = Object.keys(groups).sort(function (a, b) { return groups[b].units - groups[a].units || a.localeCompare(b); });
    var max = Math.max.apply(null, names.map(function (name) { return groups[name].units; }).concat([1]));
    el(target).innerHTML = names.map(function (name) {
      var group = groups[name];
      return '<button type="button" class="asset-group" data-group="' + key + '" data-value="' + html(name === "Not specified" ? "__blank__" : name) + '"><span>' + html(name) + '<small>' + number(group.count) + ' entries' + (group.attention ? ' · ' + number(group.attention) + ' need attention' : '') + '</small><span class="asset-group-bar" style="width:' + Math.max(1, group.units / max * 100) + '%"></span></span><strong>' + number(group.units) + ' units</strong></button>';
    }).join("") || '<p class="muted">No stock recorded.</p>';
  }
  function renderDashboard() {
    var counts = totals();
    el("asset-dashboard").innerHTML = [[items.length, "Asset entries", "", ""], [counts.units, "Units in stock", "", ""], [counts.low, "Low-stock entries", "warning", "low"], [counts.out, "Out-of-stock entries", "danger", "out"]].map(function (card) {
      return '<button type="button" class="asset-stat ' + (card[0] ? card[2] : '') + '" data-stock-filter="' + card[3] + '"><span>' + card[1] + '</span><strong>' + number(card[0]) + '</strong></button>';
    }).join("");
    var alerts = el("asset-alerts");
    alerts.hidden = !loaded || counts.low + counts.out === 0;
    alerts.innerHTML = '<strong>' + number(counts.low) + ' low-stock ' + (counts.low === 1 ? 'entry' : 'entries') + ' · ' + number(counts.out) + ' out of stock</strong><button type="button" class="button secondary" data-stock-filter="attention">View items needing attention</button>';
    el("asset-breakdown").hidden = !loaded;
    renderGroups("category", "asset-category-totals"); renderGroups("site", "asset-site-totals");
    el("asset-add").hidden = !canWrite || !loaded;
    el("asset-add").disabled = loading;
    el("asset-edit-help").hidden = !loaded;
    el("asset-edit-help").textContent = canWrite ? "Type a number or use ↑ / ↓. Changes save automatically. Blank minimum = low-stock alerts off." : "Read-only view. Sign in to the IT Department to update stock.";
  }
  function rowHtml(item) {
    var disabled = !canWrite || loading || busy.has(item.id), stock = level(item);
    var detail = ["brand", "model", "serial_no"].map(function (key) { return '<dt>' + { brand: "Brand", model: "Model", serial_no: "Serial No" }[key] + '</dt><dd>' + html(item[key] || "Not specified") + '</dd>'; }).join("");
    return '<div class="asset-row-info"><h3>' + html(item.description) + '</h3><p class="asset-id">Tag: ' + html(item.asset_tag_id || "Not assigned") + '</p><p>' + html(item.category || "No category") + ' · ' + html(item.status) + '</p><p><strong>Site:</strong> ' + html(item.site) + ' · <strong>Location:</strong> ' + html(item.location || "Not specified") + '</p><details><summary>Brand, model and serial number</summary><dl>' + detail + '</dl></details></div>' +
      '<div class="asset-stock-controls"><label class="asset-quantity-label" for="asset-qty-' + item.id + '">Quantity</label><div class="asset-stepper"><input id="asset-qty-' + item.id + '" class="asset-inline-number" data-id="' + item.id + '" data-field="quantity" type="number" inputmode="numeric" step="1" min="0" max="2147483647" value="' + item.quantity + '" aria-label="Quantity for ' + html(item.description) + '"' + (disabled ? ' disabled' : '') + '><div class="asset-step-arrows"><button class="asset-step" type="button" data-id="' + item.id + '" data-delta="1" aria-label="Increase stock for ' + html(item.description) + '"' + (disabled ? ' disabled' : '') + '>↑</button><button class="asset-step" type="button" data-id="' + item.id + '" data-delta="-1" aria-label="Decrease stock for ' + html(item.description) + '"' + (disabled || item.quantity === 0 ? ' disabled' : '') + '>↓</button></div></div>' +
      '<label class="asset-minimum-control" for="asset-min-' + item.id + '">Minimum<input id="asset-min-' + item.id + '" data-id="' + item.id + '" data-field="minimum_stock" type="number" inputmode="numeric" step="1" min="0" max="2147483647" value="' + (item.minimum_stock == null ? '' : item.minimum_stock) + '" placeholder="Off" aria-label="Minimum stock for ' + html(item.description) + '"' + (disabled ? ' disabled' : '') + '></label><div class="asset-row-save" role="status" aria-live="polite">' + (busy.has(item.id) ? 'Saving…' : '') + '</div></div>' +
      '<div class="asset-row-status"><span class="asset-level ' + stock + '">' + levelLabel(item) + '</span></div><button class="button secondary asset-row-action" type="button" data-edit="' + item.id + '"' + (busy.has(item.id) || loading ? ' disabled' : '') + '>' + (canWrite ? 'Edit details' : 'Details') + '</button>';
  }
  function renderList() {
    var list = el("asset-list"), result = filteredItems();
    list.setAttribute("aria-busy", String(loading));
    var applied = filters.filter(function (key) { return value("asset-filter-" + key); }).length;
    el("asset-filter-options").querySelector("summary").textContent = "Filters and sorting" + (applied ? " (" + applied + " applied)" : "");
    var focused = document.activeElement, focusId = focused && focused.id;
    var openDetails = new Set(Array.from(list.querySelectorAll("details[open]")).map(function (node) { return node.closest(".asset-row").dataset.id; }));
    if (!loaded) { list.innerHTML = '<div class="asset-empty">' + (loading ? 'Loading inventory…' : 'Stock could not be loaded. Select Refresh stock to try again.') + '</div>'; return; }
    var matches = new Set(result.map(function (item) { return item.id; }));
    Array.from(list.children).forEach(function (node) { if (!matches.has(node.dataset.id)) node.remove(); });
    result.forEach(function (item, index) {
      var row = el("asset-row-" + item.id), signature = JSON.stringify(item) + String(canWrite) + String(loading) + String(busy.has(item.id));
      if (!row) { row = document.createElement("article"); row.id = "asset-row-" + item.id; row.dataset.id = item.id; }
      if (row.dataset.signature !== signature) {
        row.className = "asset-row " + level(item); row.innerHTML = rowHtml(item); row.dataset.signature = signature;
        if (openDetails.has(item.id)) row.querySelector("details").open = true;
      }
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    });
    if (!result.length) list.innerHTML = '<div class="asset-empty">' + (items.length ? 'No assets match these filters. Clear filters to see all stock.' : 'No assets yet. Add the first asset to start the register.') + '</div>';
    el("asset-results-count").textContent = number(result.length) + ' of ' + number(items.length) + ' entries · ' + number(result.reduce(function (n, item) { return n + item.quantity; }, 0)) + ' units shown';
    if (focusId && document.activeElement === document.body && el(focusId) && !el(focusId).disabled) el(focusId).focus({ preventScroll: true });
    list.setAttribute("aria-busy", String(loading));
  }
  function render() { options(); renderDashboard(); renderList(); }
  function controlsBusy(id, saving) {
    var row = el("asset-row-" + id);
    if (!row) return;
    Array.from(row.querySelectorAll("input,button")).forEach(function (node) { node.disabled = saving || !canWrite || loading; });
    var down = row.querySelector('[data-delta="-1"]');
    if (down && !saving && findItem(id).quantity === 0) down.disabled = true;
    row.querySelector(".asset-row-save").textContent = saving ? "Saving…" : "";
  }
  async function refresh(silent) {
    if (!allowed() || loading) return;
    if (busy.size || savingForm) { refreshQueued = true; return; }
    // A live refresh must not replace an unfinished typed quantity.
    if (silent && document.activeElement && document.activeElement.matches('#asset-list input, #asset-form input')) return;
    var requestEpoch = epoch, session = api.getSession();
    loading = true; el("asset-refresh").disabled = true; el("asset-refresh").textContent = "Loading…";
    el("asset-list").setAttribute("aria-busy", "true");
    renderDashboard(); renderList();
    try {
      var result = await api.rpc("ops_it_assets_bootstrap", { p_session_token: session.session_token });
      if (epoch !== requestEpoch || !allowed()) return;
      if (!result || result.status !== "success") throw new Error(result && result.message || "Could not load inventory.");
      items = result.items || []; canWrite = !!result.can_write; loaded = true;
      el("asset-last-refreshed").textContent = "Last refreshed: " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (!silent) message("");
    } catch (error) {
      if (epoch === requestEpoch) message((loaded ? "Stock refresh failed. The last loaded quantities are shown. " : "Inventory could not be loaded. ") + (error.message || "Try again."), true);
    } finally {
      if (epoch === requestEpoch) {
        loading = false; el("asset-refresh").disabled = false; el("asset-refresh").textContent = "Refresh stock"; render();
      }
    }
  }
  function updateItem(item) {
    var index = items.findIndex(function (existing) { return existing.id === item.id; });
    if (index < 0) items.push(item); else items[index] = item;
  }
  async function command(action, payload) {
    var session = api.getSession();
    if (!allowed() || !canWrite || !session) throw new Error("Sign in to the IT Department to update stock.");
    var requestEpoch = epoch;
    var result = await api.rpc("ops_it_assets_command", { p_session_token: session.session_token, p_action: action, p_payload: payload });
    if (requestEpoch !== epoch || !allowed()) return null;
    if (result && result.item) updateItem(result.item);
    if (!result || result.status !== "success") {
      var error = new Error(result && result.message || "The change could not be saved."); error.conflict = result && result.status === "conflict"; throw error;
    }
    return result.item;
  }
  async function updateStock(id, action, raw) {
    var item = findItem(id);
    if (!item || !canWrite || loading || busy.has(id) || savingForm) return;
    var payload = { id: id, expected_revision: item.revision }, field = action === "set_minimum" ? "minimum_stock" : "quantity";
    if (action === "adjust_quantity") payload.delta = Number(raw);
    else {
      if (!validNumber(String(raw), field === "minimum_stock")) {
        message(field === "quantity" ? "Quantity was not saved. Enter a whole number of zero or more." : "Minimum was not saved. Enter a whole number of zero or more, or leave it blank.", true);
        var input = el((field === "quantity" ? "asset-qty-" : "asset-min-") + id);
        input.value = item[field] == null ? "" : item[field]; return;
      }
      payload[field] = raw === "" ? null : Number(raw);
      if (payload[field] === item[field]) return;
    }
    var requestEpoch = epoch;
    busy.add(id); controlsBusy(id, true);
    try {
      var updated = await command(action, payload);
      if (updated) message((action === "set_minimum" ? "Minimum saved for " : "Stock saved for ") + updated.description + ": " + (action === "set_minimum" ? updated.minimum_stock == null ? "alerts off" : number(updated.minimum_stock) : number(updated.quantity)) + ".");
    } catch (error) {
      if (epoch === requestEpoch) message((error.conflict ? "" : "Change was not saved. ") + (error.message || "Try again."), true);
    } finally {
      if (epoch === requestEpoch) {
        busy.delete(id);
        var row = el("asset-row-" + id); if (row) delete row.dataset.signature;
        render();
        if (!busy.size && refreshQueued) { refreshQueued = false; refresh(true); }
      }
    }
  }
  function clearFilters() {
    el("asset-search").value = ""; filters.forEach(function (key) { el("asset-filter-" + key).value = ""; });
  }
  function closeDialog() { if (!savingForm) { el("asset-dialog").close(); editing = null; } }
  function openEditor(id) {
    if (!loaded || loading || busy.size || savingForm) return;
    var item = id ? findItem(id) : { description: "", asset_tag_id: "", quantity: 0, status: "Available", site: "IT Store", location: "", brand: "", category: "", model: "", serial_no: "", minimum_stock: 2 };
    if (!item) return;
    editing = Object.assign({}, item);
    fields.forEach(function (key) { el(fieldIds[key]).value = item[key] == null ? "" : item[key]; el(fieldIds[key]).readOnly = !canWrite; });
    el("asset-dialog-title").textContent = id ? (canWrite ? "Edit asset details" : "Asset details") : "Add asset";
    el("asset-save").hidden = !canWrite; el("asset-form-error").hidden = true;
    el("asset-dialog").showModal(); el("asset-description").focus();
  }
  async function saveEditor(event) {
    event.preventDefault();
    if (!editing || !canWrite || savingForm) return;
    var details = {};
    fields.forEach(function (key) { details[key] = value(fieldIds[key]); });
    if (!validNumber(details.quantity, false) || !validNumber(details.minimum_stock, true)) {
      el("asset-form-error").textContent = "Use whole numbers of zero or more for quantity and minimum stock."; el("asset-form-error").hidden = false; return;
    }
    details.quantity = Number(details.quantity); details.minimum_stock = details.minimum_stock === "" ? null : Number(details.minimum_stock);
    var requestEpoch = epoch, payload = { fields: details };
    if (editing.id) { payload.id = editing.id; payload.expected_revision = editing.revision; }
    savingForm = true;
    Array.from(el("asset-form").querySelectorAll("input,button")).forEach(function (node) { node.disabled = true; });
    el("asset-save").textContent = "Saving…";
    try {
      var saved = await command("save", payload);
      if (saved) { el("asset-dialog").close(); editing = null; render(); message("Asset saved: " + saved.description + "."); }
    } catch (error) {
      if (epoch === requestEpoch) {
        if (error.conflict) { editing = Object.assign({}, findItem(editing.id)); fields.forEach(function (key) { el(fieldIds[key]).value = editing[key] == null ? "" : editing[key]; }); render(); }
        el("asset-form-error").textContent = error.message || "Asset could not be saved. Try again."; el("asset-form-error").hidden = false;
      }
    } finally {
      if (epoch === requestEpoch) {
        savingForm = false; el("asset-save").textContent = "Save asset";
        Array.from(el("asset-form").querySelectorAll("input,button")).forEach(function (node) { node.disabled = false; });
        if (refreshQueued) { refreshQueued = false; refresh(true); }
      }
    }
  }
  function mount(config) {
    api = config; if (mounted) return; mounted = true;
    if (window.matchMedia) el("asset-filter-options").open = !window.matchMedia("(max-width: 620px)").matches;
    el("asset-refresh").addEventListener("click", function () { refresh(false); });
    el("asset-add").addEventListener("click", function () { openEditor(); });
    el("asset-search").addEventListener("input", renderList);
    filters.concat(["sort"]).forEach(function (key) { el(key === "sort" ? "asset-sort" : "asset-filter-" + key).addEventListener("change", renderList); });
    el("asset-clear").addEventListener("click", function () { clearFilters(); renderList(); el("asset-search").focus(); });
    el("view-assets").addEventListener("click", function (event) {
      var stock = event.target.closest("[data-stock-filter]"), group = event.target.closest("[data-group]"), arrow = event.target.closest("[data-delta]"), edit = event.target.closest("[data-edit]");
      if (stock) { clearFilters(); el("asset-filter-stock").value = stock.dataset.stockFilter; renderList(); }
      else if (group) { clearFilters(); el("asset-filter-" + group.dataset.group).value = group.dataset.value; renderList(); }
      else if (arrow && !arrow.disabled) updateStock(arrow.dataset.id, "adjust_quantity", arrow.dataset.delta);
      else if (edit && !edit.disabled) openEditor(edit.dataset.edit);
    });
    el("asset-list").addEventListener("change", function (event) {
      var input = event.target.closest("input[data-field]");
      if (input) updateStock(input.dataset.id, input.dataset.field === "minimum_stock" ? "set_minimum" : "set_quantity", input.value.trim());
    });
    el("asset-list").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && event.target.matches("input[data-field]")) { event.preventDefault(); event.target.blur(); }
    });
    el("asset-dialog-close").addEventListener("click", closeDialog); el("asset-dialog-cancel").addEventListener("click", closeDialog);
    el("asset-dialog").addEventListener("cancel", function (event) { if (savingForm) event.preventDefault(); else editing = null; });
    el("asset-form").addEventListener("submit", saveEditor);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && active()) refresh(true); });
  }
  function open() {
    if (!allowed()) return;
    clearInterval(timer); timer = setInterval(function () { if (active() && !document.hidden && !el("asset-dialog").open) refresh(true); }, 30000);
    refresh(false);
  }
  function reset() {
    epoch++; clearInterval(timer); items = []; busy.clear(); canWrite = false; loaded = false; loading = false; savingForm = false; editing = null; refreshQueued = false;
    if (!mounted) return;
    el("asset-dialog").close(); clearFilters(); el("asset-sort").value = "name"; message("");
    el("asset-dashboard").innerHTML = ""; el("asset-list").innerHTML = ""; el("asset-alerts").hidden = true; el("asset-breakdown").hidden = true;
    el("asset-last-refreshed").textContent = ""; el("asset-results-count").textContent = "Open the register to load stock.";
    el("asset-add").hidden = true; el("asset-refresh").disabled = false; el("asset-refresh").textContent = "Refresh stock";
    el("asset-save").textContent = "Save asset";
    Array.from(el("asset-form").querySelectorAll("input,button")).forEach(function (node) { node.disabled = false; });
  }
  window.AMFCCAssetRegister = { mount: mount, open: open, reset: reset, refresh: refresh, allowed: allowed };
})();
