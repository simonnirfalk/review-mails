// server.js
import "dotenv/config";
import express from "express";
import { httpLogger, logger } from "./logger.js";
import { db, insertJob, cancelJob } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { attachDandomainDebugRoutes, fetchOrderById } from "./dandomain.js";

/**
 * Express app with raw-body capture (needed originally for HMAC verification)
 */
const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);
app.use(httpLogger);

/* ──────────────────────────────────────────────────────────────────────────────
   LOGDIR (with fallback if /data is not writable)
   ──────────────────────────────────────────────────────────────────────────── */
let LOGDIR = process.env.WEBHOOK_LOG_DIR || "/data/webhook-logs";
try {
  mkdirSync(LOGDIR, { recursive: true });
} catch (e) {
  LOGDIR = "./data/webhook-logs";
  try {
    mkdirSync(LOGDIR, { recursive: true });
    logger.warn(
      { LOGDIR, error: String(e) },
      "Falling back to local webhook log dir"
    );
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
          method: req.method,
          url: req.originalUrl || req.url,
          rawBody: req.rawBody,
          body: req.body,
        },
        null,
        2
      )
    );
  } catch {
    // best-effort only
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   (Legacy) HMAC helpers – DanDomain webhooks er ikke signeret,
   men vi lader helperen blive hvis vi får brug for den senere.
   ──────────────────────────────────────────────────────────────────────────── */
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

// DanDomain signerer ikke webhooks, så vi accepterer alle og validerer data selv.
function verifyDandomain(_req, _res, next) {
  return next();
}

/* ──────────────────────────────────────────────────────────────────────────────
   Health
   ──────────────────────────────────────────────────────────────────────────── */
app.get("/health", (_req, res) => {
  try {
    db.prepare("select 1").get();
    return res.json({ ok: true });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

/* ──────────────────────────────────────────────────────────────────────────────
   WEBHOOK: order-created  (respond fast; do the work async)
   Payload from DanDomain: { "id": "<orderId>" }
   ──────────────────────────────────────────────────────────────────────────── */
app.post(
  "/webhooks/dandomain/order-created",
  verifyDandomain,
  (req, res) => {
    saveWebhook("order-created", req);

    const body = req.body || {};
    const orderId = String(
      body.id || body.orderId || body.order_id || ""
    ).trim();

    if (!orderId) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing id in payload" });
    }

    // Respond immediately to avoid DanDomain 5s timeout
    res.json({ ok: true, received: orderId });

    // Work asynchronously: fetch order via GraphQL, extract email/name, queue job
    (async () => {
      try {
        const order = await fetchOrderById(orderId);
        if (!order) {
          return logger.warn({ orderId }, "Order not found via GraphQL");
        }

        const email =
          order?.customer?.billingAddress?.email ||
          order?.customer?.shippingAddress?.email ||
          "";

        const name = [
          order?.customer?.billingAddress?.firstName,
          order?.customer?.billingAddress?.lastName,
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

        if (!email) {
          return logger.warn(
            { orderId },
            "No email on order; skipping queue insert"
          );
        }

        const createdISO = new Date(
          order?.createdAt || Date.now()
        ).toISOString();
        const delayDays = Number(process.env.REVIEW_DELAY_DAYS || 14);
        const sendAfter = new Date(
          new Date(createdISO).getTime() + delayDays * 86400000
        ).toISOString();

        insertJob.run({
          order_id: orderId,
          email,
          name,
          created_at: createdISO,
          send_after: sendAfter,
        });

        logger.info({ orderId, email }, "Queued review mail");
      } catch (err) {
        logger.error(
          { orderId, err: err?.message || String(err) },
          "Failed to process order-created"
        );
      }
    })();
  }
);

/* ──────────────────────────────────────────────────────────────────────────────
   WEBHOOK: order-updated / orders/cancelled
   Bruges til at markere review-jobs som annullerede når en ordre annulleres.
   DanDomain sender:
     - Header: x-webhook-topic: "orders/cancelled"
     - Body:   { "id": "<orderId>" }
   ──────────────────────────────────────────────────────────────────────────── */
app.post(
  "/webhooks/dandomain/order-updated",
  verifyDandomain,
  (req, res) => {
    saveWebhook("order-updated", req);

    const body = req.body || {};
    const topic = String(req.headers["x-webhook-topic"] || "");
    const orderId = String(
      body.id ?? body.orderId ?? body.order_id ?? ""
    ).trim();

    if (topic === "orders/cancelled" && orderId) {
      try {
        cancelJob.run({ order_id: orderId });
        logger.info(
          { orderId, topic },
          "Order cancelled – review job marked as canceled"
        );
      } catch (err) {
        logger.error(
          { orderId, err: err?.message || String(err) },
          "Failed to cancel review job"
        );
      }
    } else {
      logger.info(
        { orderId, topic },
        "order-updated webhook received (no cancellation action)"
      );
    }

    res.json({ ok: true });
  }
);

/* ──────────────────────────────────────────────────────────────────────────────
   Start
   ──────────────────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 8080;
attachDandomainDebugRoutes(app);

app.listen(PORT, () => {
  logger.info({ PORT }, "review-mails server running");
  startScheduler();
});
