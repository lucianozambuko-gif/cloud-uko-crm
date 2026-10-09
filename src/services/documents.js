const { db, get, all } = require('../db');
const { today, addDays, addInterval, fmtDate, fmtMonth } = require('../lib/format');
const { currentVatRate } = require('../lib/settings');

const DOC_SELECT = `
  SELECT d.*, c.name AS client_name, p.name AS project_name,
    COALESCE((SELECT SUM(amount_cents) FROM payments WHERE document_id = d.id), 0) AS paid_cents
  FROM documents d
  JOIN clients c ON c.id = d.client_id
  LEFT JOIN projects p ON p.id = d.project_id`;

// Next number in the series for that year, e.g. CU-INV-2026-004.
async function nextNumber(kind, issueDate, settings) {
  const prefix = kind === 'invoice' ? settings.invoice_prefix : settings.quote_prefix;
  const base = `${prefix}-${issueDate.slice(0, 4)}-`;
  const row = await get(
    'SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS n FROM documents WHERE kind = ? AND substr(number, 1, ?) = ?',
    [base.length + 1, kind, base.length, base]
  );
  return base + String((row?.n || 0) + 1).padStart(3, '0');
}

function withTotals(items, vatRate) {
  const lines = items.map((it) => ({ ...it, line_cents: Math.round(it.quantity * it.unit_cents) }));
  const subtotal = lines.reduce((sum, it) => sum + it.line_cents, 0);
  const vat = Math.round((subtotal * vatRate) / 100);
  return { lines, subtotal, vat, total: subtotal + vat };
}

function itemInserts(lines, docIdSql, docIdArg) {
  return lines.map((it, i) => ({
    sql: `INSERT INTO document_items (document_id, position, description, quantity, unit_cents, line_cents)
          VALUES (${docIdSql}, ?, ?, ?, ?, ?)`,
    args: [docIdArg, i, it.description, it.quantity, it.unit_cents, it.line_cents],
  }));
}

// d: { kind, client_id, project_id, issue_date, due_date, status, notes, vat_rate, items, recurring_id, source_quote_id }
async function createDocument(d, settings) {
  const number = await nextNumber(d.kind, d.issue_date, settings);
  const t = withTotals(d.items, d.vat_rate);
  await db.batch(
    [
      {
        sql: `INSERT INTO documents (kind, number, client_id, project_id, issue_date, due_date, status, notes,
                vat_rate, subtotal_cents, vat_cents, total_cents, recurring_id, source_quote_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          d.kind, number, d.client_id, d.project_id ?? null, d.issue_date, d.due_date, d.status || 'draft',
          d.notes || '', d.vat_rate, t.subtotal, t.vat, t.total, d.recurring_id ?? null, d.source_quote_id ?? null,
        ],
      },
      ...itemInserts(t.lines, '(SELECT id FROM documents WHERE number = ?)', number),
    ],
    'write'
  );
  return (await get('SELECT id FROM documents WHERE number = ?', [number])).id;
}

async function updateDocument(id, d, vatRate) {
  const t = withTotals(d.items, vatRate);
  await db.batch(
    [
      {
        sql: `UPDATE documents SET client_id = ?, project_id = ?, issue_date = ?, due_date = ?, notes = ?,
                subtotal_cents = ?, vat_cents = ?, total_cents = ? WHERE id = ?`,
        args: [d.client_id, d.project_id ?? null, d.issue_date, d.due_date, d.notes || '', t.subtotal, t.vat, t.total, id],
      },
      { sql: 'DELETE FROM document_items WHERE document_id = ?', args: [id] },
      ...itemInserts(t.lines, '?', id),
    ],
    'write'
  );
}

function getItems(documentId) {
  return all('SELECT * FROM document_items WHERE document_id = ? ORDER BY position', [documentId]);
}

// Creates a draft invoice for the service's next period and moves next_date on.
async function generateFromRecurring(rec, settings) {
  const issue = today();
  const nextDate = addInterval(rec.next_date, rec.interval);
  const period = rec.interval === 'yearly'
    ? `${fmtDate(rec.next_date)} to ${fmtDate(addDays(nextDate, -1))}`
    : fmtMonth(rec.next_date);
  const id = await createDocument(
    {
      kind: 'invoice',
      client_id: rec.client_id,
      project_id: rec.project_id,
      issue_date: issue,
      due_date: addDays(issue, Number(settings.payment_terms_days) || 0),
      status: 'draft',
      vat_rate: currentVatRate(settings),
      recurring_id: rec.id,
      items: [{ description: `${rec.description} - ${period}`, quantity: 1, unit_cents: rec.amount_cents }],
    },
    settings
  );
  await db.execute({ sql: 'UPDATE recurring SET next_date = ? WHERE id = ?', args: [nextDate, rec.id] });
  return id;
}

module.exports = { DOC_SELECT, nextNumber, createDocument, updateDocument, getItems, generateFromRecurring };
