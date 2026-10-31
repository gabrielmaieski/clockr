import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigError, openDatabase } from './db.js';
import { createApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || join(here, '..', 'data', 'clockr.db');
const TIME_ZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';
const PRODUCTION = process.env.NODE_ENV === 'production';
// Só confie no X-Forwarded-For quando houver um proxy reverso na frente.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

let db;
try {
  db = openDatabase(DB_FILE, { adminPassword: process.env.ADMIN_PASSWORD, production: PRODUCTION });
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[clockr] Erro de configuração: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const app = createApp(db, { timeZone: TIME_ZONE, publicDir: join(here, '..', 'public'), trustProxy: TRUST_PROXY });

// Limpa sessões expiradas a cada hora.
setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000).unref();

const server = createServer(app);
server.listen(PORT, () => {
  console.log(`[clockr] rodando em http://localhost:${PORT} (banco: ${DB_FILE})`);
});

// Encerra com segurança quando o container para.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => { db.close(); process.exit(0); });
  });
}
