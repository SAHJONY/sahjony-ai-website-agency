/* protect.js — copy/screenshot DETERRENTS for owner-only "secret sauce" pages.
 *
 * IMPORTANT / honest note: this cannot truly prevent screenshots or copying —
 * the browser runs on the viewer's machine (OS screenshot, phone camera, View
 * Source and DevTools always exist). This raises the effort for casual copying
 * and adds a traceable watermark so leaks can be traced. Real protection is:
 * keep secrets server-side (env + serverless) and keep the repo private.
 *
 * Deliberately does NOT block copy/paste inside form fields, so the owner can
 * still work. Include only on owner-gated pages. Turn off per-page with
 *   <script src="/protect.js" data-watermark="off"></script>
 */
(function () {
  var self = document.currentScript || {};
  var wmOff = (self.getAttribute && self.getAttribute("data-watermark")) === "off";

  function inField(t) {
    if (!t) return false;
    var tag = (t.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
  }

  // Block context menu, drag, and selection outside of form fields.
  ["contextmenu", "dragstart"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { if (!inField(e.target)) e.preventDefault(); }, { capture: true });
  });
  ["copy", "cut"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { if (!inField(e.target)) e.preventDefault(); }, { capture: true });
  });

  // Deter common save / view-source / devtools shortcuts (deterrent only).
  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase();
    if (inField(e.target)) return;
    var block =
      k === "f12" ||
      ((e.ctrlKey || e.metaKey) && (k === "s" || k === "u" || k === "p")) ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c"));
    if (block) { e.preventDefault(); e.stopPropagation(); return false; }
  }, { capture: true });

  // Non-selectable styling (except form fields), and print = blank page.
  var st = document.createElement("style");
  st.textContent =
    "body{-webkit-user-select:none;-moz-user-select:none;user-select:none;-webkit-touch-callout:none}" +
    "input,textarea,select,[contenteditable]{-webkit-user-select:text;user-select:text}" +
    "img,video{-webkit-user-drag:none;user-drag:none}" +
    "@media print{body *{display:none!important}body::after{content:'Confidential — printing disabled.';display:block!important;padding:40px;font:600 18px system-ui;color:#111}}";
  document.head.appendChild(st);

  // Faint, traceable diagonal watermark (owner label + date). Cosmetic; a viewer
  // can remove it in DevTools, but it tags casual screenshots.
  if (!wmOff) {
    function stamp() {
      if (document.getElementById("__wm")) return;
      var who = "";
      try { who = (document.cookie.match(/fda_auth=/) ? "OWNER" : "") ; } catch (e) {}
      var label = "CONFIDENTIAL · frontdeskagents.com · " + new Date().toISOString().slice(0, 10) + (who ? " · " + who : "");
      var svg =
        "<svg xmlns='http://www.w3.org/2000/svg' width='420' height='220'>" +
        "<text x='0' y='120' transform='rotate(-24 0 120)' fill='rgba(150,170,190,0.10)' font-family='Inter,system-ui' font-size='16' font-weight='700'>" +
        label + "</text></svg>";
      var d = document.createElement("div");
      d.id = "__wm";
      d.setAttribute("aria-hidden", "true");
      d.style.cssText =
        "position:fixed;inset:0;z-index:2147483000;pointer-events:none;" +
        "background-image:url(\"data:image/svg+xml;utf8," + encodeURIComponent(svg) + "\");background-repeat:repeat";
      document.body.appendChild(d);
    }
    if (document.body) stamp(); else document.addEventListener("DOMContentLoaded", stamp);
    // Re-add if something removes it.
    setInterval(function () { if (document.body && !document.getElementById("__wm")) stamp(); }, 3000);
  }
})();
