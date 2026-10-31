// Cabeçalhos de segurança, identificação do IP do cliente e limite de tentativas.

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders({ api = false } = {}) {
  return {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(api ? { 'Cache-Control': 'no-store' } : {}),
  };
}

// Com um proxy reverso confiável na frente, o IP real é o último item do
// X-Forwarded-For (o que o proxy acrescentou). Sem proxy, o cabeçalho é
// ignorado, porque qualquer cliente pode inventá-lo.
export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff.at(-1);
  }
  return req.socket.remoteAddress || 'desconhecido';
}

// Limite por janela fixa, com memória limitada.
export class RateLimiter {
  #hits = new Map();
  constructor({ max, windowMs, maxKeys = 10_000 }) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  #entry(key, now) {
    const e = this.#hits.get(key);
    if (e && now - e.start < this.windowMs) return e;
    if (e) this.#hits.delete(key);
    return null;
  }

  // Retorna 0 se liberado, ou quantos segundos faltam para liberar.
  retryAfter(key, now = Date.now()) {
    const e = this.#entry(key, now);
    if (!e || e.count < this.max) return 0;
    return Math.max(1, Math.ceil((e.start + this.windowMs - now) / 1000));
  }

  hit(key, now = Date.now()) {
    const e = this.#entry(key, now);
    if (e) { e.count += 1; return; }
    if (this.#hits.size >= this.maxKeys) this.prune(now);
    if (this.#hits.size >= this.maxKeys) this.#hits.delete(this.#hits.keys().next().value);
    this.#hits.set(key, { start: now, count: 1 });
  }

  reset(key) { this.#hits.delete(key); }

  prune(now = Date.now()) {
    for (const [k, e] of this.#hits) if (now - e.start >= this.windowMs) this.#hits.delete(k);
  }

  get size() { return this.#hits.size; }
}
