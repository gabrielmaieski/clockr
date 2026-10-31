// Regras de negócio compartilhadas entre o servidor e o navegador.

export const PUNCH_TYPES = ['entrada', 'saida_almoco', 'volta_almoco', 'saida'];

export const PUNCH_LABELS = {
  entrada: 'Entrada',
  saida_almoco: 'Saída para almoço',
  volta_almoco: 'Volta do almoço',
  saida: 'Saída',
};

// Quais marcações são permitidas depois da última marcação do dia.
const NEXT = {
  none: ['entrada'],
  entrada: ['saida_almoco', 'saida'],
  saida_almoco: ['volta_almoco'],
  volta_almoco: ['saida'],
  saida: [],
};

export function nextAllowed(lastType) {
  return NEXT[lastType || 'none'] ?? [];
}

export function statusFromLast(lastType) {
  switch (lastType) {
    case 'entrada':
    case 'volta_almoco':
      return 'trabalhando';
    case 'saida_almoco':
      return 'almoco';
    case 'saida':
      return 'encerrado';
    default:
      return 'ausente';
  }
}

export const STATUS_LABELS = {
  trabalhando: 'Trabalhando',
  almoco: 'Em almoço',
  encerrado: 'Expediente encerrado',
  ausente: 'Sem registro hoje',
};

// Chave do dia (AAAA-MM-DD) no fuso informado.
export function dayKey(date, timeZone) {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Minutos trabalhados num dia, a partir das marcações em ordem.
// Se o expediente ainda estiver aberto, conta até `now`.
export function workedMinutes(punches, now = new Date()) {
  const sorted = [...punches].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let total = 0;
  let start = null;
  for (const p of sorted) {
    const t = new Date(p.created_at);
    if (p.type === 'entrada' || p.type === 'volta_almoco') {
      start = t;
    } else if (start) {
      total += (t - start) / 60000;
      start = null;
    }
  }
  if (start) total += Math.max(0, (now - start) / 60000);
  return Math.floor(total);
}

export function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function validateUsername(u) {
  return typeof u === 'string' && /^[a-z0-9._-]{3,30}$/.test(u);
}

export function validatePassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 100;
}

export function validateName(n) {
  return typeof n === 'string' && n.trim().length >= 2 && n.trim().length <= 60;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV com ponto e vírgula, que é o que o Excel em português espera.
export function toCSV(rows, timeZone) {
  const header = ['Funcionário', 'Usuário', 'Data', 'Hora', 'Tipo'];
  const fmtDate = new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short' });
  const fmtTime = new Intl.DateTimeFormat('pt-BR', { timeZone, timeStyle: 'medium' });
  const lines = rows.map((r) => {
    const d = new Date(r.created_at);
    return [r.name, r.username, fmtDate.format(d), fmtTime.format(d), PUNCH_LABELS[r.type] ?? r.type]
      .map(csvCell).join(';');
  });
  return '﻿' + [header.join(';'), ...lines].join('\r\n');
}
