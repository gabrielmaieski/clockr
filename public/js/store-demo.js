// Modo demonstração: mesmo contrato do ApiStore, com os dados guardados
// no IndexedDB do navegador. Usado quando não há servidor (ex.: GitHub Pages).
import {
  PUNCH_TYPES, dayKey, nextAllowed, statusFromLast, toCSV, workedMinutes,
  validateName, validatePassword, validateUsername,
} from './core.js';

const DB_NAME = 'clockr-demo';
const TZ = undefined; // fuso do navegador

// ---------- armazenamento (IndexedDB, com fallback em memória) ----------
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class Kv {
  #db = null;
  #mem = new Map();
  async init() {
    try { this.#db = await openIdb(); } catch { this.#db = null; }
  }
  async get(key) {
    if (!this.#db) return this.#mem.get(key);
    return new Promise((res, rej) => {
      const r = this.#db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async set(key, value) {
    if (!this.#db) { this.#mem.set(key, value); return; }
    return new Promise((res, rej) => {
      const tx = this.#db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
}

async function hash(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return btoa(String.fromCharCode(...data)); // contexto sem HTTPS: só para a demo
}

// ---------- dados de exemplo ----------
async function seed() {
  const people = [
    ['admin', 'Administrador', 'admin', 'admin123'],
    ['ana', 'Ana Souza', 'employee', 'demo123'],
    ['bruno', 'Bruno Lima', 'employee', 'demo123'],
    ['carla', 'Carla Mendes', 'employee', 'demo123'],
    ['diego', 'Diego Rocha', 'employee', 'demo123'],
  ];
  const users = [];
  for (const [i, [username, name, role, pw]] of people.entries()) {
    const salt = crypto.getRandomValues(new Uint32Array(2)).join('');
    users.push({ id: i + 1, username, name, role, salt, hash: await hash(pw, salt) });
  }

  const punches = [];
  let id = 1;
  const add = (userId, type, date) => punches.push({ id: id++, user_id: userId, type, created_at: date.toISOString() });
  const at = (base, h, m) => { const d = new Date(base); d.setHours(h, m, Math.floor(Math.random() * 60), 0); return d; };
  const jitter = (n) => Math.floor(Math.random() * (2 * n + 1)) - n;

  // Dias úteis anteriores
  const now = new Date();
  for (let back = 10; back >= 1; back--) {
    const day = new Date(now); day.setDate(now.getDate() - back);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    for (const uid of [2, 3, 4, 5]) {
      const inH = 8, inM = 0 + jitter(15) + 15;
      add(uid, 'entrada', at(day, inH, Math.max(0, inM)));
      add(uid, 'saida_almoco', at(day, 12, 5 + jitter(5)));
      add(uid, 'volta_almoco', at(day, 13, 5 + jitter(5)));
      add(uid, 'saida', at(day, 17, 20 + jitter(20)));
    }
  }

  // Hoje: situações diferentes para o painel ficar interessante.
  // Horários de expediente normais, sem nunca passar do horário atual.
  const ago = (min) => new Date(now.getTime() - min * 60000);
  const today = (h, m, minAgo) => { const d = at(now, h, m); return d < ago(minAgo) ? d : ago(minAgo); };
  const afterLunch = now.getHours() >= 14;
  add(2, 'entrada', today(8, 3, 180));                                   // Ana trabalhando
  if (afterLunch) { add(2, 'saida_almoco', today(12, 1, 120)); add(2, 'volta_almoco', today(13, 2, 60)); }
  add(3, 'entrada', today(7, 58, 240)); add(3, 'saida_almoco', today(12, 4, 25)); // Bruno no almoço
  add(4, 'entrada', today(8, 10, 300));                                  // Carla encerrou
  if (afterLunch) { add(4, 'saida_almoco', today(12, 0, 150)); add(4, 'volta_almoco', today(13, 0, 90)); }
  add(4, 'saida', ago(8));
  // Diego ainda não marcou

  return { users, punches };
}

// ---------- store ----------
export class DemoStore {
  mode = 'demo';
  #kv = new Kv();
  #users = [];
  #punches = [];
  #session = null;

  async init() {
    await this.#kv.init();
    const users = await this.#kv.get('users');
    if (users?.length) {
      this.#users = users;
      this.#punches = (await this.#kv.get('punches')) ?? [];
      this.#session = (await this.#kv.get('session')) ?? null;
    } else {
      await this.reset();
    }
    return this;
  }

  async reset() {
    const data = await seed();
    this.#users = data.users;
    this.#punches = data.punches;
    this.#session = null;
    await this.#save();
  }

  async #save() {
    await this.#kv.set('users', this.#users);
    await this.#kv.set('punches', this.#punches);
    await this.#kv.set('session', this.#session);
  }

  #public(u) { return { id: u.id, username: u.username, name: u.name, role: u.role }; }
  #current() {
    const u = this.#users.find((x) => x.id === this.#session);
    if (!u) throw new Error('Sessão inválida ou expirada');
    return u;
  }
  #requireAdmin() {
    const u = this.#current();
    if (u.role !== 'admin') throw new Error('Acesso restrito ao administrador');
    return u;
  }
  #withUser(p) {
    const u = this.#users.find((x) => x.id === p.user_id);
    return { ...p, name: u?.name, username: u?.username };
  }
  #desc(list) {
    return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  }
  #isToday(iso) { return dayKey(new Date(iso), TZ) === dayKey(new Date(), TZ); }
  #todayState(userId) {
    const last = this.#desc(this.#punches.filter((p) => p.user_id === userId))[0];
    const lastType = last && this.#isToday(last.created_at) ? last.type : null;
    return { lastType, status: statusFromLast(lastType), next: nextAllowed(lastType) };
  }

  async restore() {
    try { return this.#public(this.#current()); } catch { return null; }
  }

  async login(username, password) {
    const u = this.#users.find((x) => x.username === String(username || '').trim().toLowerCase());
    if (!u || (await hash(String(password || ''), u.salt)) !== u.hash) throw new Error('Usuário ou senha incorretos');
    this.#session = u.id;
    await this.#save();
    return this.#public(u);
  }

  async register({ username, name, password }) {
    const un = String(username || '').trim().toLowerCase();
    if (!validateUsername(un)) throw new Error('Usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou _');
    if (!validateName(name)) throw new Error('Informe seu nome (2 a 60 caracteres)');
    if (!validatePassword(password)) throw new Error('A senha precisa ter pelo menos 6 caracteres');
    if (this.#users.some((x) => x.username === un)) throw new Error('Esse usuário já existe');
    const salt = crypto.getRandomValues(new Uint32Array(2)).join('');
    const u = { id: Math.max(0, ...this.#users.map((x) => x.id)) + 1, username: un, name: name.trim(), role: 'employee', salt, hash: await hash(password, salt) };
    this.#users.push(u);
    this.#session = u.id;
    await this.#save();
    return this.#public(u);
  }

  async logout() { this.#session = null; await this.#save(); }

  async me() {
    const u = this.#current();
    return { user: this.#public(u), today: this.#todayState(u.id) };
  }

  async punch(type) {
    const u = this.#current();
    if (!PUNCH_TYPES.includes(type)) throw new Error('Tipo de marcação inválido');
    if (!this.#todayState(u.id).next.includes(type)) throw new Error('Essa marcação não é permitida agora');
    const punch = { id: Math.max(0, ...this.#punches.map((p) => p.id)) + 1, user_id: u.id, type, created_at: new Date().toISOString() };
    this.#punches.push(punch);
    await this.#save();
    return { punch, today: this.#todayState(u.id) };
  }

  async myPunches() {
    const u = this.#current();
    return this.#desc(this.#punches.filter((p) => p.user_id === u.id)).map((p) => this.#withUser(p));
  }

  async adminSummary() {
    this.#requireAdmin();
    const todays = this.#desc(this.#punches.filter((p) => this.#isToday(p.created_at)));
    const team = this.#users.filter((u) => u.role === 'employee').map((u) => {
      const mine = todays.filter((p) => p.user_id === u.id);
      return {
        id: u.id, name: u.name, username: u.username,
        status: statusFromLast(mine[0]?.type ?? null),
        firstIn: mine.filter((p) => p.type === 'entrada').at(-1)?.created_at ?? null,
        lastAt: mine[0]?.created_at ?? null,
        workedMinutes: workedMinutes(mine),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return {
      team,
      totals: {
        employees: team.length,
        working: team.filter((t) => t.status === 'trabalhando').length,
        lunch: team.filter((t) => t.status === 'almoco').length,
        punchesToday: todays.length,
      },
    };
  }

  async adminPunches({ userId, date } = {}) {
    this.#requireAdmin();
    let rows = this.#desc(this.#punches);
    if (userId) rows = rows.filter((p) => p.user_id === Number(userId));
    if (date) rows = rows.filter((p) => dayKey(new Date(p.created_at), TZ) === date);
    return rows.slice(0, 1000).map((p) => this.#withUser(p));
  }

  async exportMine(user) {
    return { filename: `clockr-${user.username}.csv`, csv: toCSV(await this.myPunches(), TZ) };
  }

  async exportAll() {
    this.#requireAdmin();
    return { filename: 'clockr-relatorio-completo.csv', csv: toCSV(this.#desc(this.#punches).map((p) => this.#withUser(p)), TZ) };
  }
}
