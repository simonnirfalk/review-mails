// scripts/list-tables.mjs
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "review-mails.sqlite");

const db = new Database(dbPath);
console.log("DB path:", dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log(tables);
