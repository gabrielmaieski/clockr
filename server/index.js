import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || join(here, '..', 'data', 'clockr.db');
const TIME_ZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

const db = openDatabase(DB_FILE, { adminPassword: process.env.ADMIN_PASSWORD });
const app = createApp(db, { timeZone: TIME_ZONE, publicDir: join(here, '..', 'public') });

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
