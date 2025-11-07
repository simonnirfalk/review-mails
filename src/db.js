import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.SQLITE_PATH || "./data/review-mails.sqlite";

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
  last_error TEXT
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
