window.APP_CONFIG = {
  SUPABASE_URL: "https://sanabhuogxfpjstftoxt.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_X-FDnWgR8gUPFG05guHdCA_gijXfw4f",
};

(function () {
  if (document.body && document.body.dataset.itRegister) return;
  var script = document.createElement("script");
  script.src = "enrolment_tracking.js?v=3-exemptions";
  script.async = false;
  document.head.appendChild(script);

  script.addEventListener("load", function () {
    var feeScript = document.createElement("script");
    feeScript.src = "fee_enrolment_controls.js?v=4-notice-history";
    feeScript.async = false;
    document.head.appendChild(feeScript);
  });
})();


