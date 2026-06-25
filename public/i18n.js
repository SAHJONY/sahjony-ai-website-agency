/* Worldwide i18n for the whole platform — EN source, ANY language on demand.
 *
 * TWO ways to mark a page:
 *  1) Precise: put data-en="..." on elements (value may contain HTML). Best for
 *     apps with dynamic JS content (dashboard).
 *  2) Auto: add data-i18n-auto to <body> and EVERY static text node is translated
 *     automatically. Wrap anything that must NOT be translated in data-no-i18n
 *     (brand names, code, the live site preview, user data, etc.).
 *
 * Drop a picker anywhere: <select data-lang-select></select>
 * Translations come from the app's own AI (/api/generate), cached in localStorage.
 * No build step, no per-language files, no new API, RTL-aware. */
(function () {
  var LANGS = {
    en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português",
    it: "Italiano", nl: "Nederlands", pl: "Polski", ru: "Русский", uk: "Українська",
    tr: "Türkçe", ar: "العربية", he: "עברית", fa: "فارسی", hi: "हिन्दी", bn: "বাংলা",
    ur: "اردو", zh: "中文", "zh-TW": "繁體中文", ja: "日本語", ko: "한국어",
    vi: "Tiếng Việt", th: "ไทย", id: "Bahasa Indonesia", ms: "Bahasa Melayu",
    tl: "Filipino", sw: "Kiswahili", el: "Ελληνικά", ro: "Română", cs: "Čeština", sv: "Svenska",
  };
  var RTL = { ar: 1, he: 1, fa: 1, ur: 1 };

  function ckey(lang) { return "fda_i18n_" + lang; }
  function loadCache(lang) { try { return JSON.parse(localStorage.getItem(ckey(lang)) || "{}") || {}; } catch (e) { return {}; } }
  function saveCache(lang, o) { try { localStorage.setItem(ckey(lang), JSON.stringify(o)); } catch (e) {} }
  function current() { var s; try { s = localStorage.getItem("fda_lang"); } catch (e) {} if (s) return s; var n = navigator.language || "en"; return LANGS[n] ? n : n.slice(0, 2); }

  // --- collect targets: tagged elements + (optional) every static text node ---
  function elementTargets() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-en]")).map(function (el) {
      return { en: el.getAttribute("data-en"), get: function () {}, set: function (v) { (el.tagName === "INPUT" || el.tagName === "TEXTAREA") ? (el.placeholder = v) : (el.innerHTML = v); }, manual: function (lang) { return el.getAttribute("data-" + lang); } };
    });
  }
  function autoTargets() {
    if (!document.body || !document.body.hasAttribute("data-i18n-auto")) return [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode; if (!p) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|NOSCRIPT|SELECT|OPTION|TEXTAREA|CODE|PRE|IFRAME)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        if (p.closest && (p.closest("[data-no-i18n]") || p.closest("[data-en]"))) return NodeFilter.FILTER_REJECT;
        var t = n.nodeValue; if (!t || !t.trim() || !/[A-Za-zÀ-ɏ]/.test(t)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var out = [], node;
    while ((node = walker.nextNode())) {
      if (node.__fdaEn == null) node.__fdaEn = node.nodeValue; // remember original English once
      (function (nd) { out.push({ en: nd.__fdaEn.trim(), set: function (v) { nd.nodeValue = nd.__fdaEn.replace(nd.__fdaEn.trim(), v); }, manual: function () { return null; } }); })(node);
    }
    return out;
  }

  async function applyLang(lang) {
    if (!LANGS[lang]) lang = LANGS[lang.slice(0, 2)] ? lang.slice(0, 2) : "en";
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL[lang] ? "rtl" : "ltr";
    try { localStorage.setItem("fda_lang", lang); } catch (e) {}

    var targets = elementTargets().concat(autoTargets());
    if (lang === "en") { targets.forEach(function (t) { t.set(t.en); }); return; }

    var cache = loadCache(lang), miss = [], seen = {};
    targets.forEach(function (t) {
      var m = t.manual(lang);
      if (m != null) { t.set(m); return; }
      if (cache[t.en] != null) { t.set(cache[t.en]); return; }
      t._pending = true; miss.push(t); if (t.en) seen[t.en] = 1;
    });
    if (!miss.length) return;

    var uniq = Object.keys(seen);
    try {
      var prompt = "You are a professional localizer for a web app. Translate each string in this JSON array into " +
        (LANGS[lang] || lang) + ". Keep any HTML tags and curly placeholders like {Business} EXACTLY as-is, keep it natural and concise, do not translate brand names. " +
        "Return ONLY a JSON array of strings, same length and order, nothing else.\n" + JSON.stringify(uniq);
      var r = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: prompt, maxTokens: 4000 }) });
      var j = await r.json();
      var arr = JSON.parse((j.text || "").match(/\[[\s\S]*\]/)[0]);
      uniq.forEach(function (en, i) { if (arr[i] != null) cache[en] = arr[i]; });
      saveCache(lang, cache);
      miss.forEach(function (t) { if (cache[t.en] != null) t.set(cache[t.en]); });
    } catch (e) { /* leave English on failure */ }
  }
  window.fdaSetLang = applyLang;

  function buildPickers() {
    document.querySelectorAll("[data-lang-select]").forEach(function (sel) {
      if (sel.tagName !== "SELECT" || sel.dataset.built) return;
      sel.dataset.built = "1";
      sel.innerHTML = Object.keys(LANGS).map(function (k) { return '<option value="' + k + '">' + LANGS[k] + "</option>"; }).join("");
      sel.value = current();
      sel.addEventListener("change", function () { applyLang(sel.value); });
    });
  }
  function init() { buildPickers(); applyLang(current()); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
