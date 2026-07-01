/* AVA — AI receptionist widget. Self-contained, themeable, embeddable.
   Usage:  <script defer src="/ava.js" data-business="Eastwood Barber Co."></script>
   Talks to /api/generate {ava:true,...}. Capture-a-callback posts to /api/contact.
   Ported in spirit from SAHJONY/FrontDesk-Agents (AVA). */
(function () {
  var s = document.currentScript || (function(){var a=document.getElementsByTagName("script");return a[a.length-1];})();
  var BIZ = (s && s.getAttribute("data-business")) || (window.AVA_BUSINESS) || (location.hostname.replace(/^www\./,"")) || "our business";
  var API = (s && s.getAttribute("data-api")) || (window.AVA_API) || "/api/generate";
  var SLUG = (s && s.getAttribute("data-slug")) || (window.AVA_SLUG) || "";
  var GOLD = "#e8c476", TEAL = "#2dd4bf", INK = "#04080f", INK2 = "#0d1a2d", TEXT = "#e8eef7", MUT = "#9fb3c9";

  var css = ""
    + ".ava-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:62px;height:62px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(180deg,#f6dba2," + GOLD + ");color:#1a1206;font-size:26px;box-shadow:0 12px 34px rgba(232,196,118,.45);transition:transform .18s ease}"
    + ".ava-btn:hover{transform:translateY(-2px) scale(1.04)}"
    + ".ava-panel{position:fixed;right:20px;bottom:94px;z-index:2147483000;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 130px);display:none;flex-direction:column;background:" + INK + ";border:1px solid rgba(45,212,191,.22);border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6);font-family:Inter,system-ui,sans-serif}"
    + ".ava-panel.open{display:flex;animation:avaup .25s ease}"
    + "@keyframes avaup{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}"
    + ".ava-hd{padding:14px 16px;background:linear-gradient(160deg," + INK2 + "," + INK + ");border-bottom:1px solid rgba(45,212,191,.18);display:flex;align-items:center;gap:10px}"
    + ".ava-dot{width:9px;height:9px;border-radius:50%;background:" + TEAL + ";box-shadow:0 0 10px " + TEAL + "}"
    + ".ava-tt{color:" + TEXT + ";font-weight:700;font-size:15px}.ava-sub{color:" + MUT + ";font-size:11.5px}"
    + ".ava-x{margin-left:auto;background:none;border:none;color:" + MUT + ";font-size:20px;cursor:pointer}"
    + ".ava-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}"
    + ".ava-m{max-width:82%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap}"
    + ".ava-a{align-self:flex-start;background:" + INK2 + ";color:" + TEXT + ";border:1px solid rgba(45,212,191,.16);border-bottom-left-radius:4px}"
    + ".ava-u{align-self:flex-end;background:linear-gradient(180deg,#f6dba2," + GOLD + ");color:#1a1206;border-bottom-right-radius:4px;font-weight:500}"
    + ".ava-typing{align-self:flex-start;color:" + MUT + ";font-size:13px;padding:6px 4px}"
    + ".ava-ft{padding:10px;border-top:1px solid rgba(45,212,191,.16);display:flex;gap:8px;background:" + INK + "}"
    + ".ava-in{flex:1;background:" + INK2 + ";border:1px solid rgba(45,212,191,.2);border-radius:11px;padding:11px 13px;color:" + TEXT + ";font-size:14px;font-family:inherit;outline:none}"
    + ".ava-in:focus{border-color:" + GOLD + "}"
    + ".ava-send{background:linear-gradient(180deg,#f6dba2," + GOLD + ");color:#1a1206;border:none;border-radius:11px;padding:0 15px;font-weight:700;cursor:pointer;font-size:16px}"
    + ".ava-quick{display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 10px}"
    + ".ava-chip{background:rgba(45,212,191,.1);border:1px solid rgba(45,212,191,.3);color:#bfeee7;font-size:12px;font-weight:600;padding:6px 11px;border-radius:999px;cursor:pointer}"
    + "@media(prefers-reduced-motion:reduce){.ava-panel.open{animation:none}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement("button");
  btn.className = "ava-btn"; btn.setAttribute("aria-label", "Chat with Ava"); btn.innerHTML = "💬";
  var panel = document.createElement("div"); panel.className = "ava-panel"; panel.setAttribute("role", "dialog");
  panel.innerHTML =
    '<div class="ava-hd"><span class="ava-dot"></span><div><div class="ava-tt">Ava</div><div class="ava-sub">AI receptionist · replies in any language</div></div><button class="ava-x" aria-label="Close">×</button></div>'
    + '<div class="ava-log" id="ava-log"></div>'
    + '<div class="ava-quick" id="ava-quick"></div>'
    + '<div class="ava-ft"><input class="ava-in" id="ava-in" placeholder="Type a message…" autocomplete="off"><button class="ava-send" id="ava-send" aria-label="Send">➤</button></div>';
  document.body.appendChild(btn); document.body.appendChild(panel);

  var log = panel.querySelector("#ava-log"), input = panel.querySelector("#ava-in"), quick = panel.querySelector("#ava-quick");
  var messages = [], greeted = false, busy = false;

  function bubble(role, text) {
    var d = document.createElement("div"); d.className = "ava-m " + (role === "user" ? "ava-u" : "ava-a"); d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  function setQuick(items) {
    quick.innerHTML = "";
    items.forEach(function (q) { var c = document.createElement("button"); c.className = "ava-chip"; c.textContent = q; c.onclick = function () { send(q); }; quick.appendChild(c); });
  }
  async function send(text) {
    text = (text || input.value).trim(); if (!text || busy) return;
    input.value = ""; quick.innerHTML = ""; bubble("user", text); messages.push({ role: "user", content: text });
    busy = true; var typing = document.createElement("div"); typing.className = "ava-typing"; typing.textContent = "Ava is typing…"; log.appendChild(typing); log.scrollTop = log.scrollHeight;
    try {
      var r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ava: true, business: BIZ, slug: SLUG, messages: messages }) });
      var j = await r.json(); typing.remove();
      var reply = (j && j.reply) || "Sorry, could you say that again?";
      bubble("assistant", reply); messages.push({ role: "assistant", content: reply });
    } catch (e) { typing.remove(); bubble("assistant", "I'm having trouble connecting. Please try again in a moment."); }
    busy = false; input.focus();
  }
  function open() {
    panel.classList.add("open"); input.focus();
    if (!greeted) { greeted = true; bubble("assistant", "Hi! I'm Ava, the receptionist for " + BIZ + " 👋 How can I help — hours, services, or book an appointment?"); setQuick(["What are your hours?", "Book an appointment", "What services do you offer?"]); }
  }
  btn.onclick = function () { panel.classList.contains("open") ? panel.classList.remove("open") : open(); };
  panel.querySelector(".ava-x").onclick = function () { panel.classList.remove("open"); };
  panel.querySelector("#ava-send").onclick = function () { send(); };
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
})();
