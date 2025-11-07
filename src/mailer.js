import mailchimp from "@mailchimp/mailchimp_transactional";
import { readFileSync } from "fs";
import { logger } from "./logger.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mandrill = mailchimp(process.env.MANDRILL_API_KEY);

// Load template
const templateHtml = readFileSync(join(__dirname, "templates", "review.html"), "utf8");

// Parse FROM envs safely
function parseFrom() {
  const raw = process.env.FROM_EMAIL || "noreply@smartphoneshop.dk";
  const explicitName = process.env.FROM_NAME || "";

  // if FROM_EMAIL like "Name <email@domain>"
  const m = raw.match(/^\s*([^<]+?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) {
    const [, name, email] = m;
    return {
      from_email: email.trim(),
      from_name: explicitName || name.trim()
    };
  }
  return {
    from_email: raw.trim(),
    from_name: explicitName || ""
  };
}

// ...øverst uændret...

export async function sendReviewEmail({ toEmail, toName }) {
  const { from_email, from_name } = parseFrom();

  const message = {
    from_email,
    from_name: from_name || undefined,
    subject: "Hvordan gik din bestilling hos Smartphoneshop.dk?",
    to: [{ email: toEmail, name: toName || "", type: "to" }],
    html: renderTemplate({ name: toName || "" }),
    auto_text: true,
    preserve_recipients: false,
    headers: { "X-Review-Mail": "true" },
    metadata: { purpose: "review-request" },
    tags: ["review-request","local-test"]
  };

  try {
    // IMPORTANT: async=false to get immediate per-recipient status
    const res = await mandrill.messages.send({ message, async: false });
    logger.info({ toEmail, result: res }, "Mandrill response");

    const r = Array.isArray(res) ? res[0] : null;
    if (!r) return true;

    // Typical statuses: 'sent' | 'queued' | 'scheduled' | 'rejected' | 'invalid'
    if (r.status === "sent" || r.status === "queued" || r.status === "scheduled") return true;

    // Extra visibility if not sent/queued
    const since = new Date(Date.now() - 60*60*1000).toISOString().slice(0,19); // last hour
    const search = await mandrill.messages.search({
      query: `to:${toEmail}`,
      date_from: since
    });
    logger.warn({ toEmail, status: r.status, reject: r.reject_reason, search }, "Mandrill not-sent");
    return false;
  } catch (err) {
    const data = err?.response?.data || err?.response || err?.message || String(err);
    logger.error({ toEmail, err: data }, "Mandrill fejl");
    throw err;
  }
}

function renderTemplate({ name }) {
  const g = process.env.GOOGLE_REVIEW_URL || "#";
  const p = process.env.PRICERUNNER_REVIEW_URL || "#";
  const t = process.env.TRUSTPILOT_REVIEW_URL || "#";
  return templateHtml
    .replaceAll("{{NAME}}", name || "")
    .replaceAll("{{GOOGLE_URL}}", g)
    .replaceAll("{{PRICERUNNER_URL}}", p)
    .replaceAll("{{TRUSTPILOT_URL}}", t);
}
