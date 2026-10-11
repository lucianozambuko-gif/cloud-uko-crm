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

  // Columns added after v1: CREATE TABLE IF NOT EXISTS does not alter tables that already exist.
  await ensureColumn('tasks', 'document_id', 'INTEGER REFERENCES documents(id)');
  await ensureColumn('tasks', 'auto_key', 'TEXT');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_tasks_document ON tasks(document_id)');

  // Project life cycle. "stage" is how far along the work is; "state" is open, paused or cancelled.
  // The original "status" column is no longer used (it stays because SQLite cannot drop its CHECK rule).
  const addedStage = await ensureColumn('projects', 'stage', "TEXT NOT NULL DEFAULT 'planning'");
  await ensureColumn('projects', 'state', "TEXT NOT NULL DEFAULT 'open'");
  await ensureColumn('projects', 'demo_url', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('projects', 'start_date', 'TEXT');
  await ensureColumn('projects', 'target_date', 'TEXT');
  await ensureColumn('projects', 'stage_changed_at', 'TEXT');
  await ensureColumn('tasks', 'project_id', 'INTEGER REFERENCES projects(id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)');
  if (addedStage) {
    // One-time carry-over from the old status values.
    await db.execute("UPDATE projects SET stage = 'live' WHERE status = 'completed'");
    await db.execute("UPDATE projects SET state = 'paused' WHERE status = 'paused'");
    await db.execute("UPDATE projects SET status = 'active'");
  }
}

// Returns true when the column had to be added.
async function ensureColumn(table, column, definition) {
  const cols = (await db.execute(`PRAGMA table_info(${table})`)).rows;
  if (cols.some((c) => c.name === column)) return false;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
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
