(function () {
  "use strict";
  if (window.__fdOwnerConsoleMounted) return;
  window.__fdOwnerConsoleMounted = true;

  var script = document.currentScript;
  if (!script) {
    var scripts = document.querySelectorAll('script[src*="site-owner-console.js"]');
    script = scripts[scripts.length - 1];
  }
  if (!script) return;

  var slug = String(script.getAttribute("data-slug") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  if (!slug) return;
  var business = String(script.getAttribute("data-business") || "My Business").slice(0, 120);
  var origin;
  try { origin = new URL(script.src, location.href).origin; } catch (_) { origin = location.origin; }

  var style = document.createElement("style");
  style.textContent = [
    ".fd-owner-dock{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin:24px auto 0;padding-top:18px;border-top:1px solid rgba(140,170,205,.15);font:500 12px/1.4 system-ui,-apple-system,sans-serif;color:inherit;opacity:.82}",
    ".fd-owner-entry{appearance:none;border:1px solid rgba(232,196,118,.38);background:rgba(232,196,118,.08);color:inherit;border-radius:999px;padding:8px 13px;font:700 12px/1 system-ui,-apple-system,sans-serif;text-decoration:none;cursor:pointer;letter-spacing:.01em}",
    ".fd-owner-entry:hover,.fd-owner-entry:focus-visible{border-color:#e8c476;outline:none;opacity:1}",
    ".fd-owner-shell{position:fixed;inset:0;z-index:2147483600;background:#04080f;display:none;flex-direction:column;color:#e8eef7;font-family:system-ui,-apple-system,sans-serif}",
    ".fd-owner-shell.open{display:flex}",
    ".fd-owner-bar{height:58px;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 16px;background:#07101c;border-bottom:1px solid rgba(45,212,191,.18)}",
    ".fd-owner-brand{min-width:0}.fd-owner-brand b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fd-owner-brand span{display:block;color:#9fb3c9;font-size:11px;margin-top:2px}",
    ".fd-owner-close{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#e8eef7;border-radius:999px;padding:9px 13px;font:700 12px/1 system-ui,-apple-system,sans-serif;cursor:pointer}",
    ".fd-owner-frame{width:100%;height:calc(100vh - 58px);border:0;background:#04080f}",
    "@media(max-width:560px){.fd-owner-bar{height:54px;padding:8px 10px}.fd-owner-frame{height:calc(100vh - 54px)}}"
  ].join("");
  document.head.appendChild(style);

  var entries = Array.prototype.slice.call(document.querySelectorAll("[data-fd-owner-entry]"));
  if (!entries.length) {
    var dock = document.createElement("div");
    dock.className = "fd-owner-dock";
    dock.innerHTML = '<span>Business owner?</span><button type="button" class="fd-owner-entry" data-fd-owner-entry>Open Owner Console</button>';
    var footer = document.querySelector("footer") || document.body;
    footer.appendChild(dock);
    entries = [dock.querySelector("[data-fd-owner-entry]")];
  } else {
    entries.forEach(function (entry) { entry.classList.add("fd-owner-entry"); });
  }

  var shell = document.createElement("section");
  shell.className = "fd-owner-shell";
  shell.setAttribute("aria-hidden", "true");
  shell.innerHTML = '<div class="fd-owner-bar"><div class="fd-owner-brand"><b></b><span>Secure FrontDeskOS™ Owner Console</span></div><button type="button" class="fd-owner-close" aria-label="Close owner console">← Back to website</button></div><iframe class="fd-owner-frame" title="Owner Console" loading="lazy"></iframe>';
  shell.querySelector(".fd-owner-brand b").textContent = business;
  document.body.appendChild(shell);

  var frame = shell.querySelector("iframe");
  var close = shell.querySelector(".fd-owner-close");
  var previousOverflow = "";
  var lastFocus = null;

  function consoleUrl() {
    return origin + "/business.html?slug=" + encodeURIComponent(slug) + "&embed=1";
  }
  function updateUrl(open) {
    try {
      var url = new URL(location.href);
      if (open) url.searchParams.set("owner", "1"); else url.searchParams.delete("owner");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (_) {}
  }
  function openConsole(event) {
    if (event) event.preventDefault();
    lastFocus = document.activeElement;
    if (!frame.getAttribute("src")) frame.setAttribute("src", consoleUrl());
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    shell.classList.add("open");
    shell.setAttribute("aria-hidden", "false");
    updateUrl(true);
    close.focus();
  }
  function closeConsole() {
    shell.classList.remove("open");
    shell.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = previousOverflow;
    updateUrl(false);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  entries.forEach(function (entry) { entry.addEventListener("click", openConsole); });
  close.addEventListener("click", closeConsole);
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && shell.classList.contains("open")) closeConsole(); });
  window.addEventListener("message", function (event) {
    if (event.origin === origin && event.data && event.data.type === "fd-owner-close") closeConsole();
  });

  try { if (new URL(location.href).searchParams.get("owner") === "1") openConsole(); } catch (_) {}
})();
