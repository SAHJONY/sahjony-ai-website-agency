/* social.js — renders the brand's social links into any element with
 * [data-socials]. Links come from /api/health (env SOCIAL_* + the owner's
 * Marketing settings), so once set they appear everywhere automatically. */
(function () {
  var ICONS = {
    facebook: "f", instagram: "IG", tiktok: "TT", youtube: "▶", x: "X",
    linkedin: "in", threads: "@", pinterest: "P", whatsapp: "WA",
    telegram: "TG", google: "G", yelp: "Y",
  };
  var LABEL = {
    facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube",
    x: "X", linkedin: "LinkedIn", threads: "Threads", pinterest: "Pinterest",
    whatsapp: "WhatsApp", telegram: "Telegram", google: "Google", yelp: "Yelp",
  };
  function render(social) {
    var keys = Object.keys(social || {});
    if (!keys.length) return;
    var nodes = document.querySelectorAll("[data-socials]");
    if (!nodes.length) return;
    nodes.forEach(function (host) {
      host.innerHTML = keys.map(function (k) {
        var url = String(social[k]).replace(/"/g, "%22");
        return '<a href="' + url + '" target="_blank" rel="noopener" aria-label="' + (LABEL[k] || k) +
          '" title="' + (LABEL[k] || k) + '" style="display:inline-flex;align-items:center;justify-content:center;' +
          'width:36px;height:36px;border-radius:50%;border:1px solid rgba(45,212,191,.3);color:#cdeee9;' +
          'text-decoration:none;font-weight:700;font-size:12px;margin:4px;background:rgba(45,212,191,.06)">' +
          (ICONS[k] || "•") + "</a>";
      }).join("");
    });
  }
  try {
    fetch("/api/health").then(function (r) { return r.json(); }).then(function (j) {
      render(j && j.social);
    }).catch(function () {});
  } catch (e) {}
})();
