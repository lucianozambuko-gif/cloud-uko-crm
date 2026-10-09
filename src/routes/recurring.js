const express = require('express');
const { get, all, run } = require('../db');
const v = require('../lib/validate');
const { today, isDate, parseMoney, moneyInput } = require('../lib/format');
const { generateFromRecurring } = require('../services/documents');

const router = express.Router();
const INTERVALS = ['monthly', 'yearly'];

async function formOptions(clientId) {
  const [clients, projects] = await Promise.all([
    all('SELECT id, name FROM clients WHERE archived = 0 OR id = ? ORDER BY name COLLATE NOCASE', [clientId ?? 0]),
    all(`SELECT p.id, p.name, p.client_id, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id
         ORDER BY c.name COLLATE NOCASE, p.name COLLATE NOCASE`),
  ]);
  return { clients, projects, intervals: INTERVALS };
}

async function parseRecurring(body) {
  const values = {
    client_id: v.id(body.client_id),
    project_id: v.id(body.project_id),
    description: v.str(body.description, 200),
    amount: v.str(body.amount, 20),
    interval: v.str(body.interval, 10),
    next_date: v.str(body.next_date, 10),
    active: body.active === '1' ? 1 : 0,
    notes: v.text(body.notes, 2000),
  };
  values.amount_cents = parseMoney(values.amount);
  const errors = [];
  if (!values.client_id || !(await get('SELECT id FROM clients WHERE id = ?', [values.client_id]))) errors.push('Choose a client.');
  if (values.project_id) {
    const project = await get('SELECT client_id FROM projects WHERE id = ?', [values.project_id]);
    if (!project || project.client_id !== values.client_id) errors.push('That project belongs to a different client.');
  }
  if (!values.description) errors.push('Description is required.');
  if (values.amount_cents === null || values.amount_cents <= 0) errors.push('Amount is not valid.');
  if (!INTERVALS.includes(values.interval)) errors.push('Choose monthly or yearly.');
  if (!isDate(values.next_date)) errors.push('Next billing date is not valid.');
  return { values, errors };
}

async function loadRecurring(req) {
  const id = v.id(req.params.id);
  const rec = id && (await get('SELECT * FROM recurring WHERE id = ?', [id]));
  if (!rec) throw v.notFound('Recurring service not found.');
  return rec;
}

router.get('/', async (req, res) => {
  const t = today();
  const services = await all(
    `SELECT r.*, c.name AS client_name, p.name AS project_name FROM recurring r
     JOIN clients c ON c.id = r.client_id LEFT JOIN projects p ON p.id = r.project_id
     ORDER BY r.active DESC, r.next_date, c.name COLLATE NOCASE`
  );
  const active = services.filter((s) => s.active);
  res.render('recurring/list', {
    title: 'Recurring billing',
    services,
    today: t,
    dueCount: active.filter((s) => s.next_date <= t).length,
    monthlyTotal: active.filter((s) => s.interval === 'monthly').reduce((sum, s) => sum + s.amount_cents, 0),
    yearlyTotal: active.filter((s) => s.interval === 'yearly').reduce((sum, s) => sum + s.amount_cents, 0),
  });
});

router.get('/new', async (req, res) => {
  const clientId = v.id(req.query.client_id);
  res.render('recurring/form', {
    title: 'New recurring service', action: '/recurring', ...(await formOptions(clientId)),
    rec: { client_id: clientId, interval: 'monthly', next_date: today(), active: 1, amount: '' },
  });
});

router.post('/', async (req, res) => {
  const { values, errors } = await parseRecurring(req.body);
  if (errors.length) {
    return res.status(400).render('recurring/form', {
      title: 'New recurring service', action: '/recurring', ...(await formOptions(values.client_id)), rec: values, errors,
    });
  }
  await run(
    'INSERT INTO recurring (client_id, project_id, description, amount_cents, interval, next_date, active, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [values.client_id, values.project_id, values.description, values.amount_cents, values.interval, values.next_date, values.active, values.notes]
  );
  v.flash(req, 'ok', 'Recurring service added.');
  res.redirect('/recurring');
});

// Declared before /:id so "generate-due" is not read as an id.
router.post('/generate-due', async (req, res) => {
  const due = await all('SELECT * FROM recurring WHERE active = 1 AND next_date <= ? ORDER BY next_date', [today()]);
  for (const rec of due) await generateFromRecurring(rec, res.locals.settings);
  v.flash(req, 'ok', due.length ? `${due.length} draft invoice(s) created. Review them, then mark as sent.` : 'Nothing is due yet.');
  res.redirect(due.length ? '/invoices?show=all' : '/recurring');
});

router.get('/:id/edit', async (req, res) => {
  const rec = await loadRecurring(req);
  res.render('recurring/form', {
    title: 'Edit recurring service', action: `/recurring/${rec.id}`, ...(await formOptions(rec.client_id)),
    rec: { ...rec, amount: moneyInput(rec.amount_cents) },
  });
});

router.post('/:id', async (req, res) => {
  const rec = await loadRecurring(req);
  const { values, errors } = await parseRecurring(req.body);
  if (errors.length) {
    return res.status(400).render('recurring/form', {
      title: 'Edit recurring service', action: `/recurring/${rec.id}`, ...(await formOptions(values.client_id)),
      rec: { ...values, id: rec.id }, errors,
    });
  }
  await run(
    'UPDATE recurring SET client_id = ?, project_id = ?, description = ?, amount_cents = ?, interval = ?, next_date = ?, active = ?, notes = ? WHERE id = ?',
    [values.client_id, values.project_id, values.description, values.amount_cents, values.interval, values.next_date, values.active, values.notes, rec.id]
  );
  v.flash(req, 'ok', 'Recurring service saved.');
  res.redirect('/recurring');
});

router.post('/:id/generate', async (req, res) => {
  const rec = await loadRecurring(req);
  if (!rec.active) {
    v.flash(req, 'err', 'This service is paused. Make it active before invoicing.');
    return res.redirect('/recurring');
  }
  const id = await generateFromRecurring(rec, res.locals.settings);
  v.flash(req, 'ok', 'Draft invoice created. Review it, then mark as sent.');
  res.redirect(`/invoices/${id}`);
});

module.exports = router;
