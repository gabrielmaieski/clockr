import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createSession, deleteSession, hashPassword, userFromToken, verifyPassword } from './auth.js';
import {
  PUNCH_TYPES, dayKey, nextAllowed, statusFromLast, toCSV, workedMinutes,
  validateName, validatePassword, validateUsername,
} from '../public/js/core.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isText ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10_000) throw new HttpError(413, 'Requisição muito grande');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'JSON inválido'); }
}

// Limite simples de tentativas de login por IP.
function createLoginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now - entry.start > windowMs) {
      hits.set(ip, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

export function createApp(db, { timeZone = 'America/Sao_Paulo', publicDir } = {}) {
  const staticRoot = publicDir ? resolve(publicDir) : null;
  const allowLogin = createLoginLimiter();

  const q = {
    userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    insertUser: db.prepare("INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, 'employee')"),
    lastPunch: db.prepare('SELECT type, created_at FROM punches WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'),
    insertPunch: db.prepare('INSERT INTO punches (user_id, type, created_at) VALUES (?, ?, ?)'),
    punchesByUser: db.prepare(`SELECT p.id, p.type, p.created_at, u.name, u.username
      FROM punches p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT ?`),
    punchesSince: db.prepare(`SELECT p.id, p.user_id, p.type, p.created_at, u.name, u.username
      FROM punches p JOIN users u ON u.id = p.user_id
      WHERE p.created_at >= ? ORDER BY p.created_at DESC, p.id DESC`),
    allPunches: db.prepare(`SELECT p.id, p.user_id, p.type, p.created_at, u.name, u.username
      FROM punches p JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?`),
    employees: db.prepare("SELECT id, username, name, role, created_at FROM users ORDER BY name"),
  };

  const today = (d = new Date()) => dayKey(d, timeZone);
  const isToday = (iso) => today(new Date(iso)) === today();

  function todayState(userId) {
    const last = q.lastPunch.get(userId);
    const lastToday = last && isToday(last.created_at) ? last.type : null;
    return { lastType: lastToday, status: statusFromLast(lastToday), next: nextAllowed(lastToday) };
  }

  // Busca com folga de 2 dias e filtra pelo dia local, para não errar o fuso.
  function punchesToday() {
    const since = new Date(Date.now() - 2 * 86400000).toISOString();
    return q.punchesSince.all(since).filter((p) => isToday(p.created_at));
  }

  function requireUser(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = userFromToken(db, token);
    if (!user) throw new HttpError(401, 'Sessão inválida ou expirada');
    return { user, token };
  }

  function requireAdmin(req) {
    const ctx = requireUser(req);
    if (ctx.user.role !== 'admin') throw new HttpError(403, 'Acesso restrito ao administrador');
    return ctx;
  }

  const routes = {
    'GET /api/health': () => ({ status: 'ok', mode: 'api', timeZone }),

    'POST /api/auth/register': async (req) => {
      const { username, name, password } = await readJson(req);
      const u = String(username || '').trim().toLowerCase();
      if (!validateUsername(u)) throw new HttpError(400, 'Usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou _');
      if (!validateName(name)) throw new HttpError(400, 'Informe seu nome (2 a 60 caracteres)');
      if (!validatePassword(password)) throw new HttpError(400, 'A senha precisa ter pelo menos 6 caracteres');
      if (q.userByUsername.get(u)) throw new HttpError(409, 'Esse usuário já existe');
      const { lastInsertRowid } = q.insertUser.run(u, name.trim(), hashPassword(password));
      const id = Number(lastInsertRowid);
      return [201, { token: createSession(db, id), user: { id, username: u, name: name.trim(), role: 'employee' } }];
    },

    'POST /api/auth/login': async (req) => {
      if (!allowLogin(req.socket.remoteAddress)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
      const { username, password } = await readJson(req);
      const row = q.userByUsername.get(String(username || '').trim().toLowerCase());
      if (!row || !verifyPassword(String(password || ''), row.password_hash)) {
        throw new HttpError(401, 'Usuário ou senha incorretos');
      }
      const { password_hash, created_at, ...user } = row;
      return { token: createSession(db, row.id), user };
    },

    'POST /api/auth/logout': (req) => {
      const { token } = requireUser(req);
      deleteSession(db, token);
      return { ok: true };
    },

    'GET /api/me': (req) => {
      const { user } = requireUser(req);
      return { user, today: todayState(user.id) };
    },

    'GET /api/punches': (req, url) => {
      const { user } = requireUser(req);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
      return { punches: q.punchesByUser.all(user.id, limit) };
    },

    'POST /api/punches': async (req) => {
      const { user } = requireUser(req);
      const { type } = await readJson(req);
      if (!PUNCH_TYPES.includes(type)) throw new HttpError(400, 'Tipo de marcação inválido');
      const state = todayState(user.id);
      if (!state.next.includes(type)) throw new HttpError(409, 'Essa marcação não é permitida agora');
      const created_at = new Date().toISOString();
      const { lastInsertRowid } = q.insertPunch.run(user.id, type, created_at);
      return [201, { punch: { id: Number(lastInsertRowid), type, created_at }, today: todayState(user.id) }];
    },

    'GET /api/punches/export.csv': (req) => {
      const { user } = requireUser(req);
      const rows = q.punchesByUser.all(user.id, 100000);
      return ['csv', toCSV(rows, timeZone), `clockr-${user.username}.csv`];
    },

    'GET /api/admin/summary': (req) => {
      requireAdmin(req);
      const todays = punchesToday();
      const team = q.employees.all().filter((u) => u.role === 'employee').map((u) => {
        const mine = todays.filter((p) => p.user_id === u.id);
        const last = mine[0]?.type ?? null;
        return {
          id: u.id, name: u.name, username: u.username,
          status: statusFromLast(last),
          firstIn: mine.filter((p) => p.type === 'entrada').at(-1)?.created_at ?? null,
          lastAt: mine[0]?.created_at ?? null,
          workedMinutes: workedMinutes(mine),
        };
      });
      return {
        team,
        totals: {
          employees: team.length,
          working: team.filter((t) => t.status === 'trabalhando').length,
          lunch: team.filter((t) => t.status === 'almoco').length,
          punchesToday: todays.length,
        },
      };
    },

    'GET /api/admin/punches': (req, url) => {
      requireAdmin(req);
      const userId = Number(url.searchParams.get('user_id')) || null;
      const date = url.searchParams.get('date');
      let rows = q.allPunches.all(5000);
      if (userId) rows = rows.filter((r) => r.user_id === userId);
      if (date) rows = rows.filter((r) => today(new Date(r.created_at)) === date);
      return { punches: rows.slice(0, 1000) };
    },

    'GET /api/admin/export.csv': (req) => {
      requireAdmin(req);
      return ['csv', toCSV(q.allPunches.all(1_000_000), timeZone), 'clockr-relatorio-completo.csv'];
    },
  };

  async function serveStatic(res, pathname) {
    if (!staticRoot) return send(res, 404, { error: 'Não encontrado' });
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = resolve(join(staticRoot, normalize(rel)));
    if (!file.startsWith(staticRoot)) return send(res, 403, { error: 'Proibido' });
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    } catch {
      send(res, 404, { error: 'Não encontrado' });
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não permitido' });
        return await serveStatic(res, url.pathname);
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) throw new HttpError(404, 'Rota não encontrada');
      const result = await route(req, url);
      if (Array.isArray(result) && result[0] === 'csv') {
        return send(res, 200, result[1], {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result[2]}"`,
        });
      }
      const [status, body] = Array.isArray(result) ? result : [200, result];
      send(res, status, body);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, { error: status === 500 ? 'Erro interno' : err.message });
    }
  };
}
