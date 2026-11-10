'use strict';
/**
 * Telegram: отправка уведомлений через ЛЮБОГО бота (токен из .env или персональный токен из настроек),
 * приём /start, планировщик напоминаний о заказах.
 */

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 45000 : 15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = new Error(data.description || `Telegram HTTP ${res.status}`);
    err.code = data.error_code || res.status;
    throw err;
  }
  return data.result;
}

/** "YYYY-MM-DD HH:MM" в заданном часовом поясе */
function localStamp(date, tz) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replace('T', ' ').slice(0, 16);
}
const stampToMs = (s) => { const [d, t] = s.split(' '); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return Date.UTC(y, m - 1, dd, h, mi); };

function humanLeft(mins) {
  if (mins <= 0) return 'сейчас';
  const h = Math.floor(mins / 60), m = mins % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ');
}

function createBot({ db, token, webAppUrl, tz, log = console }) {
  const resolveToken = (user) => user.bot_token || token;
  const resolveChat = (user) => user.chat_id || String(user.tg_id);

  async function notifyUser(user, text, extra = {}) {
    const t = resolveToken(user);
    if (!t) throw new Error('Не задан токен бота (BOT_TOKEN или персональный токен в настройках)');
    return tg(t, 'sendMessage', { chat_id: resolveChat(user), text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  }

  async function verifyToken(t) { return tg(t, 'getMe'); }

  // ---------- входящие сообщения основного бота ----------
  async function handleUpdate(u) {
    const msg = u.message;
    if (!msg || !msg.from || msg.chat.type !== 'private') return;
    const text = (msg.text || '').trim();
    const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || msg.from.username || String(msg.from.id);
    if (text.startsWith('/start') || text.startsWith('/app')) {
      const row = await db.get('SELECT id FROM users WHERE tg_id = ?', [msg.from.id]);
      if (row) await db.run('UPDATE users SET bot_started = 1 WHERE tg_id = ?', [msg.from.id]);
      else await db.run('INSERT INTO users (tg_id, name, bot_started, created_at) VALUES (?, ?, 1, ?)', [msg.from.id, name, new Date().toISOString()]);
      const extra = webAppUrl && webAppUrl.startsWith('https://')
        ? { reply_markup: { inline_keyboard: [[{ text: '📒 Открыть учёт работы', web_app: { url: webAppUrl } }]] } }
        : {};
      await tg(token, 'sendMessage', { chat_id: msg.chat.id, parse_mode: 'HTML', text: `Привет, <b>${esc(name)}</b>! Уведомления подключены ✅\nЯ буду напоминать о заказах заранее.`, ...extra });
    }
  }

  let polling = false;
  async function startPolling() {
    if (!token || polling) return;
    polling = true;
    try { await tg(token, 'deleteWebhook', { drop_pending_updates: false }); } catch (e) { log.warn('deleteWebhook:', e.message); }
    try {
      const me = await verifyToken(token);
      log.log(`Бот @${me.username} подключён (polling)`);
      if (webAppUrl && webAppUrl.startsWith('https://')) {
        await tg(token, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Учёт', web_app: { url: webAppUrl } } }).catch(() => {});
      }
    } catch (e) { log.error('Токен бота не принят Telegram:', e.message); polling = false; return; }
    let offset = 0;
    (async function loop() {
      while (polling) {
        try {
          const updates = await tg(token, 'getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
          for (const u of updates) { offset = u.update_id + 1; await handleUpdate(u).catch((e) => log.error('update:', e.message)); }
        } catch (e) { log.warn('getUpdates:', e.message); await new Promise((r) => setTimeout(r, 5000)); }
      }
    })();
  }

  // ---------- напоминания ----------
  async function checkReminders() {
    const now = new Date();
    const nowStamp = localStamp(now, tz);
    const rows = await db.all(
      `SELECT o.*, u.tg_id, u.bot_token, u.chat_id, u.remind_before_min
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE o.status = 'new' AND o.reminded = 0 AND u.notify_enabled = 1 AND o.scheduled_at >= ?`,
      [nowStamp]);
    for (const o of rows) {
      const left = Math.round((stampToMs(o.scheduled_at) - stampToMs(nowStamp)) / 60000);
      if (left > o.remind_before_min) continue;
      const [d, t] = o.scheduled_at.split(' ');
      const text = `🔔 <b>Напоминание о заказе</b> — через ${humanLeft(left)}\n\n` +
        `🕒 ${d.split('-').reverse().join('.')} в ${t}\n👤 ${esc(o.client_name)}\n` +
        (o.address ? `📍 ${esc(o.address)}\n` : '') + (o.service ? `🔧 ${esc(o.service)}\n` : '') +
        (o.price ? `💰 ${o.price} ₽\n` : '') + (o.note ? `📝 ${esc(o.note)}` : '');
      try {
        await notifyUser(o, text.trim());
        await db.run('UPDATE orders SET reminded = 1 WHERE id = ?', [o.id]);
      } catch (e) {
        log.warn(`Напоминание по заказу #${o.id} не отправлено: ${e.message}`);
        // «бот заблокирован / чат не найден» — не долбим бесконечно
        if (e.code === 403 || e.code === 400) await db.run('UPDATE orders SET reminded = 1 WHERE id = ?', [o.id]);
      }
    }
  }

  let timer;
  function startScheduler(everyMs = 60_000) {
    const tick = () => checkReminders().catch((e) => log.error('scheduler:', e.message));
    tick();
    timer = setInterval(tick, everyMs);
  }
  const stop = () => { polling = false; clearInterval(timer); };

  return { tg, notifyUser, verifyToken, startPolling, startScheduler, checkReminders, handleUpdate, stop, localStamp, esc };
}

module.exports = { createBot, localStamp };
