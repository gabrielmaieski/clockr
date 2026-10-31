import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword } from './auth.js';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS punches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL CHECK (type IN ('entrada', 'saida_almoco', 'volta_almoco', 'saida')),
    created_at TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_punches_user_time ON punches (user_id, created_at);
`;

export function openDatabase(file, { adminPassword } = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!hasAdmin) {
    const password = adminPassword || 'admin123';
    db.prepare("INSERT INTO users (username, name, password_hash, role) VALUES ('admin', 'Administrador', ?, 'admin')")
      .run(hashPassword(password));
    if (!adminPassword) {
      console.warn('[clockr] Usuário admin criado com a senha padrão "admin123". Defina ADMIN_PASSWORD em produção.');
    }
  }
  return db;
}
