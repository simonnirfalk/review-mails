// mailer.js
import mailchimp from "@mailchimp/mailchimp_transactional";
import { readFileSync } from "fs";
import { logger } from "./logger.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mandrill = mailchimp(process.env.MANDRILL_API_KEY);

// ---------------------------------------------------------------------------
// Konfiguration: enable/disable
// ---------------------------------------------------------------------------
const MAILER_ENABLED = process.env.MAILER_ENABLED === "1";

// Load template
const templateHtml = readFileSync(
  join(__dirname, "templates", "review.html"),
  "utf8"
);

// Parse FROM envs safely
function parseFrom() {
  const raw = process.env.FROM_EMAIL || "femstjerner@smartphoneshop.dk";
  const explicitName = process.env.FROM_NAME || "";

  // if FROM_EMAIL like "Name <email@domain>"
  const m = raw.match(/^\s*([^<]+?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) {
    const [, name, email] = m;
    return {
      from_email: email.trim(),
      from_name: explicitName || name.trim(),
    };
  }
  return {
    from_email: raw.trim(),
    from_name: explicitName || "",
  };
}

export async function sendReviewEmail({ toEmail, toName, jobId }) {
  const normalizedTo = (toEmail || "").trim().toLowerCase();

  if (!normalizedTo) {
    logger.warn({ toEmail }, "MAILER: mangler modtageradresse – sender ikke");
    return false;
  }

  // 1) Global switch: slå alt fra (ingen mails til nogen)
  if (!MAILER_ENABLED) {
    logger.info(
      { toEmail: normalizedTo },
      "MAILER_ENABLED=0 – ville have sendt review-mail, men springer over"
    );
    // return false => job ender som 'error' og bliver ikke sendt senere ved et uheld
    return false;
  }

  const { from_email, from_name } = parseFrom();

  // Render HTML med links (og log dem)
  const html = renderTemplate({ name: toName || "" });

  const message = {
    from_email,
    from_name: from_name || undefined,
    subject: "Havde du en femstjernet oplevelse med Smartphoneshop.dk?",
    to: [{ email: normalizedTo, name: toName || "", type: "to" }],
    html,
    auto_text: true,
    preserve_recipients: false,
    headers: { "X-Review-Mail": "true" },
    tags: ["review-request", "local-test"],

    // 🔍 eksplicit tracking
    track_opens: true,
    track_clicks: true,

    ...(jobId && {
      metadata: {
        review_job_id: String(jobId),
      },
    }),
  };

  logger.info(
    {
      to: normalizedTo,
      track_opens: message.track_opens,
      track_clicks: message.track_clicks,
      hasMetadata: !!message.metadata,
      metadata: message.metadata,
    },
    "MAILER: sender review-mail via Mandrill"
  );

  try {
    // IMPORTANT: async=false to get immediate per-recipient status
    const res = await mandrill.messages.send({ message, async: false });
    logger.info({ toEmail: normalizedTo, result: res }, "Mandrill response");

    const r = Array.isArray(res) ? res[0] : null;
    if (!r) return true;

    // Typical statuses: 'sent' | 'queued' | 'scheduled' | 'rejected' | 'invalid'
    if (
      r.status === "sent" ||
      r.status === "queued" ||
      r.status === "scheduled"
    ) {
      return true;
    }

    // Extra visibility if not sent/queued
    const since = new Date(Date.now() - 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19); // last hour
    const search = await mandrill.messages.search({
      query: `to:${normalizedTo}`,
      date_from: since,
    });
    logger.warn(
      { toEmail: normalizedTo, status: r.status, reject: r.reject_reason, search },
      "Mandrill not-sent"
    );
    return false;
  } catch (err) {
    const data =
      err?.response?.data || err?.response || err?.message || String(err);
    logger.error({ toEmail: normalizedTo, err: data }, "Mandrill fejl");
    throw err;
  }
}

function renderTemplate({ name }) {
  // Prøv først de nye navne (GOOGLE_URL osv.),
  // fald tilbage til de gamle *_REVIEW_URL hvis de findes,
  // og ellers til '#'
  const g =
    process.env.GOOGLE_URL ||
    process.env.GOOGLE_REVIEW_URL ||
    "#";

  const p =
    process.env.PRICERUNNER_URL ||
    process.env.PRICERUNNER_REVIEW_URL ||
    "#";

  const t =
    process.env.TRUSTPILOT_URL ||
    process.env.TRUSTPILOT_REVIEW_URL ||
    "#";

  // Log lige hvilke links vi sender med (til debug af click tracking)
  logger.info(
    { GOOGLE_URL: g, PRICERUNNER_URL: p, TRUSTPILOT_URL: t },
    "MAILER: review-links i template"
  );

  return templateHtml
    .replaceAll("{{NAME}}", name || "")
    .replaceAll("{{GOOGLE_URL}}", g)
    .replaceAll("{{PRICERUNNER_URL}}", p)
    .replaceAll("{{TRUSTPILOT_URL}}", t);
}
