window.APP_CONFIG = {
  SUPABASE_URL: "https://sanabhuogxfpjstftoxt.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_X-FDnWgR8gUPFG05guHdCA_gijXfw4f",
};

(function () {
  if (document.body && document.body.dataset.itRegister) return;

  function normalizeEnrolmentNode(node) {
    try {
      if (
        node &&
        node.nodeType === 1 &&
        node.id === "view-enrolment" &&
        !node.querySelector("#enrolment-refresh")
      ) {
        var raw = node.textContent || "";
        var open = String.fromCharCode(60);
        var close = String.fromCharCode(62);
        var marker = open + 'div class="view-heading"' + close;
        if (
          raw.indexOf(marker) !== -1 &&
          raw.indexOf('id="enrolment-rows"') !== -1
        ) {
          node.innerHTML = raw;
        }
      }
    } catch (error) {
      if (window.console) console.error("Term enrolment markup repair failed.", error);
    }
    return node;
  }

  var originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, referenceNode) {
    normalizeEnrolmentNode(newNode);
    return originalInsertBefore.call(this, newNode, referenceNode);
  };

  var originalAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function (newNode) {
    normalizeEnrolmentNode(newNode);
    return originalAppendChild.call(this, newNode);
  };

  var script = document.createElement("script");
  script.src = "enrolment_tracking.js?v=3";
  script.async = false;
  document.head.appendChild(script);
})();
