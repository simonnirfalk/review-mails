import Database from "better-sqlite3";

const db = new Database("./data/review-mails.sqlite");

// Henter alle jobs sorteret efter oprettelsestid
const rows = db.prepare(`
  SELECT order_id, email, name, created_at, send_after, canceled, sent_at, last_error
  FROM review_queue
  ORDER BY created_at DESC
`).all();

console.log(rows);
