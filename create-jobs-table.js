// create-jobs-table.js  (ESM version)
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Sørg for at køre relativt til projektroden
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "review-mails.sqlite");
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  email TEXT,
  name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  send_after TEXT,
  status TEXT DEFAULT 'queued',
  attempts INTEGER DEFAULT 0,
  last_error TEXT
);
`);

console.log("✅ Table 'jobs' created or already exists at", dbPath);
