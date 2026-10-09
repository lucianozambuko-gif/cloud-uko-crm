const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(dataDir, { recursive: true });

const dbFile = path.join(dataDir, 'crm.db');
const db = createClient({
  url: process.env.DATABASE_URL || 'file:' + dbFile.replace(/\\/g, '/'),
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.executeMultiple(schema);
}

async function all(sql, args = []) {
  return (await db.execute({ sql, args })).rows;
}

async function get(sql, args = []) {
  return (await all(sql, args))[0] || null;
}

async function run(sql, args = []) {
  const r = await db.execute({ sql, args });
  return { id: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
}

module.exports = { db, dataDir, dbFile, migrate, all, get, run };
