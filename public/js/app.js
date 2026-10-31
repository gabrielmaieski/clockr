import { ApiStore } from './store-api.js';
import { DemoStore } from './store-demo.js';
import { PUNCH_LABELS, STATUS_LABELS, dayKey, formatMinutes, workedMinutes } from './core.js';

const $ = (sel) => document.querySelector(sel);
const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtLong = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtWeekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });

const ACTION_STYLE = { entrada: 'btn-primary', saida_almoco: 'btn-secondary', volta_almoco: 'btn-primary', saida: 'btn-secondary' };
const NEXT_HINT = {
  entrada: 'Registre sua entrada para começar o dia.',
  saida_almoco: 'Bom trabalho! Registre o almoço ou a saída quando for a hora.',
  volta_almoco: 'Bom almoço! Registre a volta quando retornar.',
  saida: 'Registre a saída ao encerrar o expediente.',
};

let store;
let user;
let clockTimer;
let liveTimer;

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
const typeTag = (t) => `<span class="type-tag type-${t}">${esc(PUNCH_LABELS[t] ?? t)}</span>`;
const statusPill = (s) => `<span class="status-pill st-${s}">${esc(STATUS_LABELS[s])}</span>`;

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function download({ filename, csv }) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function guarded(fn) {
  try { await fn(); } catch (err) {
    toast(err.message || 'Algo deu errado', true);
    if (/Sessão/.test(err.message)) showLogin();
  }
}

// ---------- detecção do modo ----------
async function pickStore() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('api/health', { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok && (await res.json()).mode === 'api') return new ApiStore();
  } catch { /* sem servidor: modo demonstração */ }
  return new DemoStore().init();
}

// ---------- telas ----------
function setTab(which) {
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === which;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $('#form-login').hidden = which !== 'login';
  $('#form-register').hidden = which !== 'register';
  document.querySelectorAll('.form-error').forEach((e) => { e.textContent = ''; });
}

function showLogin() {
  user = null;
  setTab('login');
  clearInterval(clockTimer);
  clearInterval(liveTimer);
  $('#view-app').hidden = true;
  $('#view-login').hidden = false;
  document.title = 'Clockr · Entrar';
}

async function showApp(u) {
  user = u;
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#user-name').textContent = u.name;
  $('#avatar').textContent = initials(u.name);
  $('#role-badge').textContent = u.role === 'admin' ? 'Gestor' : 'Funcionário';
  const isAdmin = u.role === 'admin';
  $('#view-admin').hidden = !isAdmin;
  $('#view-employee').hidden = isAdmin;
  document.title = `Clockr · ${isAdmin ? 'Painel do gestor' : 'Meu ponto'}`;
  if (isAdmin) {
    await loadAdmin();
    clearInterval(liveTimer);
    liveTimer = setInterval(() => guarded(loadTeam), 60000);
  } else {
    startClock();
    await loadEmployee();
    clearInterval(liveTimer);
    liveTimer = setInterval(() => guarded(renderWorked), 30000);
  }
}

// ---------- funcionário ----------
let myPunches = [];

function startClock() {
  const tick = () => {
    const now = new Date();
    $('#clock').textContent = now.toLocaleTimeString('pt-BR');
    $('#today-date').textContent = fmtLong.format(now);
  };
  tick();
  clearInterval(clockTimer);
  clockTimer = setInterval(tick, 1000);
}

const todayKey = () => dayKey(new Date());
const todaysPunches = () => myPunches.filter((p) => dayKey(new Date(p.created_at)) === todayKey());

async function loadEmployee() {
  const [{ today }, punches] = await Promise.all([store.me(), store.myPunches()]);
  myPunches = punches;
  renderState(today);
  renderTimeline();
  renderWorked();
  renderWeek();
  renderHistory();
}

function renderState(today) {
  $('#my-status').outerHTML = `<span class="status-pill st-${today.status}" id="my-status">${esc(STATUS_LABELS[today.status])}</span>`;
  const box = $('#punch-actions');
  box.innerHTML = '';
  for (const type of today.next) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${ACTION_STYLE[type]}`;
    b.textContent = `Registrar ${PUNCH_LABELS[type].toLowerCase()}`;
    b.addEventListener('click', () => doPunch(type, b));
    box.append(b);
  }
  $('#next-hint').textContent = today.next.length
    ? NEXT_HINT[today.next[0]]
    : 'Expediente encerrado. Até amanhã!';
}

async function doPunch(type, btn) {
  btn.disabled = true;
  await guarded(async () => {
    await store.punch(type);
    toast(`${PUNCH_LABELS[type]} registrada às ${fmtTime.format(new Date())}`);
    await loadEmployee();
  });
  btn.disabled = false;
}

function renderTimeline() {
  const list = [...todaysPunches()].reverse();
  const el = $('#timeline');
  if (!list.length) {
    el.innerHTML = '<li class="empty empty-row">Nenhuma marcação hoje.</li>';
    return;
  }
  el.innerHTML = list.map((p) => `
    <li><span class="t">${fmtTime.format(new Date(p.created_at))}</span><span class="dot"></span><span>${esc(PUNCH_LABELS[p.type])}</span></li>`).join('');
  const last = list.at(-1).type;
  if (last === 'entrada' || last === 'volta_almoco' || last === 'saida_almoco') {
    el.insertAdjacentHTML('beforeend', '<li class="pending"><span class="t">agora</span><span class="dot"></span><span>Em andamento</span></li>');
  }
}

function renderWorked() {
  $('#worked-today').textContent = formatMinutes(workedMinutes(todaysPunches()));
}

function renderWeek() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const min = workedMinutes(myPunches.filter((p) => dayKey(new Date(p.created_at)) === key));
    days.push({ d, min, today: i === 0 });
  }
  const max = Math.max(9 * 60, ...days.map((x) => x.min));
  $('#week').innerHTML = days.map(({ d, min, today }) => `
    <div class="bar${today ? ' today' : ''}" title="${fmtDate.format(d)}: ${formatMinutes(min)}">
      <span class="v">${min ? formatMinutes(min) : '–'}</span>
      <div class="track"><div class="fill${min ? '' : ' zero'}" data-pct="${Math.round((min / max) * 100)}"></div></div>
      <span class="d">${today ? 'hoje' : fmtWeekday.format(d).replace('.', '')}</span>
    </div>`).join('');
  // Altura via CSSOM: a CSP bloqueia atributos style="" no HTML.
  $('#week').querySelectorAll('.fill').forEach((f) => { f.style.height = `${f.dataset.pct}%`; });
}

function renderHistory() {
  const el = $('#my-history');
  if (!myPunches.length) {
    el.innerHTML = '<tr><td colspan="3" class="empty">Seu histórico aparece aqui.</td></tr>';
    return;
  }
  el.innerHTML = myPunches.slice(0, 200).map((p) => {
    const d = new Date(p.created_at);
    return `<tr><td>${fmtDate.format(d)}</td><td class="mono">${fmtTime.format(d)}</td><td>${typeTag(p.type)}</td></tr>`;
  }).join('');
}

// ---------- gestor ----------
async function loadAdmin() {
  await loadTeam();
  await loadRecords();
}

async function loadTeam() {
  const { team, totals } = await store.adminSummary();
  $('#kpi-employees').textContent = totals.employees;
  $('#kpi-working').textContent = totals.working;
  $('#kpi-lunch').textContent = totals.lunch;
  $('#kpi-punches').textContent = totals.punchesToday;

  $('#team').innerHTML = team.length ? team.map((t) => `
    <tr>
      <td><div class="person"><div class="avatar">${esc(initials(t.name))}</div><div>${esc(t.name)}<small>@${esc(t.username)}</small></div></div></td>
      <td>${statusPill(t.status)}</td>
      <td class="mono">${t.firstIn ? fmtTime.format(new Date(t.firstIn)) : '–'}</td>
      <td class="mono">${t.lastAt ? fmtTime.format(new Date(t.lastAt)) : '–'}</td>
      <td class="mono num">${formatMinutes(t.workedMinutes)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">Nenhum funcionário cadastrado ainda.</td></tr>';

  const sel = $('#filter-user');
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos os funcionários</option>' +
    team.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  sel.value = current;
}

async function loadRecords() {
  const rows = await store.adminPunches({ userId: $('#filter-user').value, date: $('#filter-date').value });
  $('#records').innerHTML = rows.length ? rows.map((p) => {
    const d = new Date(p.created_at);
    return `<tr><td>${esc(p.name)}</td><td>${fmtDate.format(d)}</td><td class="mono">${fmtTime.format(d)}</td><td>${typeTag(p.type)}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">Nenhum registro encontrado.</td></tr>';
}

// ---------- eventos ----------
function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.tab)));

  const submit = (form, action) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('button[type=submit]');
    err.textContent = '';
    btn.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const u = await action(data);
      form.reset();
      await showApp(u);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });
  submit($('#form-login'), (d) => store.login(d.username, d.password));
  submit($('#form-register'), (d) => store.register(d));

  document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
    const f = $('#form-login');
    f.username.value = chip.dataset.user;
    f.password.value = chip.dataset.pass;
    f.requestSubmit();
  }));

  $('#btn-logout').addEventListener('click', () => guarded(async () => { await store.logout(); showLogin(); }));
  $('#btn-export-mine').addEventListener('click', () => guarded(async () => download(await store.exportMine(user))));
  $('#btn-export-all').addEventListener('click', () => guarded(async () => download(await store.exportAll())));
  $('#btn-refresh').addEventListener('click', () => guarded(async () => { await loadAdmin(); toast('Painel atualizado'); }));
  $('#filter-user').addEventListener('change', () => guarded(loadRecords));
  $('#filter-date').addEventListener('change', () => guarded(loadRecords));
  $('#demo-reset').addEventListener('click', () => guarded(async () => {
    await store.reset();
    showLogin();
    toast('Dados de exemplo restaurados');
  }));
}

// ---------- início ----------
(async function main() {
  store = await pickStore();
  bindEvents();
  if (store.mode === 'demo') {
    $('#demo-banner').hidden = false;
    $('#demo-hint').hidden = false;
  }
  const u = await store.restore();
  if (u) await showApp(u); else showLogin();
})();
