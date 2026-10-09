// One-off import of starting data from data/seed.json (kept out of git: it holds client personal info).
// Usage: npm run import-seed
// Refuses to run if the database already has clients, so it cannot duplicate or overwrite anything.
const fs = require('fs');
const path = require('path');
const { dataDir, migrate, get, run } = require('../src/db');
const { loadSettings, currentVatRate } = require('../src/lib/settings');
const { isDate } = require('../src/lib/format');
const { createDocument } = require('../src/services/documents');

const rand = (n) => Math.round(Number(n) * 100);

function check(cond, msg) {
  if (!cond) throw new Error(msg);
}

function validate(seed) {
  check(Array.isArray(seed.clients) && seed.clients.length, 'seed.json has no clients.');
  for (const c of seed.clients) {
    check(c.name, 'A client is missing a name.');
    const projectNames = (c.projects || []).map((p) => p.name);
    for (const inv of c.invoices || []) {
      check(isDate(inv.issue_date) && isDate(inv.due_date), `${c.name}: invoice has an invalid date.`);
      check(!inv.project || projectNames.includes(inv.project), `${c.name}: invoice refers to unknown project "${inv.project}".`);
      check(Array.isArray(inv.items) && inv.items.length, `${c.name}: invoice has no items.`);
      const total = inv.items.reduce((sum, it) => sum + Math.round((it.quantity ?? 1) * rand(it.unit)), 0);
      const paid = (inv.payments || []).reduce((sum, p) => sum + rand(p.amount), 0);
      check(paid <= total, `${c.name}: payments are more than the invoice total.`);
      for (const p of inv.payments || []) check(isDate(p.paid_on), `${c.name}: payment has an invalid date.`);
    }
    for (const r of c.recurring || []) {
      check(['monthly', 'yearly'].includes(r.interval) && isDate(r.next_date), `${c.name}: recurring service is invalid.`);
      check(!r.project || projectNames.includes(r.project), `${c.name}: recurring service refers to unknown project "${r.project}".`);
    }
  }
}

async function main() {
  const file = path.join(dataDir, 'seed.json');
  check(fs.existsSync(file), `No seed file found at ${file}`);
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  validate(seed);

  await migrate();
  const existing = (await get('SELECT COUNT(*) AS n FROM clients')).n;
  check(existing === 0, `The database already has ${existing} client(s). Import only runs on an empty database.`);

  const settings = await loadSettings();
  const vatRate = currentVatRate(settings);
  const counts = { clients: 0, projects: 0, invoices: 0, payments: 0, recurring: 0 };

  for (const c of seed.clients) {
    const { id: clientId } = await run(
      'INSERT INTO clients (name, company, phone, email, notes) VALUES (?, ?, ?, ?, ?)',
      [c.name, c.company || '', c.phone || '', c.email || '', c.notes || '']
    );
    counts.clients++;

    const projectIds = {};
    for (const p of c.projects || []) {
      const { id } = await run('INSERT INTO projects (client_id, name, type, url, notes) VALUES (?, ?, ?, ?, ?)',
        [clientId, p.name, p.type || '', p.url || '', p.notes || '']);
      projectIds[p.name] = id;
      counts.projects++;
    }

    for (const inv of c.invoices || []) {
      const docId = await createDocument(
        {
          kind: 'invoice',
          client_id: clientId,
          project_id: projectIds[inv.project] ?? null,
          issue_date: inv.issue_date,
          due_date: inv.due_date,
          status: 'sent',
          notes: inv.notes || '',
          vat_rate: vatRate,
          items: inv.items.map((it) => ({ description: it.description, quantity: it.quantity ?? 1, unit_cents: rand(it.unit) })),
        },
        settings
      );
      counts.invoices++;
      for (const p of inv.payments || []) {
        await run('INSERT INTO payments (document_id, amount_cents, paid_on, method, reference) VALUES (?, ?, ?, ?, ?)',
          [docId, rand(p.amount), p.paid_on, p.method || 'Other', p.reference || '']);
        counts.payments++;
      }
    }

    for (const r of c.recurring || []) {
      await run(
        'INSERT INTO recurring (client_id, project_id, description, amount_cents, interval, next_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [clientId, projectIds[r.project] ?? null, r.description, rand(r.amount), r.interval, r.next_date, r.notes || '']
      );
      counts.recurring++;
    }
  }

  const totals = await get(
    `SELECT COALESCE(SUM(total_cents), 0) AS billed,
            (SELECT COALESCE(SUM(amount_cents), 0) FROM payments) AS paid
     FROM documents WHERE kind = 'invoice' AND status = 'sent'`
  );
  console.log('Imported:', counts);
  console.log(`Billed R${totals.billed / 100}, paid R${totals.paid / 100}, outstanding R${(totals.billed - totals.paid) / 100}`);
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
