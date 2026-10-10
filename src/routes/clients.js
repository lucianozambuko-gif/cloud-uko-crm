const express = require('express');
const { get, all, run } = require('../db');
const v = require('../lib/validate');
const { today } = require('../lib/format');
const { DOC_SELECT } = require('../services/documents');

const router = express.Router();

function parseClient(body) {
  const values = {
    name: v.str(body.name, 120),
    company: v.str(body.company, 120),
    phone: v.str(body.phone, 40),
    email: v.str(body.email, 160),
    address: v.text(body.address, 500),
    vat_number: v.str(body.vat_number, 30),
    notes: v.text(body.notes),
  };
  const errors = [];
  if (!values.name) errors.push('Name is required.');
  if (values.phone && !/^[+\d\s()-]+$/.test(values.phone)) errors.push('Phone can only contain digits, spaces, +, - and brackets.');
  if (values.email && !v.isEmail(values.email)) errors.push('Email address is not valid.');
  return { values, errors };
}

async function loadClient(req) {
  const id = v.id(req.params.id);
  const client = id && (await get('SELECT * FROM clients WHERE id = ?', [id]));
  if (!client) throw v.notFound('Client not found.');
  return client;
}

router.get('/', async (req, res) => {
  const q = v.str(req.query.q, 80);
  const archived = req.query.archived === '1' ? 1 : 0;
  const like = `%${q}%`;
  const clients = await all(
    `SELECT c.*,
       (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count,
       (SELECT COALESCE(SUM(d.total_cents), 0) FROM documents d
          WHERE d.client_id = c.id AND d.kind = 'invoice' AND d.status = 'sent') AS billed_cents,
       (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p JOIN documents d ON d.id = p.document_id
          WHERE d.client_id = c.id AND d.status = 'sent') AS paid_cents
     FROM clients c
     WHERE c.archived = ? AND (c.name LIKE ? OR c.company LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)
     ORDER BY c.name COLLATE NOCASE`,
    [archived, like, like, like, like]
  );
  res.render('clients/list', { title: 'Clients', clients, q, archived });
});

router.get('/new', (req, res) => {
  res.render('clients/form', { title: 'New client', client: {}, action: '/clients' });
});

router.post('/', async (req, res) => {
  const { values, errors } = parseClient(req.body);
  if (errors.length) return res.status(400).render('clients/form', { title: 'New client', client: values, action: '/clients', errors });
  const { id } = await run(
    'INSERT INTO clients (name, company, phone, email, address, vat_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [values.name, values.company, values.phone, values.email, values.address, values.vat_number, values.notes]
  );
  v.flash(req, 'ok', 'Client added.');
  res.redirect(`/clients/${id}`);
});

router.get('/:id', async (req, res) => {
  const client = await loadClient(req);
  const [projects, documents, tasks, recurring] = await Promise.all([
    all('SELECT * FROM projects WHERE client_id = ? ORDER BY status, name COLLATE NOCASE', [client.id]),
    all(`${DOC_SELECT} WHERE d.client_id = ? ORDER BY d.issue_date DESC, d.number DESC`, [client.id]),
    all(`SELECT t.*, d.number AS doc_number, d.kind AS doc_kind FROM tasks t LEFT JOIN documents d ON d.id = t.document_id
         WHERE t.client_id = ? AND t.done_at IS NULL ORDER BY t.due_date IS NULL, t.due_date, t.id`, [client.id]),
    all('SELECT * FROM recurring WHERE client_id = ? ORDER BY active DESC, next_date', [client.id]),
  ]);
  const sent = documents.filter((d) => d.kind === 'invoice' && d.status === 'sent');
  const billed = sent.reduce((sum, d) => sum + d.total_cents, 0);
  const paid = sent.reduce((sum, d) => sum + d.paid_cents, 0);
  res.render('clients/show', {
    title: client.name, client, projects, documents, tasks, recurring, billed, paid, today: today(),
  });
});

router.get('/:id/edit', async (req, res) => {
  const client = await loadClient(req);
  res.render('clients/form', { title: `Edit ${client.name}`, client, action: `/clients/${client.id}` });
});

router.post('/:id', async (req, res) => {
  const client = await loadClient(req);
  const { values, errors } = parseClient(req.body);
  if (errors.length) {
    return res.status(400).render('clients/form', {
      title: `Edit ${client.name}`, client: { ...values, id: client.id }, action: `/clients/${client.id}`, errors,
    });
  }
  await run(
    'UPDATE clients SET name = ?, company = ?, phone = ?, email = ?, address = ?, vat_number = ?, notes = ? WHERE id = ?',
    [values.name, values.company, values.phone, values.email, values.address, values.vat_number, values.notes, client.id]
  );
  v.flash(req, 'ok', 'Client saved.');
  res.redirect(`/clients/${client.id}`);
});

router.post('/:id/archive', async (req, res) => {
  const client = await loadClient(req);
  const archived = client.archived ? 0 : 1;
  await run('UPDATE clients SET archived = ? WHERE id = ?', [archived, client.id]);
  v.flash(req, 'ok', archived ? 'Client archived.' : 'Client restored.');
  res.redirect(`/clients/${client.id}`);
});

module.exports = router;
