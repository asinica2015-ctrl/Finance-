'use strict';
/**
 * Универсальный адаптер БД. Выбор по DATABASE_URL:
 *   sqlite:./data/app.db        (встроенный node:sqlite, ничего ставить не нужно)
 *   postgres://user:pass@host/db (нужен пакет `pg`)
 *   mysql://user:pass@host/db    (нужен пакет `mysql2`)
 *
 * Интерфейс одинаковый для всех:
 *   db.all(sql, params)  -> массив строк
 *   db.get(sql, params)  -> строка | undefined
 *   db.run(sql, params)  -> { changes }
 *   db.insert(sql, params) -> id вставленной строки
 * В SQL используются плейсхолдеры `?` — адаптер сам преобразует их под диалект.
 */

const path = require('path');
const fs = require('fs');

function ddl(dialect) {
  const pk = { sqlite: 'INTEGER PRIMARY KEY AUTOINCREMENT', postgres: 'BIGSERIAL PRIMARY KEY', mysql: 'BIGINT AUTO_INCREMENT PRIMARY KEY' }[dialect];
  const money = { sqlite: 'REAL', postgres: 'DOUBLE PRECISION', mysql: 'DOUBLE' }[dialect];
  const text = dialect === 'mysql' ? 'VARCHAR(255)' : 'TEXT';
  const long = dialect === 'mysql' ? 'TEXT' : 'TEXT';
  const bigint = dialect === 'sqlite' ? 'INTEGER' : 'BIGINT';
  return [
    `CREATE TABLE IF NOT EXISTS users (
      id ${pk},
      tg_id ${bigint} NOT NULL UNIQUE,
      name ${text},
      notify_enabled INTEGER NOT NULL DEFAULT 1,
      remind_before_min INTEGER NOT NULL DEFAULT 360,
      bot_token ${text},
      chat_id ${text},
      bot_started INTEGER NOT NULL DEFAULT 0,
      created_at ${text} NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS clients (
      id ${pk},
      user_id ${bigint} NOT NULL,
      name ${text} NOT NULL,
      address ${text},
      service ${text},
      phone ${text},
      note ${long}
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id ${pk},
      user_id ${bigint} NOT NULL,
      client_id ${bigint},
      client_name ${text} NOT NULL,
      address ${text},
      service ${text},
      scheduled_at ${text} NOT NULL,
      price ${money} NOT NULL DEFAULT 0,
      transport ${money} NOT NULL DEFAULT 0,
      note ${long},
      status ${dialect === 'mysql' ? 'VARCHAR(16)' : 'TEXT'} NOT NULL DEFAULT 'new',
      reminded INTEGER NOT NULL DEFAULT 0,
      created_at ${text} NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id ${pk},
      user_id ${bigint} NOT NULL,
      date ${dialect === 'mysql' ? 'VARCHAR(10)' : 'TEXT'} NOT NULL,
      amount ${money} NOT NULL,
      category ${text} NOT NULL,
      note ${long}
    )`,
  ];
}

const INDEXES = [
  'CREATE INDEX idx_orders_user_status ON orders (user_id, status)',
  'CREATE INDEX idx_expenses_user_date ON expenses (user_id, date)',
  'CREATE INDEX idx_clients_user ON clients (user_id)',
];

function toPg(sql) { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); }

async function createSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const norm = (p) => (p || []).map((v) => (v === undefined ? null : v));
  return {
    dialect: 'sqlite',
    async all(sql, p) { return d.prepare(sql).all(...norm(p)).map((r) => ({ ...r })); },
    async get(sql, p) { const r = d.prepare(sql).get(...norm(p)); return r ? { ...r } : undefined; },
    async run(sql, p) { const r = d.prepare(sql).run(...norm(p)); return { changes: Number(r.changes) }; },
    async insert(sql, p) { const r = d.prepare(sql).run(...norm(p)); return Number(r.lastInsertRowid); },
    async exec(sql) { d.exec(sql); },
    async close() { d.close(); },
  };
}

async function createPostgres(url) {
  let pg;
  try { pg = require('pg'); } catch { throw new Error('Для PostgreSQL установите драйвер: npm i pg'); }
  const ssl = /sslmode=require|ssl=true/.test(url) || process.env.DB_SSL === '1' ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl });
  const q = (sql, p) => pool.query(toPg(sql), p || []);
  return {
    dialect: 'postgres',
    async all(sql, p) { return (await q(sql, p)).rows; },
    async get(sql, p) { return (await q(sql, p)).rows[0]; },
    async run(sql, p) { return { changes: (await q(sql, p)).rowCount }; },
    async insert(sql, p) { return Number((await q(sql + ' RETURNING id', p)).rows[0].id); },
    async exec(sql) { await pool.query(sql); },
    async close() { await pool.end(); },
  };
}

async function createMysql(url) {
  let mysql;
  try { mysql = require('mysql2/promise'); } catch { throw new Error('Для MySQL/MariaDB установите драйвер: npm i mysql2'); }
  const pool = mysql.createPool({ uri: url, decimalNumbers: true, supportBigNumbers: true, bigNumberStrings: false });
  return {
    dialect: 'mysql',
    async all(sql, p) { return (await pool.query(sql, p || []))[0]; },
    async get(sql, p) { return (await pool.query(sql, p || []))[0][0]; },
    async run(sql, p) { return { changes: (await pool.query(sql, p || []))[0].affectedRows }; },
    async insert(sql, p) { return Number((await pool.query(sql, p || []))[0].insertId); },
    async exec(sql) { await pool.query(sql); },
    async close() { await pool.end(); },
  };
}

async function connect(url) {
  url = url || 'sqlite:./data/app.db';
  let db;
  if (/^sqlite:/i.test(url)) db = await createSqlite(url.replace(/^sqlite:(\/\/)?/i, '') || ':memory:');
  else if (/^postgres(ql)?:/i.test(url)) db = await createPostgres(url);
  else if (/^(mysql|mariadb):/i.test(url)) db = await createMysql(url.replace(/^mariadb:/i, 'mysql:'));
  else throw new Error(`Неизвестный DATABASE_URL: ${url.split(':')[0]}:// (поддерживаются sqlite:, postgres://, mysql://)`);

  for (const stmt of ddl(db.dialect)) await db.exec(stmt);
  for (const idx of INDEXES) {
    try { await db.exec(idx); } catch { /* индекс уже существует */ }
  }
  return db;
}

module.exports = { connect };
