import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'mimo-proxy.db');
export const db = new Database(DB_PATH);

export function initDb() {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      alias TEXT,
      service_token TEXT NOT NULL,
      user_id TEXT NOT NULL,
      ph_token TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      is_active INTEGER DEFAULT 1,
      banned_status TEXT DEFAULT NULL,
      active_requests INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      client_session_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      last_messages_hash TEXT,
      last_msg_count INTEGER DEFAULT 0,
      cumulative_prompt_tokens INTEGER DEFAULT 0,
      is_expired INTEGER DEFAULT 0,
      created_at TEXT,
      last_used_at TEXT,
      UNIQUE(account_id, client_session_id)
    );

    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      session_id TEXT,
      endpoint TEXT,
      model TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      reasoning_tokens INTEGER,
      duration_ms INTEGER,
      status TEXT,
      error TEXT,
      created_at TEXT
    );
  `);

  // 迁移：为旧表添加 banned_status 字段
  try {
    db.exec('ALTER TABLE accounts ADD COLUMN banned_status TEXT DEFAULT NULL');
  } catch {
    // 字段已存在，忽略错误
  }
}
