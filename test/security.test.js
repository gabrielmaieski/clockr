import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, ConfigError } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashToken, purgeExpiredSessions } from '../server/auth.js';
import { RateLimiter, clientIp } from '../server/security.js';
import { csvCell, toCSV } from '../public/js/core.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');

async function startApp(options = {}, dbOptions = { adminPassword: 'senha-de-teste-forte' }) {
  const db = openDatabase(':memory:', dbOptions);
  const server = createServer(createApp(db, { publicDir: PUBLIC, ...options }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  return { db, server, base, call, close: () => new Promise((r) => server.close(r)) };
}

// Requisição crua, sem o fetch normalizar "../" no caminho.
function rawGet(base, path) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------- 1. CSV
describe('1. injeção de fórmula no CSV', () => {
  test('células perigosas recebem apóstrofo na frente', () => {
    for (const evil of ['=HYPERLINK("http://x","clique")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1', '＝1+1']) {
      const cell = csvCell(evil);
      assert.ok(cell.replace(/^"/, '').startsWith("'"), `não escapou: ${JSON.stringify(evil)} -> ${cell}`);
    }
  });

  test('texto comum não é alterado', () => {
    assert.equal(csvCell('Ana Souza'), 'Ana Souza');
    assert.equal(csvCell('Saída'), 'Saída');
  });

  test('aspas, ponto e vírgula e quebras de linha continuam escapados', () => {
    assert.equal(csvCell('a;b'), '"a;b"');
    assert.equal(csvCell('diz "oi"'), '"diz ""oi"""');
    assert.equal(csvCell('=a;b'), `"'=a;b"`);
  });

  test('relatório real com nome malicioso sai neutralizado', async () => {
    const app = await startApp();
    try {
      const reg = await app.call('POST', '/api/auth/register', {
        body: { username: 'mal', name: '=HYPERLINK("http://evil","x")', password: 'senha123' },
      });
      assert.equal(reg.status, 201);
      await app.call('POST', '/api/punches', { token: reg.data.token, body: { type: 'entrada' } });
      const admin = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'senha-de-teste-forte' } });
      const csv = await app.call('GET', '/api/admin/export.csv', { token: admin.data.token });
      const line = csv.data.split('\r\n').find((l) => l.includes('HYPERLINK'));
      assert.ok(line.startsWith(`"'=HYPERLINK`), line);
    } finally { await app.close(); }
  });

  test('toCSV aplica a proteção em todas as colunas', () => {
    const out = toCSV([{ name: '@cmd', username: 'x', created_at: new Date().toISOString(), type: 'entrada' }], 'UTC');
    assert.match(out, /\r\n'@cmd;/);
  });
});

// ---------------------------------------------------------------- 2. senha do admin
describe('2. senha do admin em produção', () => {
  test('recusa subir sem ADMIN_PASSWORD quando o admin ainda não existe', () => {
    assert.throws(() => openDatabase(':memory:', { production: true }), ConfigError);
  });

  test('recusa senhas padrão ou curtas', () => {
    for (const pw of ['admin123', 'troque-esta-senha', 'TROQUE-ESTA-SENHA', 'curta123']) {
      assert.throws(() => openDatabase(':memory:', { production: true, adminPassword: pw }), ConfigError, pw);
    }
  });

  test('aceita senha forte e o admin entra com ela', async () => {
    const app = await startApp({}, { production: true, adminPassword: 'uma-senha-bem-forte' });
    try {
      const ok = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'uma-senha-bem-forte' } });
      assert.equal(ok.status, 200);
      const dev = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
      assert.equal(dev.status, 401, 'a senha de desenvolvimento não pode funcionar');
    } finally { await app.close(); }
  });

  test('banco existente com admin sobe sem a variável', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clockr-'));
    const file = join(dir, 'db.sqlite');
    try {
      openDatabase(file, { production: true, adminPassword: 'uma-senha-bem-forte' }).close();
      assert.doesNotThrow(() => openDatabase(file, { production: true }).close());
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------- 3. cabeçalhos
describe('3. cabeçalhos de segurança', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(() => app.close());

  const expectHeaders = (h) => {
    const csp = h.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('referrer-policy'), 'no-referrer');
  };

  test('presentes na página', async () => {
    const res = await fetch(`${app.base}/`);
    assert.equal(res.status, 200);
    expectHeaders(res.headers);
  });

  test('presentes na API, sem cache', async () => {
    const r = await app.call('GET', '/api/health');
    expectHeaders(r.headers);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('presentes também nas respostas de erro', async () => {
    const r = await app.call('GET', '/api/me');
    assert.equal(r.status, 401);
    expectHeaders(r.headers);
  });

  test('o HTML não tem script nem estilo inline (senão a CSP quebraria a página)', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'script inline');
    assert.doesNotMatch(html, /\sstyle=/i, 'atributo style');
    assert.doesNotMatch(html, /\son[a-z]+=/i, 'handler inline');
  });
});

// ---------------------------------------------------------------- 4. tokens
describe('4. tokens de sessão', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(() => app.close());

  test('o banco guarda só o hash do token', async () => {
    const r = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'senha-de-teste-forte' } });
    const { token } = r.data;
    const rows = app.db.prepare('SELECT * FROM sessions').all();
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.ok(!Object.values(row).includes(token), 'token em texto puro no banco');
    }
    assert.ok(rows.some((row) => row.token_hash === hashToken(token)));
  });

  test('o hash guardado no banco não serve como token', async () => {
    const r = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'senha-de-teste-forte' } });
    const stolen = hashToken(r.data.token);
    const me = await app.call('GET', '/api/me', { token: stolen });
    assert.equal(me.status, 401);
  });

  test('logout invalida o token', async () => {
    const r = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'senha-de-teste-forte' } });
    await app.call('POST', '/api/auth/logout', { token: r.data.token });
    assert.equal((await app.call('GET', '/api/me', { token: r.data.token })).status, 401);
  });

  test('sessão expirada é recusada e removida', async () => {
    const r = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'senha-de-teste-forte' } });
    app.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run('2000-01-01T00:00:00.000Z', hashToken(r.data.token));
    assert.equal((await app.call('GET', '/api/me', { token: r.data.token })).status, 401);
    assert.equal(app.db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(hashToken(r.data.token)), undefined);
  });

  test('purgeExpiredSessions apaga só as expiradas', async () => {
    const r = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'senha-de-teste-forte' } });
    app.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('velha', 1, '2000-01-01T00:00:00.000Z')").run();
    assert.ok(purgeExpiredSessions(app.db) >= 1);
    assert.equal(app.db.prepare("SELECT 1 FROM sessions WHERE token_hash = 'velha'").get(), undefined);
    assert.equal((await app.call('GET', '/api/me', { token: r.data.token })).status, 200);
  });

  test('tokens malformados são recusados sem erro interno', async () => {
    for (const t of ["' OR 1=1 --", 'x'.repeat(5000), '../../etc/passwd', '']) {
      const r = await app.call('GET', '/api/me', { headers: { Authorization: `Bearer ${t}` } });
      assert.equal(r.status, 401, t.slice(0, 20));
    }
  });

  test('banco antigo com tokens em texto puro é migrado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clockr-'));
    const file = join(dir, 'old.sqlite');
    try {
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'employee', created_at TEXT);
        CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL);
        INSERT INTO sessions VALUES ('token-antigo', 1, '2999-01-01');`);
      old.close();
      const db = openDatabase(file, { adminPassword: 'senha-de-teste-forte' });
      const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
      assert.ok(cols.includes('token_hash') && !cols.includes('token'));
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------- 5. limite de tentativas
describe('5. limite de tentativas', () => {
  test('bloqueia o IP depois de várias senhas erradas, inclusive a senha certa', async () => {
    const app = await startApp({ limits: { loginIp: { max: 3, windowMs: 60_000 } } });
    try {
      for (let i = 0; i < 3; i++) {
        assert.equal((await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'errada' } })).status, 401);
      }
      const blocked = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'senha-de-teste-forte' } });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    } finally { await app.close(); }
  });

  test('login certo zera o contador', async () => {
    const app = await startApp({ limits: { loginIp: { max: 3, windowMs: 60_000 } } });
    try {
      for (let i = 0; i < 2; i++) await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'errada' } });
      assert.equal((await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'senha-de-teste-forte' } })).status, 200);
      for (let i = 0; i < 2; i++) {
        assert.equal((await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'errada' } })).status, 401);
      }
    } finally { await app.close(); }
  });

  test('bloqueia por usuário mesmo vindo de IPs diferentes', async () => {
    const app = await startApp({ trustProxy: true, limits: { loginUser: { max: 3, windowMs: 60_000 } } });
    try {
      for (let i = 0; i < 3; i++) {
        await app.call('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': `10.0.0.${i}` }, body: { username: 'admin', password: 'errada' } });
      }
      const r = await app.call('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': '10.0.0.99' }, body: { username: 'admin', password: 'errada' } });
      assert.equal(r.status, 429);
    } finally { await app.close(); }
  });

  test('sem TRUST_PROXY, um X-Forwarded-For falso não fura o limite', async () => {
    const app = await startApp({ limits: { loginIp: { max: 2, windowMs: 60_000 } } });
    try {
      for (let i = 0; i < 2; i++) {
        await app.call('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': `1.2.3.${i}` }, body: { username: `u${i}`, password: 'errada' } });
      }
      const r = await app.call('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': '9.9.9.9' }, body: { username: 'outro', password: 'errada' } });
      assert.equal(r.status, 429);
    } finally { await app.close(); }
  });

  test('limita cadastros por IP', async () => {
    const app = await startApp({ limits: { register: { max: 2, windowMs: 60_000 } } });
    try {
      for (let i = 0; i < 2; i++) {
        const r = await app.call('POST', '/api/auth/register', { body: { username: `user${i}`, name: 'Teste', password: 'senha123' } });
        assert.equal(r.status, 201);
      }
      const r = await app.call('POST', '/api/auth/register', { body: { username: 'user9', name: 'Teste', password: 'senha123' } });
      assert.equal(r.status, 429);
    } finally { await app.close(); }
  });

  test('não dá para descobrir usuários pelo cadastro sem limite', async () => {
    const app = await startApp({ limits: { register: { max: 3, windowMs: 60_000 } } });
    try {
      for (let i = 0; i < 3; i++) {
        const r = await app.call('POST', '/api/auth/register', { body: { username: 'admin', name: 'Teste', password: 'senha123' } });
        assert.equal(r.status, 409);
      }
      const r = await app.call('POST', '/api/auth/register', { body: { username: 'admin', name: 'Teste', password: 'senha123' } });
      assert.equal(r.status, 429);
    } finally { await app.close(); }
  });

  test('a memória do limitador tem teto', () => {
    const rl = new RateLimiter({ max: 5, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) rl.hit(`ip-${i}`);
    assert.ok(rl.size <= 100, `tamanho ${rl.size}`);
  });

  test('a janela expira', () => {
    const rl = new RateLimiter({ max: 1, windowMs: 1000 });
    rl.hit('a', 0);
    assert.ok(rl.retryAfter('a', 500) > 0);
    assert.equal(rl.retryAfter('a', 1500), 0);
  });

  test('com proxy confiável, usa o IP que o proxy acrescentou', () => {
    const req = { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, socket: { remoteAddress: '10.0.0.1' } };
    assert.equal(clientIp(req, true), '203.0.113.7');
    assert.equal(clientIp(req, false), '10.0.0.1');
  });
});

// ---------------------------------------------------------------- ataques gerais
describe('ataques comuns', () => {
  let app;
  let outside;
  before(async () => {
    app = await startApp();
    // Pasta irmã com nome parecido: "public-evil" não pode passar por "public".
    outside = join(PUBLIC, '..', 'public-evil');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'segredo.txt'), 'SEGREDO');
  });
  after(async () => {
    rmSync(outside, { recursive: true, force: true });
    await app.close();
  });

  test('path traversal não sai da pasta pública', async () => {
    for (const p of ['/../server/db.js', '/%2e%2e/server/db.js', '/..%2fserver%2fdb.js', '/%2e%2e%2fpackage.json',
      '/..%5c..%5cpackage.json', '/../public-evil/segredo.txt', '/%2e%2e/public-evil/segredo.txt',
      '/..%2fpublic-evil%2fsegredo.txt', '/%2e%2e%2fpublic-evil%2fsegredo.txt']) {
      const r = await rawGet(app.base, p);
      assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.doesNotMatch(r.body, /DatabaseSync|SEGREDO|"name": "clockr"/, p);
    }
  });

  test('URL malformada e byte nulo dão 400, não erro interno', async () => {
    assert.equal((await rawGet(app.base, '/%E0%A4%A')).status, 400);
    assert.equal((await rawGet(app.base, '/index.html%00.js')).status, 400);
  });

  test('SQL injection no login não funciona', async () => {
    for (const username of ["admin' --", "' OR '1'='1", 'admin" OR 1=1 --']) {
      const r = await app.call('POST', '/api/auth/login', { body: { username, password: "' OR '1'='1" } });
      assert.equal(r.status, 401, username);
    }
  });

  test('funcionário não acessa rotas do gestor', async () => {
    const reg = await app.call('POST', '/api/auth/register', { body: { username: 'func', name: 'Func', password: 'senha123' } });
    for (const path of ['/api/admin/summary', '/api/admin/punches', '/api/admin/export.csv']) {
      assert.equal((await app.call('GET', path, { token: reg.data.token })).status, 403, path);
    }
  });

  test('cadastro não permite virar admin', async () => {
    const r = await app.call('POST', '/api/auth/register', { body: { username: 'esperto', name: 'Esperto', password: 'senha123', role: 'admin' } });
    assert.equal(r.data.user.role, 'employee');
  });

  test('cadastros simultâneos do mesmo usuário não geram erro interno', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      app.call('POST', '/api/auth/register', { body: { username: 'duplo', name: 'Duplo', password: 'senha123' } })));
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 201).length, 1, statuses.join(','));
    assert.ok(statuses.every((s) => s === 201 || s === 409), statuses.join(','));
  });

  test('corpo muito grande é recusado', async () => {
    const r = await app.call('POST', '/api/auth/login', { body: { username: 'x', password: 'y'.repeat(20_000) } });
    assert.equal(r.status, 413);
  });

  test('erro interno não vaza detalhes', async () => {
    const r = await app.call('POST', '/api/auth/login', { headers: { 'Content-Type': 'application/json' }, body: undefined });
    assert.notEqual(r.status, 500);
    const bad = await fetch(`${app.base}/api/auth/login`, { method: 'POST', body: '{nao é json' });
    assert.equal(bad.status, 400);
    assert.doesNotMatch(await bad.text(), /at |node:|\.js:/);
  });
});
