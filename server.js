'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { connect } = require('./db');
const { createBot } = require('./bot');

// ---- .env (без зависимостей) ----
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env необязателен */ }

const CFG = {
  port: Number(process.env.PORT || 3000),
  dbUrl: process.env.DATABASE_URL || 'sqlite:./data/app.db',
  botToken: process.env.BOT_TOKEN || '',
  webAppUrl: process.env.WEB_APP_URL || '',
  tz: process.env.TZ_NAME || 'Europe/Minsk',
  devAuth: process.env.DEV_AUTH === '1',
  allowed: (process.env.ALLOWED_USERS || '').split(',').map((s) => s.trim()).filter(Boolean),
  currency: process.env.CURRENCY || '₽',
};

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

// ---- Telegram initData ----
function verifyInitData(initData) {
  if (!initData) throw new HttpError(401, 'Откройте приложение из Telegram');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(CFG.botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const ok = hash && calc.length === hash.length && crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash));
  if (!ok) throw new HttpError(401, 'Неверная подпись Telegram');
  if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > 86400) throw new HttpError(401, 'Сессия устарела, откройте приложение заново');
  return JSON.parse(params.get('user') || '{}');
}

// ---- валидаторы ----
const num = (v, name, { min = 0 } = {}) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min) throw bad(`Некорректное число: ${name}`);
  return Math.round(n * 100) / 100;
};
const str = (v, max = 255) => (v == null ? '' : String(v).trim().slice(0, max));
const reDate = /^\d{4}-\d{2}-\d{2}$/;
const reTime = /^\d{2}:\d{2}$/;
const int = (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; };

async function main() {
  const db = await connect(CFG.dbUrl);
  const bot = createBot({ db, token: CFG.botToken, webAppUrl: CFG.webAppUrl, tz: CFG.tz });
  console.log(`БД: ${db.dialect}`);
  if (!CFG.botToken && !CFG.devAuth) console.warn('⚠ BOT_TOKEN не задан: без него не работает вход через Telegram. Для локальной проверки: DEV_AUTH=1');

  async function authUser(req) {
    let tgUser;
    if (CFG.devAuth && !req.headers['x-tg-init-data']) tgUser = { id: 1, first_name: 'Dev' };
    else tgUser = verifyInitData(req.headers['x-tg-init-data']);
    if (CFG.allowed.length && !CFG.allowed.includes(String(tgUser.id)) && !CFG.allowed.includes(tgUser.username)) throw new HttpError(403, 'Доступ запрещён');
    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || String(tgUser.id);
    let u = await db.get('SELECT * FROM users WHERE tg_id = ?', [tgUser.id]);
    if (!u) {
      await db.run('INSERT INTO users (tg_id, name, created_at) VALUES (?, ?, ?)', [tgUser.id, name, new Date().toISOString()]);
      u = await db.get('SELECT * FROM users WHERE tg_id = ?', [tgUser.id]);
    }
    return u;
  }

  const maskToken = (t) => (t ? `${t.split(':')[0]}:••••${t.slice(-4)}` : '');
  const publicUser = (u) => ({
    name: u.name, notify_enabled: !!u.notify_enabled, remind_before_min: u.remind_before_min,
    custom_bot: maskToken(u.bot_token), chat_id: u.chat_id || '', bot_started: !!u.bot_started,
    bot_ready: !!(u.bot_token || CFG.botToken),
  });

  // ---- ресурсы ----
  const orderRow = (o) => ({
    id: o.id, client_id: o.client_id, client_name: o.client_name, address: o.address || '', service: o.service || '',
    date: o.scheduled_at.slice(0, 10), time: o.scheduled_at.slice(11, 16), scheduled_at: o.scheduled_at,
    price: Number(o.price), transport: Number(o.transport), profit: Math.round((Number(o.price) - Number(o.transport)) * 100) / 100,
    note: o.note || '', status: o.status,
  });
  const expenseRow = (e) => ({ id: e.id, date: e.date, amount: Number(e.amount), category: e.category, note: e.note || '' });

  async function resolveClient(user, b) {
    const clientId = int(b.client_id);
    if (clientId) {
      const c = await db.get('SELECT * FROM clients WHERE id = ? AND user_id = ?', [clientId, user.id]);
      if (!c) throw bad('Клиент не найден');
      return { id: c.id, name: c.name, address: str(b.address) || c.address || '', service: str(b.service) || c.service || '' };
    }
    const name = str(b.client_name);
    if (!name) throw bad('Укажите имя клиента');
    let c = await db.get('SELECT * FROM clients WHERE user_id = ? AND name = ?', [user.id, name]);
    if (!c) {
      const id = await db.insert('INSERT INTO clients (user_id, name, address, service) VALUES (?, ?, ?, ?)', [user.id, name, str(b.address), str(b.service)]);
      c = { id };
    }
    return { id: c.id, name, address: str(b.address), service: str(b.service) };
  }

  function orderFields(b, c) {
    const date = str(b.date, 10), time = str(b.time, 5);
    if (!reDate.test(date)) throw bad('Укажите дату');
    if (!reTime.test(time)) throw bad('Укажите время');
    return { scheduled_at: `${date} ${time}`, price: num(b.price, 'цена'), transport: num(b.transport, 'транспорт'), note: str(b.note, 2000), address: c.address, service: c.service };
  }

  function range(q, col) {
    const where = [], p = [];
    if (reDate.test(q.from || '')) { where.push(`${col} >= ?`); p.push(q.from + (col === 'scheduled_at' ? ' 00:00' : '')); }
    if (reDate.test(q.to || '')) { where.push(`${col} <= ?`); p.push(q.to + (col === 'scheduled_at' ? ' 23:59' : '')); }
    return { sql: where.length ? ' AND ' + where.join(' AND ') : '', p };
  }

  // ---- маршруты ----
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:id/g, '(\\d+)')}$`), fn });

  route('GET', '/api/me', async ({ user }) => ({ user: publicUser(user), config: { db: db.dialect, global_bot: !!CFG.botToken, tz: CFG.tz, currency: CFG.currency, today: bot.localStamp(new Date(), CFG.tz).slice(0, 10) } }));

  // настройки и бот
  route('PUT', '/api/settings', async ({ user, body: b }) => {
    const set = { notify_enabled: b.notify_enabled ? 1 : 0 };
    const rb = int(b.remind_before_min);
    if (rb === null || rb < 0 || rb > 60 * 24 * 14) throw bad('Некорректное время напоминания');
    set.remind_before_min = rb;
    if (b.chat_id !== undefined) {
      const c = str(b.chat_id, 64);
      if (c && !/^-?\d+$|^@\w{3,}$/.test(c)) throw bad('Chat ID — число (или @канал)');
      set.chat_id = c || null;
    }
    if (b.bot_token !== undefined && b.bot_token !== '__keep__') {
      const t = str(b.bot_token, 100);
      if (t) {
        if (!/^\d+:[\w-]{30,}$/.test(t)) throw bad('Токен бота выглядит неверно (формат 123456:ABC…)');
        try { await bot.verifyToken(t); } catch (e) { throw bad(`Telegram не принял токен: ${e.message}`); }
        set.bot_token = t;
      } else set.bot_token = null;
    }
    const cols = Object.keys(set);
    await db.run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => set[c]), user.id]);
    return { user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', [user.id])) };
  });

  route('POST', '/api/settings/test', async ({ user }) => {
    try {
      const me = await bot.notifyUser(user, '✅ <b>Тестовое уведомление</b>\nПодключение к боту работает.');
      await db.run('UPDATE users SET bot_started = 1 WHERE id = ?', [user.id]);
      return { ok: true, message_id: me.message_id };
    } catch (e) {
      const hint = e.code === 403 || /chat not found/i.test(e.message) ? ' Откройте бота и нажмите /start (или проверьте Chat ID).' : '';
      throw bad(`Не удалось отправить: ${e.message}.${hint}`);
    }
  });

  // клиенты
  route('GET', '/api/clients', async ({ user }) => ({ items: await db.all('SELECT * FROM clients WHERE user_id = ? ORDER BY name', [user.id]) }));
  route('POST', '/api/clients', async ({ user, body: b }) => {
    const name = str(b.name); if (!name) throw bad('Укажите имя');
    const id = await db.insert('INSERT INTO clients (user_id, name, address, service, phone, note) VALUES (?, ?, ?, ?, ?, ?)', [user.id, name, str(b.address), str(b.service), str(b.phone, 40), str(b.note, 2000)]);
    return { id };
  });
  route('PUT', '/api/clients/:id', async ({ user, body: b, params }) => {
    const name = str(b.name); if (!name) throw bad('Укажите имя');
    const r = await db.run('UPDATE clients SET name = ?, address = ?, service = ?, phone = ?, note = ? WHERE id = ? AND user_id = ?', [name, str(b.address), str(b.service), str(b.phone, 40), str(b.note, 2000), params[0], user.id]);
    if (!r.changes) throw new HttpError(404, 'Не найдено');
    return { ok: true };
  });
  route('DELETE', '/api/clients/:id', async ({ user, params }) => {
    const used = await db.get('SELECT COUNT(*) AS n FROM orders WHERE client_id = ? AND user_id = ?', [params[0], user.id]);
    await db.run('UPDATE orders SET client_id = NULL WHERE client_id = ? AND user_id = ?', [params[0], user.id]); // имя в заказах сохраняется
    await db.run('DELETE FROM clients WHERE id = ? AND user_id = ?', [params[0], user.id]);
    return { ok: true, orders_kept: Number(used.n) };
  });

  // заказы
  route('GET', '/api/orders', async ({ user, query: q }) => {
    const status = q.status === 'done' ? 'done' : 'new';
    const col = { date: 'scheduled_at', price: 'price', client: 'client_name' }[q.sort] || 'scheduled_at';
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    const items = await db.all(`SELECT * FROM orders WHERE user_id = ? AND status = ? ORDER BY ${col} ${dir}, id ${dir}`, [user.id, status]);
    const cnt = await db.all('SELECT status, COUNT(*) AS n FROM orders WHERE user_id = ? GROUP BY status', [user.id]);
    const counts = { new: 0, done: 0 }; cnt.forEach((r) => { counts[r.status] = Number(r.n); });
    return { items: items.map(orderRow), counts };
  });
  route('POST', '/api/orders', async ({ user, body: b }) => {
    const c = await resolveClient(user, b);
    const f = orderFields(b, c);
    const status = b.status === 'done' ? 'done' : 'new';
    const id = await db.insert(
      'INSERT INTO orders (user_id, client_id, client_name, address, service, scheduled_at, price, transport, note, status, reminded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
      [user.id, c.id, c.name, f.address, f.service, f.scheduled_at, f.price, f.transport, f.note, status, new Date().toISOString()]);
    return { id };
  });
  route('PUT', '/api/orders/:id', async ({ user, body: b, params }) => {
    const old = await db.get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [params[0], user.id]);
    if (!old) throw new HttpError(404, 'Не найдено');
    const c = await resolveClient(user, b);
    const f = orderFields(b, c);
    const reminded = f.scheduled_at !== old.scheduled_at ? 0 : old.reminded; // перенесли — напомним заново
    await db.run('UPDATE orders SET client_id = ?, client_name = ?, address = ?, service = ?, scheduled_at = ?, price = ?, transport = ?, note = ?, reminded = ? WHERE id = ? AND user_id = ?',
      [c.id, c.name, f.address, f.service, f.scheduled_at, f.price, f.transport, f.note, reminded, params[0], user.id]);
    return { ok: true };
  });
  route('POST', '/api/orders/:id/status', async ({ user, body: b, params }) => {
    const status = b.status === 'new' ? 'new' : 'done';
    const r = await db.run('UPDATE orders SET status = ? WHERE id = ? AND user_id = ?', [status, params[0], user.id]);
    if (!r.changes) throw new HttpError(404, 'Не найдено');
    return { ok: true };
  });
  route('DELETE', '/api/orders/:id', async ({ user, params }) => { await db.run('DELETE FROM orders WHERE id = ? AND user_id = ?', [params[0], user.id]); return { ok: true }; });

  // траты
  route('GET', '/api/expenses', async ({ user, query: q }) => {
    const r = range(q, 'date');
    const items = await db.all(`SELECT * FROM expenses WHERE user_id = ?${r.sql} ORDER BY date DESC, id DESC LIMIT ?`, [user.id, ...r.p, Math.min(int(q.limit) || 100, 1000)]);
    const total = await db.get('SELECT COUNT(*) AS n FROM expenses WHERE user_id = ?', [user.id]);
    return { items: items.map(expenseRow), total: Number(total.n) };
  });
  const expenseBody = (b) => {
    const date = str(b.date, 10); if (!reDate.test(date)) throw bad('Укажите дату');
    const amount = num(b.amount, 'сумма'); if (!(amount > 0)) throw bad('Укажите сумму');
    const category = str(b.category); if (!category) throw bad('Укажите, на что потрачено');
    return [date, amount, category, str(b.note, 2000)];
  };
  route('POST', '/api/expenses', async ({ user, body: b }) => ({ id: await db.insert('INSERT INTO expenses (user_id, date, amount, category, note) VALUES (?, ?, ?, ?, ?)', [user.id, ...expenseBody(b)]) }));
  route('PUT', '/api/expenses/:id', async ({ user, body: b, params }) => {
    const r = await db.run('UPDATE expenses SET date = ?, amount = ?, category = ?, note = ? WHERE id = ? AND user_id = ?', [...expenseBody(b), params[0], user.id]);
    if (!r.changes) throw new HttpError(404, 'Не найдено'); return { ok: true };
  });
  route('DELETE', '/api/expenses/:id', async ({ user, params }) => { await db.run('DELETE FROM expenses WHERE id = ? AND user_id = ?', [params[0], user.id]); return { ok: true }; });

  // статистика
  route('GET', '/api/stats', async ({ user, query: q }) => {
    const r = range(q, 'scheduled_at');
    const st = q.include_new === '1' ? '' : " AND status = 'done'";
    const base = `FROM orders WHERE user_id = ?${st}${r.sql}`;
    const p = [user.id, ...r.p];
    const t = await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(price),0) AS revenue, COALESCE(SUM(transport),0) AS transport ${base}`, p);
    const by = await db.all(`SELECT COALESCE(NULLIF(service,''),'Без услуги') AS service, COUNT(*) AS n, SUM(price) AS revenue, SUM(price - transport) AS profit ${base} GROUP BY COALESCE(NULLIF(service,''),'Без услуги')`, p);
    const revenue = Number(t.revenue), transport = Number(t.transport), n = Number(t.n);
    const profit = revenue - transport;
    const r2 = (x) => Math.round(x * 100) / 100;
    return {
      revenue: r2(revenue), transport: r2(transport), profit: r2(profit), orders: n,
      avg_profit: n ? r2(profit / n) : 0, transport_share: revenue ? Math.round((transport / revenue) * 100) : 0,
      by_service: by.map((s) => ({ service: s.service, orders: Number(s.n), revenue: r2(Number(s.revenue)), profit: r2(Number(s.profit)) })),
    };
  });
  route('GET', '/api/expense-stats', async ({ user, query: q }) => {
    const r = range(q, 'date');
    const p = [user.id, ...r.p];
    const t = await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM expenses WHERE user_id = ?${r.sql}`, p);
    const by = await db.all(`SELECT category, COUNT(*) AS n, SUM(amount) AS total FROM expenses WHERE user_id = ?${r.sql} GROUP BY category`, p);
    const n = Number(t.n), total = Number(t.total);
    return { total: Math.round(total * 100) / 100, count: n, average: n ? Math.round((total / n) * 100) / 100 : 0, by_category: by.map((c) => ({ category: c.category, count: Number(c.n), total: Math.round(Number(c.total) * 100) / 100 })) };
  });

  // главная
  route('GET', '/api/dashboard', async ({ user }) => {
    const today = bot.localStamp(new Date(), CFG.tz).slice(0, 10);
    const month = today.slice(0, 7);
    const upcoming = await db.all("SELECT * FROM orders WHERE user_id = ? AND status = 'new' ORDER BY scheduled_at ASC LIMIT 5", [user.id]);
    const m = await db.get("SELECT COUNT(*) AS n, COALESCE(SUM(price - transport),0) AS profit FROM orders WHERE user_id = ? AND status = 'done' AND scheduled_at >= ? AND scheduled_at <= ?", [user.id, `${month}-01 00:00`, `${month}-31 23:59`]);
    const e = await db.get('SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE user_id = ? AND date >= ? AND date <= ?', [user.id, `${month}-01`, `${month}-31`]);
    const newCnt = await db.get("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'new'", [user.id]);
    return { today, upcoming: upcoming.map(orderRow), month: { orders: Number(m.n), profit: Math.round(Number(m.profit) * 100) / 100, expenses: Math.round(Number(e.total) * 100) / 100 }, new_orders: Number(newCnt.n) };
  });

  // ---- HTTP ----
  const readBody = (req) => new Promise((resolve, reject) => {
    let data = ''; req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(bad('Некорректный JSON')); } });
    req.on('error', reject);
  });
  const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname.startsWith('/api/')) {
      try {
        const rt = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
        if (!rt) throw new HttpError(404, 'Нет такого метода');
        const user = await authUser(req);
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
        const out = await rt.fn({ user, body, query: Object.fromEntries(url.searchParams), params: url.pathname.match(rt.re).slice(1) });
        json(res, 200, out);
      } catch (e) {
        if (!(e instanceof HttpError)) console.error(e);
        json(res, e.status || 500, { error: e.status ? e.message : 'Внутренняя ошибка сервера' });
      }
      return;
    }
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    // статика
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });

  server.listen(CFG.port, () => console.log(`Приложение: http://localhost:${CFG.port}${CFG.devAuth ? '  (DEV_AUTH — без проверки Telegram!)' : ''}`));
  bot.startScheduler();
  if (CFG.botToken && process.env.BOT_POLLING !== '0') bot.startPolling();

  const shutdown = async () => { bot.stop(); server.close(); await db.close().catch(() => {}); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  return { server, db, bot };
}

if (require.main === module) main().catch((e) => { console.error('Ошибка запуска:', e.message); process.exit(1); });
module.exports = { main };
