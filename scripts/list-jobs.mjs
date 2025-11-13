import Database from "better-sqlite3";

const dbPath = process.env.SQLITE_PATH || "./data/review-mails.sqlite";
const db = new Database(dbPath);

const rows = db.prepare("SELECT * FROM review_queue ORDER BY created_at DESC LIMIT 10").all();
console.log(rows);
