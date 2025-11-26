import cron from "node-cron";
import { db, dueJobs, markSent, markError } from "./db.js";
import { logger } from "./logger.js";
import { sendReviewEmail } from "./mailer.js";

export function startScheduler() {
  // Hver 15. minut
  cron.schedule("*/1 * * * *", async () => {
    try {
      const rows = dueJobs.all();
      if (!rows.length) return;

      logger.info({ count: rows.length }, "Scheduler: udsender due mails");
      for (const row of rows) {
        try {
          await sendReviewEmail({
            toEmail: row.email,
            toName: row.name,
            jobId: row.id,           // 🔹 NYT
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
          logger.error({ order_id: row.order_id, msg }, "Udsendelsesfejl");
        }
      }
    } catch (err) {
      logger.error({ err }, "Scheduler fejl");
    }
  });
}
