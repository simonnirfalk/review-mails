// scripts/migrate-add-reminder-fields.mjs
import Database from "better-sqlite3";
import dotenv from "dotenv";

dotenv.config();

// Find sti til databasen – brug fallback hvis env ikke er sat
let dbPath = process.env.SQLITE_PATH;
if (!dbPath) {
  dbPath = "./data/review-mails.sqlite";
  console.log("⚠ SQLITE_PATH var ikke sat – bruger fallback:", dbPath);
} else {
  console.log("ℹ Bruger SQLITE_PATH:", dbPath);
}

const db = new Database(dbPath);

function tableExists(name) {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(name);
  return !!row;
}

function columnExists(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function maybeAddColumn(table, column, ddl) {
  if (!tableExists(table)) {
    throw new Error(
      `Tabellen '${table}' findes ikke i databasen '${dbPath}'. ` +
        "Kør appen én gang først, så den opretter tabellen, og prøv så migrationen igen."
    );
  }

  if (columnExists(table, column)) {
    console.log(
      `✔ Kolonne '${column}' findes allerede på '${table}' – springer over`
    );
    return;
  }

  console.log(`➕ Tilføjer kolonne '${column}' til '${table}' …`);
  db.exec(ddl);
}

try {
  db.exec("BEGIN");

  maybeAddColumn(
    "review_queue",
    "mandrill_message_id",
    "ALTER TABLE review_queue ADD COLUMN mandrill_message_id TEXT"
  );

  maybeAddColumn(
    "review_queue",
    "has_interaction",
    "ALTER TABLE review_queue ADD COLUMN has_interaction INTEGER NOT NULL DEFAULT 0"
  );

  maybeAddColumn(
    "review_queue",
    "reminder_sent_at",
    "ALTER TABLE review_queue ADD COLUMN reminder_sent_at TEXT"
  );

  maybeAddColumn(
    "review_queue",
    "reminder_count",
    "ALTER TABLE review_queue ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0"
  );

  maybeAddColumn(
    "review_queue",
    "reminder_blocked_reason",
    "ALTER TABLE review_queue ADD COLUMN reminder_blocked_reason TEXT"
  );

  db.exec("COMMIT");
  console.log("✅ Migration færdig");
} catch (err) {
  db.exec("ROLLBACK");
  console.error("❌ Migration fejlede:", err.message || err);
  process.exit(1);
} finally {
  db.close();
}
