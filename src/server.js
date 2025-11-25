// server.js
import "dotenv/config";
import express from "express";
import { httpLogger, logger } from "./logger.js";
import { db, insertJob, cancelJob, markSent, markError } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { attachDandomainDebugRoutes, fetchOrderById } from "./dandomain.js";
import { sendReviewEmail } from "./mailer.js";

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
app.use(express.urlencoded({ extended: true }));

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
   Simpel admin-auth til dashboard
   ──────────────────────────────────────────────────────────────────────────── */

const ADMIN_KEY = process.env.REVIEW_ADMIN_KEY;

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res
      .status(500)
      .send("Missing REVIEW_ADMIN_KEY in environment");
  }

  const key =
    req.query.key ||
    req.headers["x-admin-key"];

  if (key !== ADMIN_KEY) {
    return res.status(403).send("Forbidden");
  }

  next();
}

/**
 * Hjælper til at beregne en menneskelig status på en review_queue-række.
 * Bruger kun de felter, der faktisk findes i schemaet.
 */
function computeStatus(row) {
  if (row.canceled) return "canceled";
  if (row.last_error && !row.sent_at) return "error";
  if (row.last_error && row.sent_at) return "sent-with-error";
  if (row.sent_at) return "sent";

  const nowIso = new Date().toISOString();
  if (row.send_after <= nowIso) return "due";       // burde blive taget af scheduler
  return "scheduled";                               // venter på send_after
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
   Admin dashboard til review_queue
   ──────────────────────────────────────────────────────────────────────────── */

app.get("/admin/review-queue", requireAdmin, (req, res) => {
  // Hent de seneste 200 rækker
  const rows = db
    .prepare(
      `SELECT id, order_id, email, name, created_at, send_after, canceled, sent_at, last_error
       FROM review_queue
       ORDER BY datetime(created_at) DESC
       LIMIT 200`
    )
    .all();

  const statusFilter = (req.query.status || "all").toLowerCase();

  const withStatus = rows.map((row) => ({
    ...row,
    status: computeStatus(row),
  }));

  const filtered =
    statusFilter === "all"
      ? withStatus
      : withStatus.filter((r) => r.status === statusFilter);

  const keyParam = req.query.key
    ? `&key=${encodeURIComponent(req.query.key)}`
    : "";

  const htmlRows =
    filtered.length === 0
      ? `<tr><td colspan="11">Ingen rækker fundet</td></tr>`
      : filtered
          .map((row) => {
            const canceledLabel = row.canceled ? "Ja" : "Nej";
            const status = row.status;

            const cancelBtn = row.canceled
              ? `<form method="post" action="/admin/review-queue/${row.id}/uncancel?key=${encodeURIComponent(
                  req.query.key || ""
                )}" style="display:inline-block;margin-right:4px">
                   <button type="submit">Genaktiver</button>
                 </form>`
              : `<form method="post" action="/admin/review-queue/${row.id}/cancel?key=${encodeURIComponent(
                  req.query.key || ""
                )}" style="display:inline-block;margin-right:4px">
                   <button type="submit">Annuller</button>
                 </form>`;

            const resendBtn = row.canceled
              ? ""
              : `<form method="post" action="/admin/review-queue/${row.id}/resend?key=${encodeURIComponent(
                  req.query.key || ""
                )}" style="display:inline-block">
                   <button type="submit">Send nu</button>
                 </form>`;

            return `
              <tr>
                <td>${row.id}</td>
                <td>${row.order_id}</td>
                <td>${row.email}</td>
                <td>${row.name || ""}</td>
                <td>${row.status}</td>
                <td>${row.created_at}</td>
                <td>${row.send_after}</td>
                <td>${row.sent_at || ""}</td>
                <td>${canceledLabel}</td>
                <td>${row.last_error || ""}</td>
                <td>
                  ${cancelBtn}
                  ${resendBtn}
                </td>
              </tr>
            `;
          })
          .join("");

  const statuses = [
    "all",
    "scheduled",
    "due",
    "sent",
    "sent-with-error",
    "error",
    "canceled",
  ];

  res.send(`
    <!doctype html>
    <html lang="da">
      <head>
        <meta charset="utf-8" />
        <title>Review queue admin</title>
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            padding: 16px;
            max-width: 1200px;
            margin: 0 auto;
          }
          h1 {
            margin-top: 0;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            font-size: 13px;
          }
          th, td {
            border: 1px solid #e5e7eb;
            padding: 4px 6px;
            vertical-align: top;
          }
          th {
            background: #f3f4f6;
            text-align: left;
            position: sticky;
            top: 0;
            z-index: 1;
          }
          form {
            margin: 0;
          }
          button {
            font-size: 11px;
            padding: 3px 6px;
            cursor: pointer;
          }
          .filters {
            margin-bottom: 12px;
          }
          .filters a {
            margin-right: 8px;
            text-decoration: none;
            color: #111827;
          }
          .filters a.active {
            font-weight: 700;
            text-decoration: underline;
          }
          .meta {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 8px;
          }
        </style>
      </head>
      <body>
        <h1>Review queue</h1>
        <div class="meta">
          Viser ${filtered.length} rækker (af i alt ${rows.length} hentet).
        </div>
        <div class="filters">
          Status:
          ${statuses
            .map((s) => {
              const active = statusFilter === s ? "active" : "";
              const href =
                s === "all"
                  ? `/admin/review-queue?status=all${keyParam}`
                  : `/admin/review-queue?status=${encodeURIComponent(
                      s
                    )}${keyParam}`;
              return `<a class="${active}" href="${href}">${s}</a>`;
            })
            .join(" | ")}
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Ordre-ID</th>
              <th>E-mail</th>
              <th>Navn</th>
              <th>Status</th>
              <th>Oprettet</th>
              <th>Send efter</th>
              <th>Sendt</th>
              <th>Annulleret</th>
              <th>Sidste fejl</th>
              <th>Handling</th>
            </tr>
          </thead>
          <tbody>
            ${htmlRows}
          </tbody>
        </table>
      </body>
    </html>
  `);
});

/* ──────────────────────────────────────────────────────────────────────────────
   WEBHOOK: order-shipped  (orders/fulfilled)
   Triggered when the order is shipped. This is when we want to queue the review.
   ──────────────────────────────────────────────────────────────────────────── */
app.post(
  "/webhooks/dandomain/order-shipped",
  verifyDandomain,
  (req, res) => {
    saveWebhook("order-shipped", req);

    const body = req.body || {};
    const orderId = String(
      body.id || body.orderId || body.order_id || ""
    ).trim();

    if (!orderId) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing id in payload" });
    }

    // Respond immediately so DanDomain doesn't retry
    res.json({ ok: true, received: orderId });

    // Process asynchronously
    (async () => {
      try {
        const order = await fetchOrderById(orderId);
        if (!order) {
          return logger.warn(
            { orderId },
            "Order not found via GraphQL (order-shipped)"
          );
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
            "No email on order; skipping queue insert (order-shipped)"
          );
        }

        // New logic: createdAt = now
        const createdISO = new Date().toISOString();
        const delayDays = Number(process.env.REVIEW_DELAY_DAYS || 5);

        const sendAfter = new Date(
          Date.now() + delayDays * 86400000
        ).toISOString();

        insertJob.run({
          order_id: orderId,
          email,
          name,
          created_at: createdISO,
          send_after: sendAfter,
        });

        logger.info(
          { orderId, email },
          "Queued review mail (order-shipped)"
        );
      } catch (err) {
        logger.error(
          { orderId, err: err?.message || String(err) },
          "Failed to process order-shipped"
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

// LIGE OVER "Start"-sektionen i server.js
app.get("/debug/review-queue", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM review_queue ORDER BY created_at DESC").all();
    res.json({ ok: true, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* ──────────────────────────────────────────────────────────────────────────────
   Admin actions til review_queue
   ──────────────────────────────────────────────────────────────────────────── */

app.post("/admin/review-queue/:id/cancel", requireAdmin, (req, res) => {
  const { id } = req.params;

  db.prepare("UPDATE review_queue SET canceled = 1 WHERE id = ?").run(id);

  const keyParam = req.query.key
    ? `?key=${encodeURIComponent(req.query.key)}`
    : "";
  res.redirect(`/admin/review-queue${keyParam}`);
});

app.post("/admin/review-queue/:id/uncancel", requireAdmin, (req, res) => {
  const { id } = req.params;

  db.prepare("UPDATE review_queue SET canceled = 0 WHERE id = ?").run(id);

  const keyParam = req.query.key
    ? `?key=${encodeURIComponent(req.query.key)}`
    : "";
  res.redirect(`/admin/review-queue${keyParam}`);
});

app.post("/admin/review-queue/:id/resend", requireAdmin, async (req, res) => {
  const { id } = req.params;

  const row = db
    .prepare(
      "SELECT id, order_id, email, name FROM review_queue WHERE id = ?"
    )
    .get(id);

  if (!row) {
    return res.status(404).send("Row not found");
  }

  try {
    await sendReviewEmail({ toEmail: row.email, toName: row.name });
    markSent.run({
      order_id: row.order_id,
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err?.message || String(err);
    markError.run({
      order_id: row.order_id,
      last_error: msg.slice(0, 500),
    });
    logger.error({ id: row.id, msg }, "Admin resend failed");
  }

  const keyParam = req.query.key
    ? `?key=${encodeURIComponent(req.query.key)}`
    : "";
  res.redirect(`/admin/review-queue${keyParam}`);
});


/* ──────────────────────────────────────────────────────────────────────────────
   Start
   ──────────────────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 8080;
attachDandomainDebugRoutes(app);

app.listen(PORT, () => {
  logger.info({ PORT }, "review-mails server running");
  startScheduler();
});
