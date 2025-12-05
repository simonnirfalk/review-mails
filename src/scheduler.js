// scheduler.js
import cron from "node-cron";
import { db, dueJobs, markSent, markError, reminderCandidates, markReminderSent } from "./db.js";
import { logger } from "./logger.js";
import { sendReviewEmail } from "./mailer.js";

// Konfiguration for reminders
const REMINDER_MIN_DAYS = Number(process.env.REVIEW_REMINDER_MIN_DAYS || 7);   // 7 dage efter første mail
const REMINDER_MAX_DAYS = Number(process.env.REVIEW_REMINDER_MAX_DAYS || 14); // ikke mere end 14 dage efter første mail

// Whitelist til testfase – bruges KUN til reminders
const REMINDER_WHITELIST_RAW =
  process.env.REVIEW_REMINDER_WHITELIST || "simon@telegiganten.dk";

const REMINDER_WHITELIST_ENABLED =
  (process.env.REVIEW_REMINDER_WHITELIST_ENABLED ?? "1") !== "0";

const REMINDER_WHITELIST = new Set(
  REMINDER_WHITELIST_RAW.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function isReminderAllowedForEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!REMINDER_WHITELIST_ENABLED) return true; // whitelist slået fra
  if (!normalized) return false;
  return REMINDER_WHITELIST.has(normalized);
}

function daysBetween(isoStart, isoEnd) {
  if (!isoStart || !isoEnd) return Infinity;
  const a = Date.parse(isoStart);
  const b = Date.parse(isoEnd);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return (b - a) / 86400000; // ms -> dage
}

export function startScheduler() {
  // Kører hvert minut (cron string siger */1, kommentaren var gammel)
  cron.schedule("*/1 * * * *", async () => {
    const nowIso = new Date().toISOString();

    try {
      /* ──────────────────────────────────────────────────────────────
         1) Første udsendelse (som før)
         ──────────────────────────────────────────────────────────── */
      const rows = dueJobs.all();
      if (rows.length) {
        logger.info({ count: rows.length }, "Scheduler: udsender første review-mails");
        for (const row of rows) {
          try {
            await sendReviewEmail({
              toEmail: row.email,
              toName: row.name,
              jobId: row.id,
              // isReminder = false (default)
            });
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
            logger.error({ order_id: row.order_id, msg }, "Udsendelsesfejl (første mail)");
          }
        }
      }

      /* ──────────────────────────────────────────────────────────────
         2) Reminders
         - Kun 1 reminder
         - 7 dage efter første mail
         - Ikke hvis der er gået mere end 14 dage siden første mail
         - Kun til whitelist-mail(e) i testfasen
         ──────────────────────────────────────────────────────────── */
      const reminderRows = reminderCandidates.all({ min_days: REMINDER_MIN_DAYS });

      if (!reminderRows.length) {
        return;
      }

      logger.info(
        {
          candidates: reminderRows.length,
          REMINDER_MIN_DAYS,
          REMINDER_MAX_DAYS,
          whitelistEnabled: REMINDER_WHITELIST_ENABLED,
          whitelist: Array.from(REMINDER_WHITELIST),
        },
        "Scheduler: fandt kandidater til reminder"
      );

      for (const row of reminderRows) {
        try {
          const daysSinceFirstMail = daysBetween(row.sent_at, nowIso);

          // Skip hvis der er gået mere end REMINDER_MAX_DAYS siden første mail
          if (daysSinceFirstMail > REMINDER_MAX_DAYS) {
            logger.info(
              {
                id: row.id,
                email: row.email,
                sent_at: row.sent_at,
                daysSinceFirstMail,
              },
              "Reminder: springer over, da der er gået for mange dage siden første mail"
            );
            continue;
          }

          // Whitelist-check (kun i testfasen, og kun for reminders)
          if (!isReminderAllowedForEmail(row.email)) {
            logger.info(
              {
                id: row.id,
                email: row.email,
              },
              "Reminder: springer over pga. whitelist (testfase)"
            );
            continue;
          }

          // Send reminder
          logger.info(
            {
              id: row.id,
              order_id: row.order_id,
              email: row.email,
              name: row.name,
              sent_at: row.sent_at,
              daysSinceFirstMail,
            },
            "Scheduler: sender reminder-mail"
          );

          await sendReviewEmail({
            toEmail: row.email,
            toName: row.name,
            jobId: row.id,
            isReminder: true,
          });

          markReminderSent.run({
            id: row.id,
            sent_at: new Date().toISOString(),
          });
        } catch (err) {
          const msg = err?.message || String(err);
          logger.error(
            {
              id: row.id,
              order_id: row.order_id,
              email: row.email,
              msg,
            },
            "Udsendelsesfejl (reminder)"
          );
          // Vi lader reminder_count/reminder_sent_at stå uændret, så rækken kan forsøges igen
        }
      }
    } catch (err) {
      logger.error({ err: String(err) }, "Scheduler fejl (overordnet)");
    }
  });
}
