// Shared Telegram helpers (NOT an API route — lives in /lib so it isn't counted
// as a Serverless Function). Powers an AUTONOMOUS AI agent that answers clients
// as a receptionist / sales / customer-service rep, with per-chat memory and a
// human-takeover handoff. Used by api/contact.js (webhook folds in there).
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT, (optional) TELEGRAM_WEBHOOK_SECRET.

const esc = (s) => String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

export function tgConfigured() { return !!process.env.TELEGRAM_BOT_TOKEN; }

export async function tgSend(chatId, text, extra = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !text) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...extra }),
    });
    return r.ok;
  } catch (_) { return false; }
}

export async function tgNotifyOwner(text, extra) {
  const owner = process.env.TELEGRAM_OWNER_CHAT;
  if (!owner) return false;
  return tgSend(owner, text, extra);
}

// --- tiny Upstash KV (conversation memory + human-takeover flag) ---
async function uget(key) {
  const u = process.env.UPSTASH_REDIS_REST_URL, t = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!u || !t) return null;
  try {
    const r = await fetch(u.replace(/\/$/, "") + "/get/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + t } });
    const j = await r.json();
    return j && j.result != null ? j.result : null;
  } catch (_) { return null; }
}
async function uset(key, val) {
  const u = process.env.UPSTASH_REDIS_REST_URL, t = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!u || !t) return;
  try {
    await fetch(u.replace(/\/$/, "") + "/set/" + encodeURIComponent(key), {
      method: "POST", headers: { Authorization: "Bearer " + t, "content-type": "text/plain" }, body: String(val),
    });
  } catch (_) {}
}
const histKey = (id) => "fda:tg:hist:" + id;
const humanKey = (id) => "fda:tg:human:" + id;
const HUMAN_PAUSE_MS = 2 * 60 * 60 * 1000; // owner reply pauses the AI for 2h

// Where customers fill out their details so the site is built for them.
const BUILDER_URL = (process.env.APP_URL || "https://frontdeskagents.com").replace(/\/$/, "") + "/builder.html";

const PERSONA =
`You are Ava, the warm, sharp virtual receptionist and sales rep for WEBSITE BUILDER AGENCY (a.k.a. FrontDesk Agents). We build premium custom websites for local businesses — fast turnaround, AI-generated hero imagery, mobile-friendly, SEO + Google listing help, and optional monthly care plans. Payment is flexible: pay in full, installment plans, or by card, Cash App, Zelle, or Square.
Your job on this chat:
- Greet warmly and sound like a real person, not a bot.
- Answer questions about our service clearly and confidently.
- Qualify the lead: their business name, type, city, whether they already have a website, and what they want.
- GET THEM TO THE INTAKE FORM: whenever they want a website, a free sample, pricing, or to get started, give them this exact link and tell them to fill it out — once they do, we build their website automatically to a premium standard, fast: ${BUILDER_URL}
Rules:
- Keep replies short and natural for a messaging app: 2-5 sentences, no markdown, no bullet lists, no emoji spam (one is fine).
- Always paste the intake link as a plain URL (no markdown) when guiding them to start.
- Never invent specific prices you weren't given — offer a free custom quote via the form instead.
- If they want to buy now, or ask for something only a human can do (refunds, account changes, complex custom work), say you'll connect them with the team right away.`;

// Ask the app's own multi-engine brain (/api/generate) for Ava's next reply.
async function aiReply(baseUrl, history) {
  if (!baseUrl) return "";
  const convo = history.slice(-10).map((h) => `${h.role === "user" ? "Customer" : "Ava"}: ${h.content}`).join("\n");
  const prompt = `${PERSONA}\n\nConversation so far:\n${convo}\n\nWrite Ava's next reply only — just the message text, no name prefix, no quotes.`;
  try {
    const r = await fetch(baseUrl + "/api/generate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, maxTokens: 500 }),
    });
    const j = await r.json();
    let t = ((j && j.text) || "").trim().replace(/^["']|["']$/g, "").replace(/^(ava|agent)\s*:\s*/i, "");
    return t;
  } catch (_) { return ""; }
}

async function loadHistory(id) {
  const raw = await uget(histKey(id));
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}
async function saveHistory(id, history) { await uset(histKey(id), JSON.stringify(history.slice(-12))); }

// Handle one Telegram webhook update.
export async function tgHandleUpdate(update, baseUrl) {
  const msg = update && (update.message || update.edited_message);
  if (!msg || !msg.chat) return false;
  const chatId = msg.chat.id;
  const owner = process.env.TELEGRAM_OWNER_CHAT;
  const from = msg.from || {};
  const who = `${from.first_name || ""} ${from.last_name || ""}`.trim() || from.username || `user ${chatId}`;
  const text = (msg.text || "").trim();

  // ---- Owner is messaging the bot ----
  if (owner && String(chatId) === String(owner)) {
    // Send a PAYMENT LINK to a client through Telegram:
    //   /pay <clientChatId> <build> [monthly] [installments] [downPayment]
    const pay = text.match(/^\/pay\s+(\d{4,})\s+(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?(?:\s+(\d+))?(?:\s+(\d+(?:\.\d+)?))?(?:\s+([a-z0-9][a-z0-9-]+))?/i);
    if (pay) {
      const [, cid, b, mo, inst, dn, slug] = pay;
      let j = null;
      try {
        const r = await fetch(baseUrl + "/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json", "x-admin-token": process.env.ADMIN_PASSWORD || "" },
          body: JSON.stringify({ name: "Client", build: Number(b) || 0, monthly: Number(mo) || 0, installments: Number(inst) || 1, downPayment: Number(dn) || 0, slug: slug || "" }),
        });
        j = await r.json();
      } catch (_) {}
      if (j && (j.message || j.url)) {
        await tgSend(cid, j.message || j.url);
        await uset(humanKey(cid), String(Date.now())); // pause AI while they pay
        await tgSend(owner, `✅ Payment options sent to client ${cid}.`);
      } else {
        await tgSend(owner, `⚠️ Couldn't create the payment link${j && j.error ? ": " + esc(j.error) : ""}.\nUsage: <code>/pay &lt;chatId&gt; &lt;build&gt; [monthly] [installments] [down]</code>`);
      }
      return true;
    }
    // "<clientChatId> message"  or  "/r <clientChatId> message"  -> deliver to client + pause AI for that chat
    const m = text.match(/^\/?r?\s*(\d{4,})\s+([\s\S]+)/);
    if (m) {
      const ok = await tgSend(m[1], esc(m[2]));
      await uset(humanKey(m[1]), String(Date.now()));            // human took over -> AI pauses
      await tgSend(owner, ok ? `✅ Sent to ${m[1]} (AI paused 2h for this chat).` : `⚠️ Couldn't reach ${m[1]}.`);
    } else if (text === "/ai" ) {
      await tgSend(owner, "Send <code>&lt;chat id&gt; resume</code> isn't needed — AI auto-resumes 2h after your last reply.");
    } else if (text && text !== "/start") {
      await tgSend(owner, "ℹ️ To reply to a client: <code>&lt;their chat id&gt; your message</code> (id is on each forwarded message). Your reply pauses the AI for that chat for 2h.");
    } else if (text === "/start") {
      await tgSend(owner, "✅ Owner console ready. Ava (AI) answers clients automatically. Jump in anytime with <code>&lt;chat id&gt; message</code>.");
    }
    return true;
  }

  // ---- A client/visitor is messaging the bot ----
  if (text === "/start") {
    await tgSend(chatId, `👋 Welcome to WEBSITE BUILDER AGENCY! I'm Ava. Tell me about your business and what you'd like — or jump straight in and fill out this quick form, and we'll build your website automatically to a premium standard:\n\n${BUILDER_URL}`);
    await tgNotifyOwner(`🆕 <b>${esc(who)}</b> started the bot.\nReply: <code>${chatId} your message</code>`);
    return true;
  }

  const history = await loadHistory(chatId);
  history.push({ role: "user", content: text || "(non-text message)" });

  // If the owner replied recently, stay quiet — just relay to the owner.
  const humanTs = Number(await uget(humanKey(chatId)) || 0);
  const humanActive = humanTs && (Date.now() - humanTs < HUMAN_PAUSE_MS);

  if (humanActive) {
    await saveHistory(chatId, history);
    await tgNotifyOwner(`💬 <b>${esc(who)}</b> (<code>${chatId}</code>):\n${esc(text)}\n\nReply: <code>${chatId} ...</code>`);
    return true;
  }

  // Autonomous AI reply.
  let reply = await aiReply(baseUrl, history);
  if (!reply) reply = "Thanks for reaching out! Tell me your business name and what you'd like for your website, and I'll get you a free sample. (Our team is also here if you'd prefer a person.)";
  // Make sure the intake link actually gets sent when there's buying intent —
  // don't rely solely on the model remembering to include it.
  const wantsLink = /\b(website|web ?site|site|page|price|pricing|cost|quote|sample|demo|get ?started|start|begin|build|made|design|sign ?up|interested|interest|how much|order|yes|ready)\b/i.test(text);
  if (wantsLink && !/builder\.html|\/s\//i.test(reply)) {
    reply += `\n\n👉 Start here (2 minutes) and we build it automatically:\n${BUILDER_URL}`;
  }
  history.push({ role: "assistant", content: reply });
  await saveHistory(chatId, history);
  await tgSend(chatId, esc(reply));
  await tgNotifyOwner(`🤖 <b>${esc(who)}</b> (<code>${chatId}</code>) — Ava handled:\n👤 ${esc(text)}\n💬 ${esc(reply)}\n\nTake over: <code>${chatId} your message</code>`);
  return true;
}
