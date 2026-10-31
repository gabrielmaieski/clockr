import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword, purgeExpiredSessions } from './auth.js';

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
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

  CREATE TABLE IF NOT EXISTS punches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL CHECK (type IN ('entrada', 'saida_almoco', 'volta_almoco', 'saida')),
    created_at TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_punches_user_time ON punches (user_id, created_at);
`;

// Senhas que nunca podem ser usadas pelo admin em produção.
const KNOWN_DEFAULTS = new Set(['admin123', 'troque-esta-senha', 'admin', 'password', 'senha123', '12345678']);
export const DEV_ADMIN_PASSWORD = 'admin123';

export class ConfigError extends Error {}

// Em produção: se a senha for informada, ela precisa ser forte; e se o admin
// ainda não existir, a senha é obrigatória (nunca cai na senha de desenvolvimento).
export function checkAdminPassword(password, { production, adminExists }) {
  if (!production) return;
  if (!password) {
    if (adminExists) return;
    throw new ConfigError('ADMIN_PASSWORD é obrigatória em produção (NODE_ENV=production) para criar o usuário admin.');
  }
  if (password.length < 12 || KNOWN_DEFAULTS.has(password.toLowerCase())) {
    throw new ConfigError('ADMIN_PASSWORD fraca: use pelo menos 12 caracteres e não use senhas padrão.');
  }
}

// Bancos criados antes do hash de tokens tinham a coluna "token" em texto puro.
// A tabela é recriada: as sessões antigas são descartadas e todos entram de novo.
function migrateSessions(db) {
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (cols.length && !cols.includes('token_hash')) {
    db.exec('DROP TABLE sessions');
  }
}

export function openDatabase(file, { adminPassword, production = false } = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  migrateSessions(db);
  db.exec(SCHEMA);
  purgeExpiredSessions(db);

  const hasAdmin = Boolean(db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get());
  try {
    checkAdminPassword(adminPassword, { production, adminExists: hasAdmin });
  } catch (err) {
    db.close();
    throw err;
  }
  if (!hasAdmin) {
    const password = adminPassword || DEV_ADMIN_PASSWORD;
    db.prepare("INSERT INTO users (username, name, password_hash, role) VALUES ('admin', 'Administrador', ?, 'admin')")
      .run(hashPassword(password));
    if (!adminPassword) {
      console.warn(`[clockr] Usuário admin criado com a senha de desenvolvimento "${DEV_ADMIN_PASSWORD}". Não use assim em produção.`);
    }
  }
  return db;
}
