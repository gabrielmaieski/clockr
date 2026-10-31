import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_DAYS = 7;

// Senhas guardadas como "salt:hash" usando scrypt.
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Hash usado quando o usuário não existe, para o login levar o mesmo tempo
// e não revelar quais usuários estão cadastrados.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));
export function burnPasswordCheck(password) {
  verifyPassword(password, DUMMY_HASH);
}

// O banco guarda só o SHA-256 do token. Se o banco vazar, os tokens
// guardados não servem para entrar no sistema.
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, expires);
  return token;
}

export function userFromToken(db, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT u.id, u.username, u.name, u.role, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(tokenHash);
  if (!row) return null;
  if (new Date(row.expires_at) <= new Date()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  const { expires_at, ...user } = row;
  return user;
}

export function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function purgeExpiredSessions(db) {
  return Number(db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString()).changes);
}
