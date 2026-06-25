/* Worldwide i18n for the whole platform — EN source, ANY language on demand.
 *
 * Mark translatable elements with data-en (value may contain HTML), e.g.
 *   <h1 data-en="Hello &lt;b&gt;world&lt;/b&gt;">Hello <b>world</b></h1>
 * Drop a language picker anywhere with: <select data-lang-select></select>
 *
 * How it works: English text lives in data-en. Picking a language uses a manual
 * data-<lang> attribute if present (instant), else a cached translation, else it
 * batch-translates every string via the app's AI brain (/api/generate) and caches
 * the result in localStorage. No build step, no per-language files, no new API. */
(function () {
  // Common world languages (extend freely — any BCP-47 code works for AI translate).
  var LANGS = {
    en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português",
    it: "Italiano", nl: "Nederlands", pl: "Polski", ru: "Русский", uk: "Українська",
    tr: "Türkçe", ar: "العربية", he: "עברית", fa: "فارسی", hi: "हिन्दी", bn: "বাংলা",
    ur: "اردو", zh: "中文", "zh-TW": "繁體中文", ja: "日本語", ko: "한국어",
    vi: "Tiếng Việt", th: "ไทย", id: "Bahasa Indonesia", ms: "Bahasa Melayu",
    tl: "Filipino", sw: "Kiswahili", el: "Ελληνικά", ro: "Română", cs: "Čeština", sv: "Svenska",
  };
  var RTL = { ar: 1, he: 1, fa: 1, ur: 1 };

  function nodes() { return Array.prototype.slice.call(document.querySelectorAll("[data-en]")); }
  function isField(el) { return (el.tagName === "INPUT" || el.tagName === "TEXTAREA"); }
  function setVal(el, v) { if (isField(el)) el.placeholder = v; else el.innerHTML = v; }
  function ckey(lang) { return "fda_i18n_" + lang; }
  function loadCache(lang) { try { return JSON.parse(localStorage.getItem(ckey(lang)) || "{}") || {}; } catch (e) { return {}; } }
  function saveCache(lang, o) { try { localStorage.setItem(ckey(lang), JSON.stringify(o)); } catch (e) {} }
  function current() { var s; try { s = localStorage.getItem("fda_lang"); } catch (e) {} if (s) return s; var n = (navigator.language || "en"); return LANGS[n] ? n : n.slice(0, 2); }

  async function applyLang(lang) {
    if (!LANGS[lang]) lang = LANGS[lang.slice(0, 2)] ? lang.slice(0, 2) : "en";
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL[lang] ? "rtl" : "ltr";
    try { localStorage.setItem("fda_lang", lang); } catch (e) {}
    var els = nodes();
    if (lang === "en") { els.forEach(function (el) { setVal(el, el.getAttribute("data-en")); }); return; }

    var cache = loadCache(lang), miss = [];
    els.forEach(function (el) {
      var manual = el.getAttribute("data-" + lang);
      var en = el.getAttribute("data-en");
      if (manual != null) setVal(el, manual);
      else if (cache[en] != null) setVal(el, cache[en]);
      else miss.push(el);
    });
    if (!miss.length) return;

    // Translate the misses in one AI call; keep English visible if it fails.
    var strings = miss.map(function (el) { return el.getAttribute("data-en"); });
    try {
      var prompt = "You are a professional localizer for a web app. Translate each string in this JSON array into " +
        (LANGS[lang] || lang) + ". Keep any HTML tags and curly placeholders like {Business} EXACTLY as-is. Keep it natural and concise. " +
        "Return ONLY a JSON array of strings, same length and order, nothing else.\n" + JSON.stringify(strings);
      var r = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: prompt, maxTokens: 3000 }) });
      var j = await r.json();
      var arr = JSON.parse((j.text || "").match(/\[[\s\S]*\]/)[0]);
      miss.forEach(function (el, i) { if (arr[i] != null) { setVal(el, arr[i]); cache[el.getAttribute("data-en")] = arr[i]; } });
      saveCache(lang, cache);
    } catch (e) { /* network/parse error -> leave English */ }
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
