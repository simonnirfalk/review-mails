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
//  LOGDIR (med /data fallback hvis ikke skrivbar)
// ────────────────────────────────────────────────────────────────────────────────
//
let LOGDIR = process.env.WEBHOOK_LOG_DIR || "/data/webhook-logs";
try {
  mkdirSync(LOGDIR, { recursive: true });
} catch (e) {
  // Fallback til repo-lokal mappe (ikke persistent på Render)
  LOGDIR = "./data/webhook-logs";
  try {
    mkdirSync(LOGDIR, { recursive: true });
    logger.warn({ LOGDIR, error: String(e) }, "Falling back to local webhook log dir");
  } catch {}
}

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
/*  HMAC AUTH (DanDomain)  */
// ────────────────────────────────────────────────────────────────────────────────
//
function timingSafeEq(a, b) {
  try {
    const ab = Buffer.from(String(a) || "", "utf8");
    const bb = Buffer.from(String(b) || "", "utf8");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function verifyDandomain(req, res, next) {
  const token = process.env.DANDOMAIN_TOKEN;
  // DanDomain kan sende signaturen i disse header-navne
  const sigHeader =
    req.headers["x-webhook-signature"] ||
    req.headers["x-hmac-sha256"] ||
    req.headers["x-hmac"];

  if (!token || !sigHeader) {
    return res.status(401).json({ ok: false, error: "Missing signature or token" });
  }

  // Rå body som sendt over nettet; fallback til JSON.stringify hvis verify-hook ikke satte rawBody
  const raw = typeof req.rawBody === "string"
    ? req.rawBody
    : JSON.stringify(req.body ?? {});

  try {
    const computed = crypto.createHmac("sha256", token).update(raw).digest("base64");
    if (!timingSafeEq(computed, sigHeader)) {
      if (process.env.DEBUG_WEBHOOKS === "1") {
        console.warn("Verify failed", {
          topic: req.headers["x-webhook-topic"],
          len: raw.length
        });
      }
      return res.status(401).json({ ok: false, error: "Invalid signature" });
    }
    return next();
  } catch {
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
