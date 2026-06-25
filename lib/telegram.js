// Shared Telegram helpers (NOT an API route — lives in /lib so it isn't counted
// as a Serverless Function). Used by api/contact.js for notifications + the
// customer-chat webhook.  Needs env: TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT.

export function tgConfigured() {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function tgSend(chatId, text, extra = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !text) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).slice(0, 4000),
        parse_mode: "HTML",
        disable_web_page_preview: false,
        ...extra,
      }),
    });
    return r.ok;
  } catch (_) { return false; }
}

// Notify the agency owner's chat (set TELEGRAM_OWNER_CHAT). Best-effort.
export async function tgNotifyOwner(text, extra) {
  const owner = process.env.TELEGRAM_OWNER_CHAT;
  if (!owner) return false;
  return tgSend(owner, text, extra);
}

const esc = (s) => String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

// Handle one Telegram webhook update. Two-way relay:
//   • a CLIENT messages the bot  -> forwarded to the owner (+ auto-ack)
//   • the OWNER replies "<chatId> message" (or "/r <chatId> message") -> delivered to that client
// Returns true if it handled something.
export async function tgHandleUpdate(update) {
  const msg = update && (update.message || update.edited_message);
  if (!msg || !msg.chat) return false;
  const chatId = msg.chat.id;
  const owner = process.env.TELEGRAM_OWNER_CHAT;
  const from = msg.from || {};
  const who = `${from.first_name || ""} ${from.last_name || ""}`.trim() || from.username || `user ${chatId}`;
  const text = (msg.text || "").trim();

  // Owner is messaging the bot.
  if (owner && String(chatId) === String(owner)) {
    // Reply to a client: "<chatId> your message"  or  "/r <chatId> your message"
    const m = text.match(/^\/?r?\s*(\d{4,})\s+([\s\S]+)/);
    if (m) {
      const ok = await tgSend(m[1], `<b>WEBSITE BUILDER AGENCY:</b>\n${esc(m[2])}`);
      await tgSend(owner, ok ? "✅ Sent to client " + m[1] : "⚠️ Couldn't reach " + m[1] + " (have they started the bot?)");
    } else if (text && text !== "/start") {
      await tgSend(owner, "ℹ️ To reply to a client, send:\n<code>&lt;their chat id&gt; your message</code>\n(the id is shown on each forwarded message)");
    } else if (text === "/start") {
      await tgSend(owner, "✅ You're the agency owner here. Client messages will be forwarded to you. Reply with <code>&lt;chat id&gt; message</code>.");
    }
    return true;
  }

  // A client/visitor is messaging the bot.
  if (text === "/start") {
    await tgSend(chatId, "👋 Welcome to <b>WEBSITE BUILDER AGENCY</b>!\n\nMessage us right here and our team will reply. We'll also send your website link here once it's ready.");
    await tgNotifyOwner(`🆕 <b>${esc(who)}</b> started the bot.\nReply with: <code>${chatId} your message</code>`);
  } else {
    await tgNotifyOwner(`💬 <b>${esc(who)}</b> (chat <code>${chatId}</code>):\n${esc(text || "(non-text message)")}\n\nReply: <code>${chatId} your reply</code>`);
    await tgSend(chatId, "✅ Got it — our team will reply shortly. Thank you!");
  }
  return true;
}
