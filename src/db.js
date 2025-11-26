import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.SQLITE_PATH;

// Ensure data folder exists
if (dbPath.startsWith("./") || dbPath.startsWith("../") || dbPath.startsWith("/")) {
  const folder = dbPath.replace(/\/[^/]+$/, "");
  mkdirSync(folder, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Schema
db.exec(`
CREATE TABLE IF NOT EXISTS review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  send_after TEXT NOT NULL,
  canceled INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  last_error TEXT,
  mandrill_message_id TEXT,
  has_interaction INTEGER NOT NULL DEFAULT 0,
  reminder_sent_at TEXT,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  reminder_blocked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_queue_send_after ON review_queue(send_after);
CREATE INDEX IF NOT EXISTS idx_review_queue_email ON review_queue(email);
`);


logger.info({ dbPath }, "SQLite initialiseret");

export const insertJob = db.prepare(`
  INSERT OR IGNORE INTO review_queue (order_id, email, name, created_at, send_after, canceled)
  VALUES (@order_id, @email, @name, @created_at, @send_after, 0)
`);

export const markSent = db.prepare(`
  UPDATE review_queue SET sent_at = @sent_at, last_error = NULL WHERE order_id = @order_id
`);

export const markError = db.prepare(`
  UPDATE review_queue SET last_error = @last_error WHERE order_id = @order_id
`);

export const cancelJob = db.prepare(`
  UPDATE review_queue SET canceled = 1 WHERE order_id = @order_id
`);

export const dueJobs = db.prepare(`
  SELECT * FROM review_queue
  WHERE canceled = 0
    AND sent_at IS NULL
    AND datetime(send_after) <= datetime('now')
  ORDER BY send_after ASC
  LIMIT 100
`);

// Markér at vi har set en “rigtig” interaktion (klik/spam/reject osv.)
// reason er valgfri (fx 'click', 'spam', 'reject') og bruges kun til info.
export const markInteraction = db.prepare(`
  UPDATE review_queue
  SET has_interaction = 1,
      reminder_blocked_reason = COALESCE(@reason, reminder_blocked_reason)
  WHERE id = @id
`);

// Find kandidater til reminder:
// - første mail er sendt
// - ikke annulleret
// - ingen interaktion
// - ingen tidligere reminder
// - sent_at er mindst @min_days dage gammel
export const reminderCandidates = db.prepare(`
  SELECT *
  FROM review_queue
  WHERE sent_at IS NOT NULL
    AND canceled = 0
    AND has_interaction = 0
    AND reminder_count = 0
    AND reminder_sent_at IS NULL
    AND julianday('now') - julianday(sent_at) >= @min_days
  ORDER BY sent_at ASC
  LIMIT 100
`);

// Markér at reminder er sendt for en given række
export const markReminderSent = db.prepare(`
  UPDATE review_queue
  SET reminder_sent_at = @sent_at,
      reminder_count = reminder_count + 1
  WHERE id = @id
`);
