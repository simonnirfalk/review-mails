import express from "express";
import { httpLogger, logger } from "./logger.js";
import { db, insertJob, cancelJob } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import crypto from "crypto";

//
// ────────────────────────────────────────────────────────────────────────────────
//  RAW BODY CAPTURE FOR HMAC
// ────────────────────────────────────────────────────────────────────────────────
//
const app = express();

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));

app.use(httpLogger);

//
// ────────────────────────────────────────────────────────────────────────────────
//  SAVING RAW WEBHOOK INPUT
// ────────────────────────────────────────────────────────────────────────────────
//
const LOGDIR = process.env.WEBHOOK_LOG_DIR || "./data/webhook-logs";
mkdirSync(LOGDIR, { recursive: true });

function saveWebhook(kind, req) {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const rnd = Math.random().toString(36).slice(2, 8);
    const base = `${ts}-${kind}-${rnd}`;

    writeFileSync(
      join(LOGDIR, `${base}.json`),
      JSON.stringify(
        {
          headers: req.headers,
          body: req.body
        },
        null,
        2
      )
    );
  } catch {}
}

//
// ────────────────────────────────────────────────────────────────────────────────
//  HMAC AUTH (DanDomain)
// ────────────────────────────────────────────────────────────────────────────────
//
function verifyDandomain(req, res, next) {
  const token = process.env.DANDOMAIN_TOKEN;
  const signature = req.headers["x-webhook-signature"];

  if (!token || !signature) {
    return res.status(401).json({ ok: false, error: "Missing signature or token" });
  }

  try {
    const hmac = crypto
      .createHmac("sha256", token)
      .update(req.rawBody || "")
      .digest("base64");

    if (hmac !== signature) {
      return res.status(401).json({ ok: false, error: "Invalid signature" });
    }

    return next();
  } catch (e) {
    return res.status(400).json({ ok: false, error: "Signature validation failed" });
  }
}

//
// ────────────────────────────────────────────────────────────────────────────────
//  WEBHOOK: ORDER CREATED
// ────────────────────────────────────────────────────────────────────────────────
//
app.post("/webhooks/dandomain/order-created", verifyDandomain, (req, res) => {
  saveWebhook("order-created", req);

  const body = req.body || {};
  const order = body.order || body || {};
  const customer = order.customer || order.Customer || {};
  const billing = order.billing || order.Billing || {};

  const orderId = String(
    order.id ||
    order.order_id ||
    order.orderId ||
    order.orderNumber ||
    order.number ||
    ""
  ).trim();

  const email = String(
    customer.email ||
    customer.Email ||
    order.email ||
    billing.email ||
    billing.Email ||
    ""
  ).trim();

  const first =
    customer.first_name ||
    customer.firstName ||
    customer.FirstName ||
    billing.first_name ||
    billing.firstName ||
    "";

  const last =
    customer.last_name ||
    customer.lastName ||
    customer.LastName ||
    billing.last_name ||
    billing.lastName ||
    "";

  const name = [first, last].filter(Boolean).join(" ").trim();

  const createdRaw =
    order.created_at ||
    order.created ||
    order.createdDate ||
    order.orderDate ||
    order.date ||
    new Date().toISOString();

  if (!orderId || !email) {
    return res.status(400).json({
      ok: false,
      error: "Missing order_id or email",
      got: { orderId, email }
    });
  }

  const createdISO = new Date(createdRaw).toISOString();
  const delayDays = Number(process.env.REVIEW_DELAY_DAYS || 14);

  const sendAfter = new Date(
    new Date(createdISO).getTime() + delayDays * 86400000
  ).toISOString();

  insertJob.run({
    order_id: orderId,
    email,
    name,
    created_at: createdISO,
    send_after: sendAfter
  });

  return res.json({ ok: true });
});

//
// ────────────────────────────────────────────────────────────────────────────────
//  WEBHOOK: ORDER UPDATED
// ────────────────────────────────────────────────────────────────────────────────
//
app.post("/webhooks/dandomain/order-updated", verifyDandomain, (req, res) => {
  saveWebhook("order-updated", req);

  const body = req.body || {};
  const order = body.order || body || {};

  const orderId = String(
    order.id ||
    order.order_id ||
    order.orderId ||
    order.orderNumber ||
    order.number ||
    ""
  ).trim();

  const status = String(
    order.status ||
    order.orderStatus ||
    order.state ||
    order.State ||
    ""
  ).toLowerCase();

  if (!orderId) {
    return res.status(400).json({ ok: false, error: "Missing order_id" });
  }

  // If refunded / canceled / annulled → cancel
  if (["refunded", "cancelled", "canceled", "annulled"].includes(status)) {
    cancelJob.run({ order_id: orderId });
  }

  return res.json({ ok: true });
});

//
// ────────────────────────────────────────────────────────────────────────────────
//  DEBUG ROUTES
// ────────────────────────────────────────────────────────────────────────────────
//
app.get("/debug/webhooks", (_req, res) => {
  try {
    const files = readdirSync(LOGDIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 50);
    res.json({ dir: LOGDIR, files });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/debug/webhooks/:file", (req, res) => {
  try {
    const f = req.params.file;
    if (!/^[\w\-\.]+\.json$/.test(f)) {
      return res.status(400).json({ error: "bad filename" });
    }
    const p = join(LOGDIR, f);
    const data = readFileSync(p, "utf8");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(data);
  } catch (e) {
    res.status(404).json({ error: "not found" });
  }
});

//
// ────────────────────────────────────────────────────────────────────────────────
//  HEALTHCHECK
// ────────────────────────────────────────────────────────────────────────────────
//
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

//
// ────────────────────────────────────────────────────────────────────────────────
//  START SERVER + SCHEDULER
// ────────────────────────────────────────────────────────────────────────────────
//
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  logger.info({ PORT }, "review-mails server kører");
  startScheduler();
});
