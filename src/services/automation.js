const { db, get, all, run } = require('../db');
const { loadSettings } = require('../lib/settings');
const { today, addDays, daysBetween, addInterval, fmtDate, money } = require('../lib/format');
const { DOC_SELECT, generateFromRecurring } = require('./documents');

// A service that was missed while the PC was off is caught up, but never by more than this many periods at once.
const MAX_CATCH_UP = 12;

let running = false;

async function done(key) {
  return Boolean(await get('SELECT 1 AS x FROM automation_log WHERE key = ?', [key]));
}

async function log(key, message, link = '') {
  await run('INSERT INTO automation_log (key, message, link) VALUES (?, ?, ?)', [key, message, link]);
}

// Records the action and creates its follow-up task together, so one cannot exist without the other.
async function logWithTask(key, message, link, task) {
  await db.batch(
    [
      { sql: 'INSERT INTO automation_log (key, message, link) VALUES (?, ?, ?)', args: [key, message, link] },
      {
        sql: 'INSERT INTO tasks (client_id, document_id, project_id, auto_key, title, due_date) VALUES (?, ?, ?, ?, ?, ?)',
        args: [task.client_id, task.document_id ?? null, task.project_id ?? null, task.auto_key, task.title, task.due_date],
      },
    ],
    'write'
  );
}

// 1. Invoice recurring services that have reached their billing date.
async function invoiceRecurring(settings, t, actions) {
  const mode = settings.auto_invoice_mode;
  if (mode !== 'draft' && mode !== 'sent') return;

  const due = await all(
    `SELECT r.*, c.name AS client_name FROM recurring r JOIN clients c ON c.id = r.client_id
     WHERE r.active = 1 AND c.archived = 0 AND r.next_date <= ? ORDER BY r.next_date`, [t]);
  for (const rec of due) {
    for (let i = 0; i < MAX_CATCH_UP && rec.next_date <= t; i++) {
      const key = `recurring:${rec.id}:${rec.next_date}`;
      const period = rec.next_date;
      if (!(await done(key))) {
        const id = await generateFromRecurring(rec, settings, mode);
        const doc = await get('SELECT number, total_cents FROM documents WHERE id = ?', [id]);
        const message = `Created ${mode === 'draft' ? 'draft ' : ''}invoice ${doc.number} for ${rec.client_name}: ${rec.description}, ${money(doc.total_cents)}`;
        await logWithTask(key, message, `/invoices/${id}`, {
          client_id: rec.client_id,
          document_id: id,
          auto_key: mode === 'draft' ? 'review' : 'deliver',
          title: mode === 'draft'
            ? `Check and send invoice ${doc.number} (${rec.description}, ${money(doc.total_cents)})`
            : `Send invoice ${doc.number} to the client (${rec.description}, ${money(doc.total_cents)})`,
          due_date: t,
        });
        actions.push(message);
      } else {
        // Already invoiced for this period (the date was not moved on last time): just move it on.
        await run('UPDATE recurring SET next_date = ? WHERE id = ?', [addInterval(period, rec.interval), rec.id]);
      }
      rec.next_date = addInterval(period, rec.interval);
    }
  }
}

// 2. Warn ahead of yearly renewals, so the price can be confirmed and the client told.
async function renewalReminders(settings, t, actions) {
  const days = Number(settings.renewal_reminder_days) || 0;
  if (days <= 0) return;

  const upcoming = await all(
    `SELECT r.*, c.name AS client_name FROM recurring r JOIN clients c ON c.id = r.client_id
     WHERE r.active = 1 AND c.archived = 0 AND r.interval = 'yearly' AND r.next_date > ? AND r.next_date <= ?`,
    [t, addDays(t, days)]);
  for (const rec of upcoming) {
    const key = `renewal:${rec.id}:${rec.next_date}`;
    if (await done(key)) continue;
    const message = `Renewal coming up for ${rec.client_name}: ${rec.description}, ${money(rec.amount_cents)} on ${fmtDate(rec.next_date)}`;
    await logWithTask(key, message, `/recurring/${rec.id}/edit`, {
      client_id: rec.client_id,
      auto_key: 'renewal',
      title: `Renewal on ${fmtDate(rec.next_date)}: ${rec.description} (${money(rec.amount_cents)}). Confirm the price and tell the client.`,
      due_date: rec.next_date,
    });
    actions.push(message);
  }
}

// 3. Chase overdue invoices, again every N days for as long as they stay unpaid.
async function chaseOverdue(settings, t, actions) {
  const every = Number(settings.overdue_followup_days) || 0;
  if (every <= 0) return;

  const overdue = await all(
    `SELECT * FROM (${DOC_SELECT} WHERE d.kind = 'invoice' AND d.status = 'sent' AND d.due_date < ?)
     WHERE total_cents > paid_cents`, [t]);
  for (const doc of overdue) {
    const open = await get("SELECT id FROM tasks WHERE document_id = ? AND auto_key = 'chase' AND done_at IS NULL", [doc.id]);
    if (open) continue;
    // Wait N days from the last reminder, or from when you ticked it off, whichever is later.
    const last = await get(
      `SELECT MAX(d) AS d FROM (
         SELECT substr(created_at, 1, 10) AS d FROM automation_log WHERE key LIKE ?
         UNION ALL
         SELECT substr(done_at, 1, 10) FROM tasks WHERE document_id = ? AND auto_key = 'chase' AND done_at IS NOT NULL)`,
      [`chase:${doc.id}:%`, doc.id]);
    if (last?.d && daysBetween(last.d, t) < every) continue;
    const key = `chase:${doc.id}:${t}`;
    if (await done(key)) continue;
    const outstanding = money(doc.total_cents - doc.paid_cents);
    const message = `Invoice ${doc.number} is overdue: ${doc.client_name} owes ${outstanding} (due ${fmtDate(doc.due_date)})`;
    await logWithTask(key, message, `/invoices/${doc.id}`, {
      client_id: doc.client_id,
      document_id: doc.id,
      auto_key: 'chase',
      title: `Chase payment on ${doc.number}: ${outstanding} outstanding, due ${fmtDate(doc.due_date)}`,
      due_date: t,
    });
    actions.push(message);
  }
}

// 4. Follow up on quotes that were sent and have had no answer.
async function quoteFollowUps(settings, t, actions) {
  const days = Number(settings.quote_followup_days) || 0;
  if (days <= 0) return;

  const quotes = await all(`${DOC_SELECT} WHERE d.kind = 'quote' AND d.status = 'sent' AND d.issue_date <= ?`, [addDays(t, -days)]);
  for (const doc of quotes) {
    const key = `quote:${doc.id}`;
    if (await done(key)) continue;
    const message = `No answer yet on quote ${doc.number} for ${doc.client_name} (${money(doc.total_cents)}, sent ${fmtDate(doc.issue_date)})`;
    await logWithTask(key, message, `/quotes/${doc.id}`, {
      client_id: doc.client_id,
      document_id: doc.id,
      auto_key: 'quote',
      title: `Follow up on quote ${doc.number} (${money(doc.total_cents)}, sent ${fmtDate(doc.issue_date)})`,
      due_date: t,
    });
    actions.push(message);
  }
}

// 5. Follow up when a project has been waiting in client review with no movement.
async function demoFollowUps(settings, t, actions) {
  const days = Number(settings.demo_followup_days) || 0;
  if (days <= 0) return;

  const waiting = await all(
    `SELECT p.id, p.name, p.client_id, substr(p.stage_changed_at, 1, 10) AS since, c.name AS client_name
     FROM projects p JOIN clients c ON c.id = p.client_id
     WHERE p.stage = 'review' AND p.state = 'open' AND c.archived = 0 AND p.stage_changed_at IS NOT NULL
       AND substr(p.stage_changed_at, 1, 10) <= ?`, [addDays(t, -days)]);
  for (const p of waiting) {
    const key = `demo:${p.id}:${p.since}`;
    if (await done(key)) continue;
    const message = `${p.client_name} has had the ${p.name} demo since ${fmtDate(p.since)} with no feedback recorded`;
    await logWithTask(key, message, `/projects/${p.id}`, {
      client_id: p.client_id,
      project_id: p.id,
      auto_key: 'demo',
      title: `Follow up on the ${p.name} demo (in client review since ${fmtDate(p.since)})`,
      due_date: t,
    });
    actions.push(message);
  }
}

// Called when a project moves to Live: reminds you to start billing hosting if nothing recurring is set up.
async function projectWentLive(project) {
  const key = `live:${project.id}`;
  if (await done(key)) return;
  const billed = await get('SELECT id FROM recurring WHERE project_id = ? AND active = 1', [project.id]);
  if (billed) return log(key, `${project.name} went live (recurring billing already set up)`, `/projects/${project.id}`);
  await logWithTask(key, `${project.name} went live: hosting billing still to set up`, `/projects/${project.id}`, {
    client_id: project.client_id,
    project_id: project.id,
    auto_key: 'golive',
    title: `Set up hosting billing for ${project.name} (now live)`,
    due_date: today(),
  });
}

// Ticks off automatic tasks whose reason has gone away: the invoice was paid or sent, the quote was answered,
// the project moved on from client review.
async function closeResolvedTasks() {
  const projects = await run(
    `UPDATE tasks SET done_at = datetime('now')
     WHERE done_at IS NULL AND auto_key = 'demo' AND project_id IN (
       SELECT p.id FROM projects p WHERE p.stage != 'review' OR p.state != 'open')`
  );
  const documents = await closeResolvedDocumentTasks();
  return projects.changes + documents;
}

async function closeResolvedDocumentTasks() {
  const { changes } = await run(
    `UPDATE tasks SET done_at = datetime('now')
     WHERE done_at IS NULL AND auto_key IN ('chase', 'review', 'quote') AND document_id IN (
       SELECT d.id FROM documents d WHERE
         (tasks.auto_key = 'review' AND d.status != 'draft')
         OR (tasks.auto_key = 'quote' AND d.status != 'sent')
         OR (tasks.auto_key = 'chase' AND (d.status != 'sent'
              OR d.total_cents <= COALESCE((SELECT SUM(amount_cents) FROM payments WHERE document_id = d.id), 0)))
     )`
  );
  return changes;
}

// Safe to run as often as you like: every action is recorded by key and never repeated.
async function runAutomation() {
  if (running) return { actions: [], closed: 0, skipped: true };
  running = true;
  try {
    const settings = await loadSettings();
    const t = today();
    const actions = [];
    const closed = await closeResolvedTasks();
    await invoiceRecurring(settings, t, actions);
    await renewalReminders(settings, t, actions);
    await chaseOverdue(settings, t, actions);
    await quoteFollowUps(settings, t, actions);
    await demoFollowUps(settings, t, actions);
    await run(
      "INSERT INTO settings (key, value) VALUES ('automation_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [new Date().toISOString()]
    );
    return { actions, closed, skipped: false };
  } finally {
    running = false;
  }
}

function recentActions(limit = 8) {
  return all('SELECT message, link, created_at FROM automation_log ORDER BY id DESC LIMIT ?', [limit]);
}

module.exports = { runAutomation, closeResolvedTasks, projectWentLive, recentActions, log };
