import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH = path.resolve("data/chog_dash.db");

export function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(fs.readFileSync(path.resolve("db/schema.sql"), "utf8"));
  return db;
}
