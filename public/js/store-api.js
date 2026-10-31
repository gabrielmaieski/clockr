// Camada de dados que conversa com a API do servidor.

const TOKEN_KEY = 'clockr.token';

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* sem storage */ }
}

export class ApiStore {
  mode = 'api';
  #token = readToken();

  async #req(method, path, body) {
    const res = await fetch(`api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (path.endsWith('.csv') && res.ok) return res.text();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) this.#setToken(null);
      throw new Error(data.error || `Erro ${res.status}`);
    }
    return data;
  }

  #setToken(t) { this.#token = t; writeToken(t); }

  async restore() {
    if (!this.#token) return null;
    try { return (await this.#req('GET', '/me')).user; } catch { return null; }
  }

  async login(username, password) {
    const { token, user } = await this.#req('POST', '/auth/login', { username, password });
    this.#setToken(token);
    return user;
  }

  async register(payload) {
    const { token, user } = await this.#req('POST', '/auth/register', payload);
    this.#setToken(token);
    return user;
  }

  async logout() {
    try { await this.#req('POST', '/auth/logout'); } finally { this.#setToken(null); }
  }

  me() { return this.#req('GET', '/me'); }
  punch(type) { return this.#req('POST', '/punches', { type }); }
  async myPunches() { return (await this.#req('GET', '/punches?limit=500')).punches; }
  adminSummary() { return this.#req('GET', '/admin/summary'); }

  async adminPunches({ userId, date } = {}) {
    const p = new URLSearchParams();
    if (userId) p.set('user_id', userId);
    if (date) p.set('date', date);
    return (await this.#req('GET', `/admin/punches?${p}`)).punches;
  }

  async exportMine(user) {
    return { filename: `clockr-${user.username}.csv`, csv: await this.#req('GET', '/punches/export.csv') };
  }

  async exportAll() {
    return { filename: 'clockr-relatorio-completo.csv', csv: await this.#req('GET', '/admin/export.csv') };
  }
}
