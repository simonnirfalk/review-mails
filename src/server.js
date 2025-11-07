import express from "express";
import { httpLogger, logger } from "./logger.js";
import { db, insertJob, cancelJob } from "./db.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(httpLogger);

// Simpel shared-secret (valgfri)
function checkSecret(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return next();
  if (req.headers["x-webhook-secret"] === secret) return next();
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Webhook: order-created (DanDomain)
app.post("/webhooks/dandomain/order-created", checkSecret, (req, res) => {
  const body = req.body || {};
  // TODO: Tilpas felt-navne når vi ser den rigtige payload
  const order = body.order || body || {};
  const customer = order.customer || {};
  const orderId = String(order.id || order.order_id || "");
  const email = (customer.email || order.email || "").trim();
  const name = [customer.first_name || customer.firstname, customer.last_name || customer.lastname].filter(Boolean).join(" ").trim();

  if (!orderId || !email) {
    return res.status(400).json({ ok: false, error: "Missing order_id or email" });
  }

  const created = order.created_at || order.date || new Date().toISOString();
  const delayDays = Number(process.env.REVIEW_DELAY_DAYS || 14);
  const sendAfter = new Date(new Date(created).getTime() + delayDays * 86400000).toISOString();

  insertJob.run({
    order_id: orderId,
    email,
    name,
    created_at: new Date(created).toISOString(),
    send_after: sendAfter
  });

  return res.json({ ok: true });
});

// Webhook: order-updated (annulleret/refunderet)
app.post("/webhooks/dandomain/order-updated", checkSecret, (req, res) => {
  const body = req.body || {};
  const order = body.order || body || {};
  const orderId = String(order.id || order.order_id || "");
  const status = (order.status || "").toLowerCase();

  if (!orderId) return res.status(400).json({ ok: false, error: "Missing order_id" });

  if (["refunded", "cancelled", "canceled"].includes(status)) {
    cancelJob.run({ order_id: orderId });
  }

  return res.json({ ok: true });
});

// Start
const port = process.env.PORT || 8080;
app.listen(port, () => {
  logger.info({ port }, "Review-mails server kører");
  startScheduler();
});
