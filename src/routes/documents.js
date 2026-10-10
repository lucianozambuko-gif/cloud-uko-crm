const express = require('express');
const { db, get, all, run } = require('../db');
const v = require('../lib/validate');
const { today, isDate, addDays, parseMoney, moneyInput } = require('../lib/format');
const { currentVatRate } = require('../lib/settings');
const { DOC_SELECT, createDocument, updateDocument, getItems } = require('../services/documents');
const { renderPdf } = require('../pdf');
const wa = require('../lib/whatsapp');
const { closeResolvedTasks } = require('../services/automation');

const PAYMENT_METHODS = ['EFT', 'Cash', 'Card', 'Other'];

// One router serves both /quotes and /invoices; they differ only in statuses, payments and conversion.
module.exports = function documentsRouter(kind) {
  const router = express.Router();
  const isInvoice = kind === 'invoice';
  const base = isInvoice ? '/invoices' : '/quotes';
  const label = isInvoice ? 'Invoice' : 'Quote';
  const statuses = isInvoice ? ['draft', 'sent', 'void'] : ['draft', 'sent', 'accepted', 'declined'];
  const view = { kind, base, label, isInvoice, methods: PAYMENT_METHODS };

  async function loadDoc(req) {
    const id = v.id(req.params.id);
    const doc = id && (await get(`${DOC_SELECT} WHERE d.id = ? AND d.kind = ?`, [id, kind]));
    if (!doc) throw v.notFound(`${label} not found.`);
    return doc;
  }

  // Sent invoices are locked; move one back to draft (only possible with no payments) to change it.
  function editable(doc) {
    return isInvoice ? doc.status === 'draft' : doc.status !== 'accepted';
  }

  async function formOptions(clientId) {
    const [clients, projects] = await Promise.all([
      all('SELECT id, name FROM clients WHERE archived = 0 OR id = ? ORDER BY name COLLATE NOCASE', [clientId ?? 0]),
      all(`SELECT p.id, p.name, p.client_id, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id
           ORDER BY c.name COLLATE NOCASE, p.name COLLATE NOCASE`),
    ]);
    return { clients, projects };
  }

  async function parseForm(body) {
    const errors = [];
    const values = {
      client_id: v.id(body.client_id),
      project_id: v.id(body.project_id),
      issue_date: v.str(body.issue_date, 10),
      due_date: v.str(body.due_date, 10),
      notes: v.text(body.notes, 2000),
      rows: [],
      items: [],
    };

    const descriptions = v.list(body.item_description);
    const quantities = v.list(body.item_quantity);
    const prices = v.list(body.item_price);
    for (let i = 0; i < Math.min(descriptions.length, 100); i++) {
      const row = { description: v.str(descriptions[i], 300), quantity: v.str(quantities[i], 12), price: v.str(prices[i], 20) };
      if (!row.description && !row.price) continue;
      values.rows.push(row);
      const quantity = Number(row.quantity.replace(',', '.') || '1');
      const unitCents = parseMoney(row.price);
      const n = values.rows.length;
      if (!row.description) errors.push(`Line ${n}: description is required.`);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) errors.push(`Line ${n}: quantity must be more than 0.`);
      if (unitCents === null) errors.push(`Line ${n}: price is not a valid amount.`);
      values.items.push({ description: row.description, quantity, unit_cents: unitCents });
    }

    if (!values.client_id || !(await get('SELECT id FROM clients WHERE id = ?', [values.client_id]))) errors.push('Choose a client.');
    if (values.project_id) {
      const project = await get('SELECT client_id FROM projects WHERE id = ?', [values.project_id]);
      if (!project || project.client_id !== values.client_id) errors.push('That project belongs to a different client.');
    }
    if (!isDate(values.issue_date)) errors.push('Date is not valid.');
    if (!isDate(values.due_date)) errors.push(`${isInvoice ? 'Due date' : 'Valid-until date'} is not valid.`);
    else if (isDate(values.issue_date) && values.due_date < values.issue_date) errors.push(`${isInvoice ? 'Due date' : 'Valid-until date'} cannot be before the date.`);
    if (!values.rows.length) errors.push('Add at least one line item.');
    return { values, errors };
  }

  async function renderForm(res, { doc, values, errors, status }) {
    res.status(status || 200).render('docs/form', {
      ...view,
      title: doc ? `Edit ${doc.number}` : `New ${label.toLowerCase()}`,
      action: doc ? `${base}/${doc.id}` : base,
      doc,
      values,
      errors: errors || [],
      ...(await formOptions(values.client_id)),
    });
  }

  router.get('/', async (req, res) => {
    const show = req.query.show === 'all' || !isInvoice ? 'all' : 'open';
    const rows = await all(`${DOC_SELECT} WHERE d.kind = ? ORDER BY d.issue_date DESC, d.number DESC`, [kind]);
    const docs = show === 'open' ? rows.filter((d) => d.status !== 'void' && d.paid_cents < d.total_cents) : rows;
    res.render('docs/list', { ...view, title: `${label}s`, docs, show });
  });

  router.get('/new', async (req, res) => {
    const settings = res.locals.settings;
    const issue = today();
    const days = Number(isInvoice ? settings.payment_terms_days : settings.quote_valid_days) || 0;
    const projectId = v.id(req.query.project_id);
    const project = projectId && (await get('SELECT id, client_id FROM projects WHERE id = ?', [projectId]));
    await renderForm(res, {
      values: {
        client_id: project ? project.client_id : v.id(req.query.client_id),
        project_id: project ? project.id : null,
        issue_date: issue,
        due_date: addDays(issue, days),
        notes: '',
        rows: [],
      },
    });
  });

  router.post('/', async (req, res) => {
    const { values, errors } = await parseForm(req.body);
    if (errors.length) return renderForm(res, { values, errors, status: 400 });
    const settings = res.locals.settings;
    const id = await createDocument({ ...values, kind, status: 'draft', vat_rate: currentVatRate(settings) }, settings);
    v.flash(req, 'ok', `${label} created as a draft.`);
    res.redirect(`${base}/${id}`);
  });

  router.get('/:id', async (req, res) => {
    const doc = await loadDoc(req);
    const [items, payments, client] = await Promise.all([
      getItems(doc.id),
      all('SELECT * FROM payments WHERE document_id = ? ORDER BY paid_on, id', [doc.id]),
      get('SELECT * FROM clients WHERE id = ?', [doc.client_id]),
    ]);
    res.render('docs/show', {
      ...view, title: doc.number, doc, items, payments, client, statuses, editable: editable(doc), today: today(),
      whatsapp: wa.documentButtons({ doc, client, settings: res.locals.settings }),
    });
  });

  router.get('/:id/pdf', async (req, res) => {
    const doc = await loadDoc(req);
    const [items, payments, client] = await Promise.all([
      getItems(doc.id),
      all('SELECT * FROM payments WHERE document_id = ? ORDER BY paid_on, id', [doc.id]),
      get('SELECT * FROM clients WHERE id = ?', [doc.client_id]),
    ]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.number}.pdf"`);
    renderPdf(res, { doc, items, payments, client, settings: res.locals.settings });
  });

  router.get('/:id/edit', async (req, res) => {
    const doc = await loadDoc(req);
    if (!editable(doc)) {
      v.flash(req, 'err', `${doc.number} is ${doc.status} and can no longer be edited.`);
      return res.redirect(`${base}/${doc.id}`);
    }
    const items = await getItems(doc.id);
    await renderForm(res, {
      doc,
      values: {
        client_id: doc.client_id,
        project_id: doc.project_id,
        issue_date: doc.issue_date,
        due_date: doc.due_date,
        notes: doc.notes,
        rows: items.map((it) => ({ description: it.description, quantity: String(it.quantity), price: moneyInput(it.unit_cents) })),
      },
    });
  });

  router.post('/:id', async (req, res) => {
    const doc = await loadDoc(req);
    if (!editable(doc)) {
      v.flash(req, 'err', `${doc.number} is ${doc.status} and can no longer be edited.`);
      return res.redirect(`${base}/${doc.id}`);
    }
    const { values, errors } = await parseForm(req.body);
    if (errors.length) return renderForm(res, { doc, values, errors, status: 400 });
    await updateDocument(doc.id, values, doc.vat_rate);
    v.flash(req, 'ok', `${label} saved.`);
    res.redirect(`${base}/${doc.id}`);
  });

  router.post('/:id/status', async (req, res) => {
    const doc = await loadDoc(req);
    const status = v.str(req.body.status, 20);
    if (!statuses.includes(status)) throw Object.assign(new Error('Unknown status.'), { status: 400 });
    if (isInvoice && status !== 'sent' && doc.paid_cents > 0) {
      v.flash(req, 'err', 'This invoice has payments recorded. Remove them before changing it to draft or void.');
      return res.redirect(`${base}/${doc.id}`);
    }
    await run('UPDATE documents SET status = ? WHERE id = ?', [status, doc.id]);
    await closeResolvedTasks();
    v.flash(req, 'ok', `${doc.number} marked as ${status}.`);
    res.redirect(`${base}/${doc.id}`);
  });

  router.post('/:id/delete', async (req, res) => {
    const doc = await loadDoc(req);
    if (doc.status !== 'draft') {
      v.flash(req, 'err', 'Only drafts can be deleted.');
      return res.redirect(`${base}/${doc.id}`);
    }
    await db.batch(
      [
        // Automatic tasks about this draft go with it; your own tasks are kept but unlinked.
        { sql: 'DELETE FROM tasks WHERE document_id = ? AND auto_key IS NOT NULL', args: [doc.id] },
        { sql: 'UPDATE tasks SET document_id = NULL WHERE document_id = ?', args: [doc.id] },
        { sql: 'DELETE FROM document_items WHERE document_id = ?', args: [doc.id] },
        { sql: 'DELETE FROM documents WHERE id = ?', args: [doc.id] },
      ],
      'write'
    );
    v.flash(req, 'ok', `${doc.number} deleted.`);
    res.redirect(base);
  });

  if (isInvoice) {
    router.post('/:id/payments', async (req, res) => {
      const doc = await loadDoc(req);
      const amount = parseMoney(req.body.amount);
      const paidOn = v.str(req.body.paid_on, 10);
      const method = v.str(req.body.method, 20);
      const outstanding = doc.total_cents - doc.paid_cents;

      let error = '';
      if (doc.status !== 'sent') error = 'Mark the invoice as sent before recording a payment.';
      else if (amount === null || amount <= 0) error = 'Payment amount is not valid.';
      else if (amount > outstanding) error = 'Payment is more than the amount outstanding.';
      else if (!isDate(paidOn)) error = 'Payment date is not valid.';
      else if (!PAYMENT_METHODS.includes(method)) error = 'Choose a payment method.';
      if (error) {
        v.flash(req, 'err', error);
        return res.redirect(`${base}/${doc.id}`);
      }

      await run('INSERT INTO payments (document_id, amount_cents, paid_on, method, reference) VALUES (?, ?, ?, ?, ?)',
        [doc.id, amount, paidOn, method, v.str(req.body.reference, 100)]);
      await closeResolvedTasks();
      v.flash(req, 'ok', 'Payment recorded.');
      res.redirect(`${base}/${doc.id}`);
    });

    router.post('/:id/payments/:paymentId/delete', async (req, res) => {
      const doc = await loadDoc(req);
      const { changes } = await run('DELETE FROM payments WHERE id = ? AND document_id = ?', [v.id(req.params.paymentId), doc.id]);
      if (!changes) throw v.notFound('Payment not found.');
      v.flash(req, 'ok', 'Payment removed.');
      res.redirect(`${base}/${doc.id}`);
    });
  } else {
    router.post('/:id/convert', async (req, res) => {
      const quote = await loadDoc(req);
      const existing = await get("SELECT id FROM documents WHERE source_quote_id = ? AND status != 'void'", [quote.id]);
      if (existing) {
        v.flash(req, 'err', 'This quote has already been converted to an invoice.');
        return res.redirect(`/invoices/${existing.id}`);
      }
      const settings = res.locals.settings;
      const issue = today();
      const items = await getItems(quote.id);
      const id = await createDocument(
        {
          kind: 'invoice',
          client_id: quote.client_id,
          project_id: quote.project_id,
          issue_date: issue,
          due_date: addDays(issue, Number(settings.payment_terms_days) || 0),
          status: 'draft',
          notes: quote.notes,
          vat_rate: quote.vat_rate,
          source_quote_id: quote.id,
          items: items.map((it) => ({ description: it.description, quantity: it.quantity, unit_cents: it.unit_cents })),
        },
        settings
      );
      await run("UPDATE documents SET status = 'accepted' WHERE id = ?", [quote.id]);
      await closeResolvedTasks();
      v.flash(req, 'ok', `Draft invoice created from ${quote.number}.`);
      res.redirect(`/invoices/${id}`);
    });
  }

  return router;
};
