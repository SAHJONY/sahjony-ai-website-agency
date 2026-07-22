const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value, max = 500) => String(value == null ? "" : value).slice(0, max);

function detail(entry, inboxUrl) {
  const a = entry.attribution || {};
  return [
    `Name: ${clean(entry.name)}`,
    `Business: ${clean(entry.type)}`,
    `Contact: ${clean(entry.contact)}`,
    entry.city ? `Location: ${clean(entry.city)}` : "",
    entry.plan ? `Selected plan: ${clean(entry.plan)}` : "",
    `Source: ${clean(a.source || a.utm_source || "direct")}`,
    a.utm_medium ? `Medium: ${clean(a.utm_medium)}` : "",
    a.utm_campaign ? `Campaign: ${clean(a.utm_campaign)}` : "",
    `Timestamp: ${clean(entry.at)}`,
    entry.notes ? `Message: ${clean(entry.notes, 1500)}` : "",
    `Operator inbox: ${inboxUrl}`,
  ].filter(Boolean).join("\n");
}

async function attempt(channel, send, { sleepFn, logger, maxAttempts }) {
  let lastError = "";
  let attempts = 0;
  for (let number = 1; number <= maxAttempts; number++) {
    attempts = number;
    try {
      const response = await send();
      if (response && response.ok) {
        logger({ event: "lead_notification", channel, status: "sent", attempt: number });
        return { status: "sent", attempts: number, sentAt: new Date().toISOString() };
      }
      const status = Number(response && response.status) || 0;
      lastError = status ? `provider_http_${status}` : "provider_rejected";
      logger({ event: "lead_notification", channel, status: "failed_attempt", attempt: number, error: lastError });
      if (!RETRYABLE.has(status) || number === maxAttempts) break;
    } catch (error) {
      lastError = "network_error";
      logger({ event: "lead_notification", channel, status: "failed_attempt", attempt: number, error: lastError });
      if (number === maxAttempts) break;
    }
    await sleepFn(200 * number);
  }
  return { status: "failed", attempts, error: lastError || "delivery_failed" };
}

export async function deliverLeadNotifications(entry, options = {}) {
  const env = options.env || process.env;
  const fetchFn = options.fetchFn || fetch;
  const sleepFn = options.sleepFn || wait;
  const logger = options.logger || ((record) => console.log(JSON.stringify(record)));
  const maxAttempts = options.maxAttempts || 3;
  const base = (env.APP_URL || "https://www.frontdeskagents.com").replace(/\/$/, "");
  const inboxUrl = `${base}/dashboard.html#inbox`;
  const text = detail(entry, inboxUrl);
  const channels = {};
  const jobs = [];

  const emailTo = env.NOTIFY_EMAIL || env.SALES_EMAIL;
  if (env.RESEND_API_KEY && emailTo) {
    jobs.push(["email", () => fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "user-agent": "frontdeskagents-lead-notifier/1.0" },
      body: JSON.stringify({
        from: env.OUTREACH_FROM || "onboarding@resend.dev",
        to: emailTo,
        subject: `New lead: ${clean(entry.name, 120)}`,
        text,
      }),
    })]);
  } else {
    channels.email = { status: "skipped", attempts: 0, error: "missing_credentials" };
    logger({ event: "lead_notification", channel: "email", status: "skipped", error: "missing_credentials" });
  }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_OWNER_CHAT) {
    jobs.push(["telegram", () => fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_OWNER_CHAT, text: `📥 New lead\n\n${text}`, disable_web_page_preview: true }),
    })]);
  } else {
    channels.telegram = { status: "skipped", attempts: 0, error: "missing_credentials" };
    logger({ event: "lead_notification", channel: "telegram", status: "skipped", error: "missing_credentials" });
  }

  if (env.NOTIFY_PHONE && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) {
    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
    jobs.push(["sms", () => fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: env.NOTIFY_PHONE, From: env.TWILIO_FROM, Body: `New lead: ${clean(entry.name, 80)} · ${clean(entry.contact, 80)} · ${inboxUrl}` }).toString(),
    })]);
  } else {
    channels.sms = { status: "skipped", attempts: 0, error: "missing_credentials" };
    logger({ event: "lead_notification", channel: "sms", status: "skipped", error: "missing_credentials" });
  }

  await Promise.all(jobs.map(async ([name, send]) => { channels[name] = await attempt(name, send, { sleepFn, logger, maxAttempts }); }));
  const configured = Object.values(channels).filter((c) => c.status !== "skipped");
  const sent = configured.filter((c) => c.status === "sent").length;
  const state = !configured.length ? "skipped" : sent === configured.length ? "sent" : sent ? "partial" : "failed";
  const result = { state, channels, updatedAt: new Date().toISOString() };
  logger({ event: "lead_notification_summary", leadId: entry.id, status: state, channels: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, v.status])) });
  return result;
}
