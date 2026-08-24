(function () {
  "use strict";

  var session = null;
  var client = null;
  var meal = "Breakfast";
  var scanStartedAt = 0;
  var scanLastAt = 0;
  var scanKeyCount = 0;

  function el(id) { return document.getElementById(id); }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function escapeHtml(input) {
    return String(input == null ? "" : input).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }
  function normalizeRegistration(raw) {
    raw = String(raw || "").trim();
    if (!raw) return "";
    try {
      var decoded = JSON.parse(raw);
      raw = decoded.registration_number || decoded.registration || decoded.reg || decoded.student_id || raw;
    } catch (error) { /* plain card value */ }
    try { raw = decodeURIComponent(raw); } catch (error) { /* keep original */ }
    var query = String(raw).match(/[?&](?:registration_number|registration|reg|student)=([0-9]{5})(?:&|$)/i);
    if (query) return query[1];
    var matches = String(raw).match(/[0-9]{5}/g);
    if (matches && matches.length) return matches[matches.length - 1];
    var digits = String(raw).replace(/\D/g,"");
    return digits.length === 5 ? digits : "";
  }
  function source() {
    var elapsed = scanStartedAt ? Date.now() - scanStartedAt : 99999;
    var value = scanKeyCount >= 5 && elapsed < 1600 ? "scanner" : "manual";
    scanStartedAt = 0; scanLastAt = 0; scanKeyCount = 0;
    return value;
  }
  function focusScanner() { setTimeout(function () { if (!el("kiosk-workspace").hidden) el("scan-input").focus(); },80); }
  function showResult(result, registration) {
    var box = el("scan-result");
    var name = result.full_name || "Registration " + (result.registration_number || registration);
    if (result.status === "checked_in") {
      box.className = "kiosk-result success";
      box.innerHTML = "<strong>CHECKED IN</strong><span>" + escapeHtml(name + " · " + meal) + "</span>";
      if (navigator.vibrate) navigator.vibrate(80);
    } else if (result.status === "duplicate") {
      box.className = "kiosk-result warning";
      box.innerHTML = "<strong>ALREADY CHECKED IN</strong><span>" + escapeHtml(name + " · " + meal) + "</span>";
      if (navigator.vibrate) navigator.vibrate([60,50,60]);
    } else {
      box.className = "kiosk-result error";
      box.innerHTML = "<strong>NOT SAVED</strong><span>" + escapeHtml(result.message || "Card not recognised.") + "</span>";
      if (navigator.vibrate) navigator.vibrate([100,60,100]);
    }
  }
  async function rpc(action, payload) {
    var response = await client.rpc("ops_kitchen_service", { p_session_token:session.session_token, p_action:action, p_payload:payload || {} });
    if (response.error) throw response.error;
    if (response.data && ["unauthorized","locked"].indexOf(response.data.status) >= 0) throw new Error(response.data.message || "Kitchen access has ended.");
    return response.data;
  }
  async function refreshTotal() {
    var result = await rpc("dashboard", { service_date:today() });
    if (!result || result.status !== "success") throw new Error(result && result.message || "Today's count could not be loaded.");
    el("today-total").textContent = Number((result.counts || {})[meal] || 0);
  }
  async function checkIn(inputSource) {
    var registration = normalizeRegistration(el("scan-input").value);
    if (!registration) { showResult({ status:"invalid", message:"Scan a recognised student card or enter a five-digit registration number." },""); el("scan-input").select(); return; }
    el("scan-submit").disabled = true;
    el("scan-submit").textContent = "Checking in...";
    try {
      var result = await rpc("check_in", { service_date:today(), registration_number:registration, meal_session:meal, source:inputSource || "manual" });
      showResult(result || { status:"invalid", message:"No result was returned." },registration);
      if (["checked_in","duplicate"].indexOf(result && result.status) >= 0) el("scan-input").value = "";
      await refreshTotal();
    } catch (error) {
      showResult({ status:"error", message:error.message },registration);
    } finally {
      el("scan-submit").disabled = false;
      el("scan-submit").textContent = "Check student in";
      focusScanner();
    }
  }
  function loadSession() {
    try { session = JSON.parse(sessionStorage.getItem("amfcc_ops_session") || "null"); } catch (error) { session = null; }
    var permitted = session && session.session_token && (session.role === "administrator" || session.role === "department" && session.department && session.department.slug === "kitchen");
    el("kiosk-access-required").hidden = !!permitted;
    el("kiosk-workspace").hidden = !permitted;
    if (!permitted) return false;
    el("kiosk-session").textContent = session.role === "administrator" ? "School Administration scanner session" : "Kitchen scanner session";
    return true;
  }
  function bind() {
    document.querySelectorAll("[data-meal]").forEach(function (button) {
      button.addEventListener("click", function () {
        meal = button.dataset.meal;
        document.querySelectorAll("[data-meal]").forEach(function (candidate) { candidate.classList.toggle("selected",candidate === button); });
        refreshTotal().catch(function (error) { showResult({ status:"error",message:error.message },""); });
        focusScanner();
      });
    });
    el("scan-form").addEventListener("submit",function (event) { event.preventDefault(); checkIn(source()); });
    el("scan-input").addEventListener("keydown",function (event) {
      var now = Date.now();
      if (event.key === "Enter") { event.preventDefault(); checkIn(source()); return; }
      if (event.key.length === 1) {
        if (!scanStartedAt || now - scanLastAt > 140) { scanStartedAt = now; scanKeyCount = 0; }
        scanLastAt = now; scanKeyCount += 1;
      }
    });
    el("scan-input").addEventListener("blur",function () { setTimeout(function () { var active=document.activeElement;if (!el("kiosk-workspace").hidden && (!active || ["INPUT","SELECT","TEXTAREA"].indexOf(active.tagName)<0)) focusScanner(); },250); });
    el("refresh-total").addEventListener("click",function () { refreshTotal().then(focusScanner).catch(function (error) { showResult({ status:"error",message:error.message },""); }); });
    document.addEventListener("keydown",function (event) {
      if (el("kiosk-workspace").hidden || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || ["INPUT","TEXTAREA","SELECT"].indexOf(event.target.tagName) >= 0) return;
      var now=Date.now();
      if (!scanStartedAt || now-scanLastAt>140) { scanStartedAt=now;scanKeyCount=0; }
      scanLastAt=now;scanKeyCount+=1;el("scan-input").focus();el("scan-input").value+=event.key;event.preventDefault();
    });
  }
  function initialise() {
    if (!window.APP_CONFIG || !window.supabase) { el("kiosk-access-required").hidden=false;el("kiosk-access-required").querySelector("p").textContent="The Operations connection is not configured.";return; }
    client = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL,window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    bind();
    if (!loadSession()) return;
    refreshTotal().then(focusScanner).catch(function (error) { showResult({status:"error",message:error.message},""); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  document.addEventListener("DOMContentLoaded",initialise);
})();
