import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextAllowed, workedMinutes, statusFromLast, formatMinutes } from '../public/js/core.js';

test('ordem das marcações', () => {
  assert.deepEqual(nextAllowed(null), ['entrada']);
  assert.deepEqual(nextAllowed('entrada'), ['saida_almoco', 'saida']);
  assert.deepEqual(nextAllowed('saida_almoco'), ['volta_almoco']);
  assert.deepEqual(nextAllowed('saida'), []);
});

test('horas trabalhadas descontam o almoço', () => {
  const p = (type, hh, mm) => ({ type, created_at: `2026-01-05T${hh}:${mm}:00Z` });
  const dia = [p('entrada', '11', '00'), p('saida_almoco', '15', '00'), p('volta_almoco', '16', '00'), p('saida', '20', '00')];
  assert.equal(workedMinutes(dia), 8 * 60);
  assert.equal(formatMinutes(8 * 60 + 5), '8h05');
});

test('expediente aberto conta até agora', () => {
  const now = new Date('2026-01-05T13:30:00Z');
  assert.equal(workedMinutes([{ type: 'entrada', created_at: '2026-01-05T11:00:00Z' }], now), 150);
});

test('status a partir da última marcação', () => {
  assert.equal(statusFromLast('volta_almoco'), 'trabalhando');
  assert.equal(statusFromLast('saida_almoco'), 'almoco');
  assert.equal(statusFromLast(null), 'ausente');
});
