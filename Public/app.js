'use strict';
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { try { tg.ready(); tg.expand(); } catch {} }

// ---------- утилиты ----------
const $ = (s, r = document) => r.querySelector(s);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-6h6v6"/>',
  clip: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h6"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1"/><circle cx="16" cy="14" r="1"/>',
  chart: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><path d="M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.9"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3l8.7-8.7z"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  car: '<path d="M5 17h14v-5l-2-5H7l-2 5z"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  scale: '<path d="M12 3v18M5 21h14M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>', filter: '<path d="M3 6h18M7 12h10M10 18h4"/>', db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtNum = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n) || 0).replace(/ /g, ' ');
const money = (n) => `${fmtNum(n)} ${S.cfg ? S.cfg.currency : '₽'}`;
const dmy = (d) => d.split('-').reverse().join('.');
const longDate = (d, t) => { const [y, m, dd] = d.split('-').map(Number); return `${dd} ${MONTHS[m - 1]} ${y} г., ${t}`; };

function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 2800); }

async function api(method, url, body) {
  const res = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Tg-Init-Data': (tg && tg.initData) || '' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v && p.set(k, v)); const s = p.toString(); return s ? '?' + s : ''; };

function confirmBox(text) {
  return new Promise((resolve) => {
    if (tg && tg.showConfirm && tg.initData) return tg.showConfirm(text, resolve);
    resolve(window.confirm(text));
  });
}

// ---------- состояние ----------
const S = {
  tab: 'home', cfg: null, user: null, clients: [],
  ordersTab: 'new', sort: 'date', dir: 'desc', editOrder: null, editExpense: null,
  period: { stats: { kind: 'all' }, spend: { kind: 'all' } }, includeNew: false,
};
const TABS = [['home', 'Главная', 'home'], ['orders', 'Заказы', 'clip'], ['spend', 'Траты', 'wallet'], ['stats', 'Статистика', 'chart'], ['clients', 'Клиенты', 'users'], ['settings', 'Настройки', 'sliders']];

function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([id, label, icon]) => `<button class="tab ${S.tab === id ? 'on' : ''}" data-act="goto" data-tab="${id}">${ic(icon)}${label}</button>`).join('');
  const on = $('#tabs .on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  const u = S.user;
  $('#sub').textContent = u ? `Учёт: ${u.name}` : '';
  const pill = $('#notifyPill'); const enabled = u && u.notify_enabled;
  pill.className = 'pill' + (enabled ? '' : ' off');
  pill.innerHTML = `${ic('send')} Уведомления ${enabled ? 'вкл.' : 'выкл.'}`;
}
$('#logo').innerHTML = `<svg class="i" style="width:26px;height:26px" viewBox="0 0 24 24">${ICONS.clip}</svg>`;

async function go(tab) {
  S.tab = tab; history.replaceState(null, '', '#' + tab); renderTabs();
  $('#view').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try { await VIEWS[tab](); } catch (e) { $('#view').innerHTML = `<div class="card empty">${h(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
const view = (html) => { $('#view').innerHTML = html; };
const ensureClients = async () => { S.clients = (await api('GET', '/clients')).items; };

// ---------- период ----------
function periodRange(p) {
  const today = S.cfg.today; const [y, m, d] = today.split('-').map(Number);
  const iso = (dt) => dt.toISOString().slice(0, 10);
  if (p.kind === 'month') return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
  if (p.kind === 'week') { const dt = new Date(Date.UTC(y, m - 1, d)); const wd = (dt.getUTCDay() + 6) % 7; const from = new Date(dt - wd * 864e5); return { from: iso(from), to: iso(new Date(+from + 6 * 864e5)) }; }
  if (p.kind === 'custom') return { from: p.from || '', to: p.to || '' };
  return {};
}
const PERIOD_NAMES = { all: 'всё время', month: 'этот месяц', week: 'эта неделя', custom: 'выбранные даты' };
function periodBar(key, cls = '') {
  const p = S.period[key];
  const b = (k, l) => `<button class="${p.kind === k ? 'on' : ''}" data-act="period" data-key="${key}" data-kind="${k}">${l}</button>`;
  return `<div class="seg ${cls}"><span class="ico">${ic('filter')}</span>${b('all', 'Всё время')}${b('month', 'Этот месяц')}${b('week', 'Эта неделя')}${b('custom', 'Выбрать даты')}</div>
  ${p.kind === 'custom' ? `<div class="custom-range"><input type="date" id="pf-${key}" value="${h(p.from || '')}" data-act="range" data-key="${key}" data-side="from"><input type="date" id="pt-${key}" value="${h(p.to || '')}" data-act="range" data-key="${key}" data-side="to"></div>` : ''}
  <p class="hint" style="margin:10px 2px">Период: ${PERIOD_NAMES[p.kind]}</p>`;
}

// ---------- ГЛАВНАЯ ----------
async function viewHome() {
  const d = await api('GET', '/dashboard');
  view(`
  <div class="page-title"><span class="badge">${ic('home')}</span>Главная</div>
  <div class="stats">
    <div class="stat"><div class="badge blue">${ic('cal')}</div><div class="k">Заказов в этом месяце</div><div class="v">${d.month.orders}</div></div>
    <div class="stat"><div class="badge">${ic('chart')}</div><div class="k">Прибыль за месяц</div><div class="v">${money(d.month.profit)}</div></div>
    <div class="stat"><div class="badge orange">${ic('wallet')}</div><div class="k">Траты за месяц</div><div class="v">${money(d.month.expenses)}</div></div>
    <div class="stat"><div class="badge gray">${ic('clip')}</div><div class="k">Ждут выполнения</div><div class="v">${d.new_orders}</div></div>
  </div>
  <div class="card"><h2><span class="badge">${ic('bell')}</span>Ближайшие заказы</h2>
    ${d.upcoming.length ? d.upcoming.map((o) => orderCard(o, false)).join('') : '<div class="empty">Нет предстоящих заказов</div>'}
    <div class="btns"><button class="btn" data-act="newOrder">${ic('plus')}Новая запись</button><button class="btn ghost" data-act="goto" data-tab="spend">${ic('wallet')}Добавить трату</button></div>
  </div>`);
}

// ---------- ЗАКАЗЫ ----------
function orderCard(o, withActs = true, hist = false) {
  return `<div class="item">
    <div class="when">${longDate(o.date, o.time)}</div>
    <div class="who">${ic('user')}${h(o.client_name)}</div>
    ${o.address ? `<div class="line">${ic('pin')}<span>${h(o.address)}</span></div>` : ''}
    ${o.service ? `<div class="line">${ic('wrench')}<span>${h(o.service)}</span></div>` : ''}
    ${o.note ? `<p class="note">${h(o.note)}</p>` : ''}
    <div class="money"><b>${money(o.price)}</b><span class="sm">−${money(o.transport)} транспорт</span><span class="profit">${money(o.profit)} прибыль</span></div>
    ${withActs ? `<div class="acts">
      ${hist ? `<button class="ib" title="Вернуть в новые" data-act="status" data-id="${o.id}" data-status="new">${ic('undo')}</button>` : `<button class="ib ok" title="Выполнено" data-act="status" data-id="${o.id}" data-status="done">${ic('check')}</button>`}
      <button class="ib" title="Изменить" data-act="editOrder" data-id="${o.id}">${ic('pencil')}</button>
      <button class="ib del" title="Удалить" data-act="delOrder" data-id="${o.id}">${ic('trash')}</button></div>` : ''}
  </div>`;
}

function ordersTabs(counts) {
  const b = (k, l, n) => `<button class="${S.ordersTab === k ? 'on' : ''}" data-act="otab" data-k="${k}">${l}${n !== undefined ? `<small>${n}</small>` : ''}</button>`;
  return `<div class="page-title"><span class="badge">${ic('clip')}</span>Заказы</div>
  <div class="seg" style="align-self:start"><span class="ico">${ic('filter')}</span>${b('form', S.editOrder ? 'Изменение' : 'Новая запись')}${b('new', 'Новые', counts.new)}${b('done', 'История', counts.done)}</div>`;
}

async function viewOrders() {
  await ensureClients();
  if (S.ordersTab === 'form') {
    const counts = (await api('GET', '/orders?status=new')).counts;
    return view(ordersTabs(counts) + orderForm());
  }
  const r = await api('GET', '/orders' + qs({ status: S.ordersTab, sort: S.sort, dir: S.dir }));
  const hist = S.ordersTab === 'done';
  view(ordersTabs(r.counts) + `<div class="card">
    <div class="tools"><select data-act="sort">${[['date', 'По дате'], ['price', 'По цене'], ['client', 'По клиенту']].map(([v, l]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button data-act="dir">${ic('sort')}${S.dir === 'desc' ? 'Убыв.' : 'Возр.'}</button></div>
    ${r.items.length ? r.items.map((o) => orderCard(o, true, hist)).join('') : `<div class="empty">${hist ? 'История пуста' : 'Нет новых заказов'}</div>`}</div>`);
}

function orderForm() {
  const o = S.editOrder || {};
  const clientId = o.client_id || '';
  const isNew = !clientId;
  return `<form class="card" id="orderForm" autocomplete="off">
    <h2><span class="badge">${ic(S.editOrder ? 'pencil' : 'plus')}</span>${S.editOrder ? 'Изменить запись' : 'Новая запись'}</h2>
    <div class="row2"><div><label>Дата</label><input type="date" name="date" required value="${h(o.date || S.cfg.today)}"></div>
    <div><label>Время</label><input type="time" name="time" required step="900" value="${h(o.time || '')}"></div></div>
    <label>Клиент</label>
    <select name="client_id" id="clientSel"><option value="">+ Новый клиент</option>${S.clients.map((c) => `<option value="${c.id}" ${String(clientId) === String(c.id) ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</select>
    <div id="newClientBox" ${isNew ? '' : 'hidden'}><label>Имя клиента</label><input name="client_name" placeholder="Иван Петров" value="${isNew ? h(o.client_name || '') : ''}"></div>
    <label>Адрес</label><input name="address" placeholder="ул. Ленина, 10, кв. 5" value="${h(o.address || '')}">
    <label>Услуга</label><input name="service" placeholder="Ремонт холодильника" value="${h(o.service || '')}">
    <div class="row2"><div><label>Цена, ${S.cfg.currency}</label><input name="price" inputmode="decimal" placeholder="0" value="${o.price ?? ''}"></div>
    <div><label>Транспорт, ${S.cfg.currency}</label><input name="transport" inputmode="decimal" placeholder="0" value="${o.transport ?? ''}"></div></div>
    <label>Заметка <span class="opt">(необязательно)</span></label><textarea name="note" placeholder="Детали…">${h(o.note || '')}</textarea>
    <div class="btns"><button class="btn" type="submit">${ic('save')}${S.editOrder ? 'Сохранить' : 'Добавить'}</button>${S.editOrder ? `<button class="btn ghost" type="button" data-act="cancelEdit">Отмена</button>` : ''}</div>
  </form>`;
}

// ---------- ТРАТЫ ----------
async function viewSpend() {
  const r = periodRange(S.period.spend);
  const [st, list] = await Promise.all([api('GET', '/expense-stats' + qs(r)), api('GET', '/expenses' + qs({ limit: 50 }))]);
  const e = S.editExpense || {};
  const max = Math.max(1, ...st.by_category.map((c) => c.total));
  const cats = [...st.by_category].sort((a, b) => b.total - a.total);
  view(`
  <div class="page-title"><span class="badge orange">${ic('wallet')}</span>Статистика трат</div>
  ${periodBar('spend', 'orange')}
  <div class="stats one">
    <div class="stat"><div class="badge orange">${ic('wallet')}</div><div class="k">Всего потрачено</div><div class="v">${money(st.total)}</div></div>
    <div class="stat"><div class="badge gray">${ic('receipt')}</div><div class="k">Трат</div><div class="v">${st.count}</div></div>
    <div class="stat"><div class="badge blue">${ic('scale')}</div><div class="k">Средняя трата</div><div class="v">${money(st.average)}</div></div>
  </div>
  ${cats.length ? `<div class="card"><div class="muted">${ic('cal')} Траты по категориям</div>${cats.map((c) => `<div class="bar-row"><div class="t"><span>${h(c.category)}</span><span>${money(c.total)}</span></div><div class="bar orange"><i style="width:${Math.round((c.total / max) * 100)}%"></i></div><small>${c.count} трат(ы)</small></div>`).join('')}</div>` : ''}
  <form class="card" id="expForm" autocomplete="off">
    <h2><span class="badge orange">${ic('wallet')}</span>${S.editExpense ? 'Изменить трату' : 'Учёт трат'}</h2>
    <label>Дата</label><input type="date" name="date" required value="${h(e.date || S.cfg.today)}">
    <label>Сумма, ${S.cfg.currency}</label><input name="amount" inputmode="decimal" required placeholder="1500" value="${e.amount ?? ''}">
    <label>На что потратил</label><input name="category" required list="catList" placeholder="Запчасти, бензин, инструмент…" value="${h(e.category || '')}">
    <datalist id="catList">${cats.map((c) => `<option value="${h(c.category)}">`).join('')}</datalist>
    <label>Заметка <span class="opt">(необязательно)</span></label><input name="note" placeholder="Детали…" value="${h(e.note || '')}">
    <div class="btns"><button class="btn orange" type="submit">${ic('save')}${S.editExpense ? 'Сохранить' : 'Добавить'}</button>${S.editExpense ? '<button class="btn ghost" type="button" data-act="cancelExp">Отмена</button>' : ''}</div>
    <div class="hr"></div>
    <div class="muted">Последние траты (${list.total})</div>
    <div style="margin-top:8px">${list.items.map((x) => `<div class="exp"><span class="d">${dmy(x.date)}</span><span class="c">${h(x.category)}${x.note ? `<small>${h(x.note)}</small>` : ''}</span><span class="a">−${money(x.amount)}</span><span class="x"><button type="button" class="ib" data-act="editExp" data-id="${x.id}">${ic('pencil')}</button><button type="button" class="ib del" data-act="delExp" data-id="${x.id}">${ic('trash')}</button></span></div>`).join('') || '<div class="empty">Трат пока нет</div>'}</div>
  </form>`);
  S._expItems = list.items;
}

// ---------- СТАТИСТИКА ----------
async function viewStats() {
  const r = periodRange(S.period.stats);
  const st = await api('GET', '/stats' + qs({ ...r, include_new: S.includeNew ? '1' : '' }));
  const sort = S.statSort || 'profit';
  const rows = [...st.by_service].sort((a, b) => (sort === 'name' ? a.service.localeCompare(b.service) : sort === 'orders' ? b.orders - a.orders : b.profit - a.profit));
  const max = Math.max(1, ...rows.map((x) => x[sort === 'orders' ? 'orders' : 'profit']));
  view(`
  <div class="page-title"><span class="badge">${ic('chart')}</span>Статистика</div>
  ${periodBar('stats')}
  <label style="display:flex;gap:10px;align-items:center;margin:0 2px;font-weight:400"><input type="checkbox" id="incNew" style="width:20px;min-height:20px" ${S.includeNew ? 'checked' : ''}> Учитывать невыполненные заказы</label>
  <div class="stats">
    <div class="stat"><div class="badge blue">${ic('cash')}</div><div class="k">Выручка</div><div class="v">${money(st.revenue)}</div></div>
    <div class="stat"><div class="badge orange">${ic('car')}</div><div class="k">Расходы на транспорт</div><div class="v">${money(st.transport)}</div></div>
    <div class="stat"><div class="badge">${ic('chart')}</div><div class="k">Прибыль</div><div class="v">${money(st.profit)}</div></div>
    <div class="stat"><div class="badge gray">${ic('cal')}</div><div class="k">Заказов</div><div class="v">${st.orders}</div></div>
  </div>
  <div class="card">
    <div class="kv"><span>Средняя прибыль за заказ:</span><b>${money(st.avg_profit)}</b></div>
    <div class="kv"><span>Доля транспорта от выручки:</span><b>${st.transport_share}%</b></div>
    <div class="hr"></div>
    <div class="muted">Прибыль по услугам</div>
    <div class="sortbar">${ic('sort')} Сортировка: <select data-act="statSort"><option value="profit" ${sort === 'profit' ? 'selected' : ''}>по прибыли</option><option value="orders" ${sort === 'orders' ? 'selected' : ''}>по числу заказов</option><option value="name" ${sort === 'name' ? 'selected' : ''}>по названию</option></select></div>
    ${rows.map((x) => `<div class="bar-row"><div class="t"><span>${h(x.service)}</span><span>${money(x.profit)}</span></div><div class="bar"><i style="width:${Math.round((x[sort === 'orders' ? 'orders' : 'profit'] / max) * 100)}%"></i></div><small>${x.orders} заказ(ов) · выручка ${money(x.revenue)}</small></div>`).join('') || '<div class="empty">Нет данных за период</div>'}
  </div>`);
}

// ---------- КЛИЕНТЫ ----------
async function viewClients() {
  await ensureClients();
  view(`<div class="card"><h2><span class="badge">${ic('users')}</span>Клиенты</h2>
    ${S.clients.map((c) => `<div class="item"><div style="display:flex;justify-content:space-between;gap:8px"><div class="who" style="margin:0">${h(c.name)}</div><div class="acts" style="margin:0"><button class="ib" data-act="editClient" data-id="${c.id}">${ic('pencil')}</button><button class="ib del" data-act="delClient" data-id="${c.id}">${ic('trash')}</button></div></div>
      ${c.address ? `<div class="line">${ic('pin')}<span>${h(c.address)}</span></div>` : ''}${c.service ? `<div class="line">${ic('wrench')}<span>${h(c.service)}</span></div>` : ''}${c.phone ? `<div class="line">${ic('send')}<a href="tel:${h(c.phone)}">${h(c.phone)}</a></div>` : ''}</div>`).join('') || '<div class="empty">Клиентов пока нет</div>'}
    <button class="btn" data-act="addClient">${ic('plus')}Добавить клиента</button></div>`);
}
function clientDialog(c = {}) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog" id="clientForm"><h3>${c.id ? 'Изменить клиента' : 'Новый клиент'}</h3>
    <label>Имя</label><input name="name" required value="${h(c.name || '')}">
    <label>Адрес</label><input name="address" value="${h(c.address || '')}">
    <label>Услуга</label><input name="service" value="${h(c.service || '')}">
    <label>Телефон</label><input name="phone" inputmode="tel" value="${h(c.phone || '')}">
    <div class="btns"><button class="btn" value="ok">${ic('save')}Сохранить</button><button class="btn ghost" value="cancel" formnovalidate>Отмена</button></div></form>`;
  dlg.showModal();
  $('#clientForm').addEventListener('submit', async (ev) => {
    if (ev.submitter && ev.submitter.value === 'cancel') return;
    const body = Object.fromEntries(new FormData(ev.target));
    try { await api(c.id ? 'PUT' : 'POST', '/clients' + (c.id ? '/' + c.id : ''), body); toast('Сохранено'); viewClients(); } catch (e) { toast(e.message, true); }
  });
}

// ---------- НАСТРОЙКИ ----------
const REMIND = [[30, 'за 30 минут'], [60, 'за 1 час'], [120, 'за 2 часа'], [180, 'за 3 часа'], [360, 'за 6 часов'], [720, 'за 12 часов'], [1440, 'за 24 часа'], [2880, 'за 2 дня']];
async function viewSettings() {
  const { user, config } = await api('GET', '/me'); S.user = user; S.cfg = config; renderTabs();
  const botOk = user.bot_ready && (user.bot_started || user.custom_bot || user.chat_id);
  view(`<form class="card" id="setForm" autocomplete="off"><h2><span class="badge">${ic('sliders')}</span>Настройки уведомлений</h2>
    <div class="setting">${ic('bell')}<div class="tx"><b>Уведомления ${user.notify_enabled ? 'включены' : 'выключены'}</b><span>Приходят в ваш чат с ботом</span></div><label class="switch" style="margin:0"><input type="checkbox" name="notify_enabled" ${user.notify_enabled ? 'checked' : ''}><span></span></label></div>
    <div class="setting">${ic('send')}<div class="tx"><b>${botOk ? 'Бот подключён' : 'Бот не подключён'}</b><span>${botOk ? 'Этот чат уже получает уведомления' : user.bot_ready ? 'Откройте бота и нажмите /start, затем «Отправить тест»' : 'Укажите токен бота ниже или задайте BOT_TOKEN на сервере'}</span></div></div>
    <label>Напоминать за сколько до заказа</label>
    <select name="remind_before_min">${REMIND.map(([v, l]) => `<option value="${v}" ${user.remind_before_min === v ? 'selected' : ''}>${l}</option>`).join('')}${REMIND.some(([v]) => v === user.remind_before_min) ? '' : `<option value="${user.remind_before_min}" selected>за ${user.remind_before_min} мин</option>`}</select>
    <p class="hint">Напоминание приходит автоматически. Проверки выполняются каждую минуту.</p>
    <details ${user.custom_bot || user.chat_id ? 'open' : ''}><summary>${ic('send')} Свой Telegram-бот (необязательно)</summary>
      <p class="hint">Уведомления можно слать через любого бота: создайте его в @BotFather и вставьте токен. Если пусто — используется бот сервера${config.global_bot ? '' : ' (он не задан)'}.</p>
      <label>Токен бота</label><input name="bot_token" placeholder="${user.custom_bot ? h(user.custom_bot) + ' — введите новый, чтобы заменить' : '123456789:AA…'}" autocapitalize="off" spellcheck="false">
      ${user.custom_bot ? `<label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" name="clear_token" style="width:20px;min-height:20px"> Удалить свой токен</label>` : ''}
      <label>Chat ID <span class="opt">(по умолчанию — ваш личный чат; можно группу или @канал)</span></label><input name="chat_id" inputmode="text" placeholder="например 123456789 или -1001234567890" value="${h(user.chat_id)}">
    </details>
    <div class="btns"><button class="btn" type="submit">${ic('check')}Сохранить</button><button class="btn ghost" type="button" data-act="testNotify">${ic('send')}Отправить тест</button></div>
    <p class="hint" style="margin-top:16px">${ic('db')} База данных: <b>${h(config.db)}</b> · Часовой пояс: ${h(config.tz)}</p>
  </form>`);
}

const VIEWS = { home: viewHome, orders: viewOrders, spend: viewSpend, stats: viewStats, clients: viewClients, settings: viewSettings };

// ---------- события ----------
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const { act, id } = el.dataset;
  try {
    if (act === 'goto') { S.editOrder = null; return go(el.dataset.tab); }
    if (act === 'newOrder') { S.editOrder = null; S.ordersTab = 'form'; return go('orders'); }
    if (act === 'otab') { if (el.dataset.k !== 'form') S.editOrder = null; S.ordersTab = el.dataset.k; return viewOrders(); }
    if (act === 'dir') { S.dir = S.dir === 'desc' ? 'asc' : 'desc'; return viewOrders(); }
    if (act === 'cancelEdit') { S.editOrder = null; S.ordersTab = 'new'; return viewOrders(); }
    if (act === 'status') { await api('POST', `/orders/${id}/status`, { status: el.dataset.status }); toast(el.dataset.status === 'done' ? 'Заказ выполнен' : 'Возвращён в новые'); return viewOrders(); }
    if (act === 'editOrder') {
      const list = (await api('GET', '/orders' + qs({ status: S.ordersTab === 'done' ? 'done' : 'new', sort: S.sort, dir: S.dir }))).items;
      S.editOrder = list.find((o) => String(o.id) === id); S.ordersTab = 'form'; return viewOrders();
    }
    if (act === 'delOrder') { if (await confirmBox('Удалить заказ?')) { await api('DELETE', `/orders/${id}`); toast('Удалено'); viewOrders(); } return; }
    if (act === 'period') { const p = S.period[el.dataset.key]; p.kind = el.dataset.kind; return VIEWS[S.tab](); }
    if (act === 'editExp') { S.editExpense = S._expItems.find((x) => String(x.id) === id); await viewSpend(); return $('#expForm').scrollIntoView({ behavior: 'smooth' }); }
    if (act === 'cancelExp') { S.editExpense = null; return viewSpend(); }
    if (act === 'delExp') { if (await confirmBox('Удалить трату?')) { await api('DELETE', `/expenses/${id}`); toast('Удалено'); viewSpend(); } return; }
    if (act === 'addClient') return clientDialog();
    if (act === 'editClient') return clientDialog(S.clients.find((c) => String(c.id) === id));
    if (act === 'delClient') { if (await confirmBox('Удалить клиента? Его заказы сохранятся.')) { await api('DELETE', `/clients/${id}`); toast('Удалено'); viewClients(); } return; }
    if (act === 'testNotify') {
      el.disabled = true;
      try { await saveSettings(); await api('POST', '/settings/test'); toast('Тест отправлен — проверьте чат с ботом'); viewSettings(); }
      finally { el.disabled = false; }
    }
  } catch (e) { toast(e.message, true); }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.act === 'sort') { S.sort = el.value; return viewOrders(); }
  if (el.dataset.act === 'statSort') { S.statSort = el.value; return viewStats(); }
  if (el.dataset.act === 'range') { const p = S.period[el.dataset.key]; p[el.dataset.side] = el.value; return VIEWS[S.tab](); }
  if (el.id === 'incNew') { S.includeNew = el.checked; return viewStats(); }
  if (el.id === 'clientSel') {
    const c = S.clients.find((x) => String(x.id) === el.value);
    $('#newClientBox').hidden = !!c;
    const f = el.form; if (c) { if (!f.address.value) f.address.value = c.address || ''; if (!f.service.value) f.service.value = c.service || ''; }
  }
});

async function saveSettings() {
  const f = $('#setForm'); const d = new FormData(f);
  const body = { notify_enabled: f.notify_enabled.checked, remind_before_min: Number(d.get('remind_before_min')), chat_id: d.get('chat_id') };
  const tok = (d.get('bot_token') || '').trim();
  if (f.clear_token && f.clear_token.checked) body.bot_token = ''; else if (tok) body.bot_token = tok;
  const r = await api('PUT', '/settings', body); S.user = r.user; renderTabs();
}

document.addEventListener('submit', async (ev) => {
  const f = ev.target; if (f.method === 'dialog') return;
  ev.preventDefault();
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (f.id === 'orderForm') {
      const body = Object.fromEntries(new FormData(f));
      await api(S.editOrder ? 'PUT' : 'POST', '/orders' + (S.editOrder ? '/' + S.editOrder.id : ''), body);
      toast(S.editOrder ? 'Сохранено' : 'Запись добавлена'); S.editOrder = null; S.ordersTab = 'new'; await viewOrders();
    } else if (f.id === 'expForm') {
      const body = Object.fromEntries(new FormData(f));
      await api(S.editExpense ? 'PUT' : 'POST', '/expenses' + (S.editExpense ? '/' + S.editExpense.id : ''), body);
      toast(S.editExpense ? 'Сохранено' : 'Трата добавлена'); S.editExpense = null; await viewSpend();
    } else if (f.id === 'setForm') { await saveSettings(); toast('Настройки сохранены'); await viewSettings(); }
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
});

// ---------- старт ----------
(async function init() {
  try {
    const me = await api('GET', '/me'); S.user = me.user; S.cfg = me.config;
    const t = location.hash.slice(1); await go(VIEWS[t] ? t : 'home');
  } catch (e) { view(`<div class="card empty"><b>${h(e.message)}</b><p>Откройте приложение через Telegram-бота.</p></div>`); }
})();
