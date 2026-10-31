import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

let server;
let base;

before(async () => {
  const db = openDatabase(':memory:', { adminPassword: 'segredo123' });
  server = createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

test('health responde ok', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'ok');
});

test('cadastro valida os campos', async () => {
  const r = await call('POST', '/api/auth/register', { body: { username: 'A', name: 'x', password: '1' } });
  assert.equal(r.status, 400);
});

test('fluxo completo do funcionário', async () => {
  const reg = await call('POST', '/api/auth/register', { body: { username: 'ana', name: 'Ana Souza', password: 'senha123' } });
  assert.equal(reg.status, 201);
  const { token } = reg.data;

  const dup = await call('POST', '/api/auth/register', { body: { username: 'ana', name: 'Outra', password: 'senha123' } });
  assert.equal(dup.status, 409);

  const me = await call('GET', '/api/me', { token });
  assert.deepEqual(me.data.today.next, ['entrada']);

  const fora = await call('POST', '/api/punches', { token, body: { type: 'saida' } });
  assert.equal(fora.status, 409, 'não pode sair sem ter entrado');

  for (const type of ['entrada', 'saida_almoco', 'volta_almoco', 'saida']) {
    const r = await call('POST', '/api/punches', { token, body: { type } });
    assert.equal(r.status, 201, type);
  }

  const fim = await call('GET', '/api/me', { token });
  assert.equal(fim.data.today.status, 'encerrado');
  assert.deepEqual(fim.data.today.next, []);

  const list = await call('GET', '/api/punches', { token });
  assert.equal(list.data.punches.length, 4);

  const csv = await call('GET', '/api/punches/export.csv', { token });
  assert.match(csv.data, /Funcionário;Usuário;Data;Hora;Tipo/);
  assert.match(csv.data, /Ana Souza;ana/);
});

test('login, senha errada e rotas de admin', async () => {
  const errado = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'errada' } });
  assert.equal(errado.status, 401);

  const admin = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'segredo123' } });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.user.role, 'admin');

  const summary = await call('GET', '/api/admin/summary', { token: admin.data.token });
  assert.equal(summary.status, 200);
  assert.equal(summary.data.totals.employees, 1);

  const func = await call('POST', '/api/auth/login', { body: { username: 'ana', password: 'senha123' } });
  const negado = await call('GET', '/api/admin/summary', { token: func.data.token });
  assert.equal(negado.status, 403);
});

test('rotas protegidas exigem token', async () => {
  const r = await call('GET', '/api/me');
  assert.equal(r.status, 401);
});
