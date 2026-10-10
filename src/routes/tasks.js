const express = require('express');
const { get, all, run } = require('../db');
const v = require('../lib/validate');
const { today, isDate } = require('../lib/format');

const router = express.Router();

router.get('/', async (req, res) => {
  const [open, done, clients] = await Promise.all([
    all(`SELECT t.*, c.name AS client_name, d.number AS doc_number, d.kind AS doc_kind FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
         LEFT JOIN documents d ON d.id = t.document_id
         WHERE t.done_at IS NULL ORDER BY t.due_date IS NULL, t.due_date, t.id`),
    all(`SELECT t.*, c.name AS client_name, d.number AS doc_number, d.kind AS doc_kind FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
         LEFT JOIN documents d ON d.id = t.document_id
         WHERE t.done_at IS NOT NULL ORDER BY t.done_at DESC LIMIT 20`),
    all('SELECT id, name FROM clients WHERE archived = 0 ORDER BY name COLLATE NOCASE'),
  ]);
  res.render('tasks/list', { title: 'Tasks', open, done, clients, today: today() });
});

router.post('/', async (req, res) => {
  const back = v.safeBack(req.body.back, '/tasks');
  const title = v.str(req.body.title, 200);
  const due = v.str(req.body.due_date, 10);
  const clientId = v.id(req.body.client_id);

  let error = '';
  if (!title) error = 'Task needs a title.';
  else if (due && !isDate(due)) error = 'Due date is not valid.';
  else if (clientId && !(await get('SELECT id FROM clients WHERE id = ?', [clientId]))) error = 'Client not found.';
  if (error) {
    v.flash(req, 'err', error);
    return res.redirect(back);
  }

  await run('INSERT INTO tasks (client_id, title, due_date) VALUES (?, ?, ?)', [clientId, title, due || null]);
  v.flash(req, 'ok', 'Task added.');
  res.redirect(back);
});

router.post('/:id/toggle', async (req, res) => {
  const id = v.id(req.params.id);
  const { changes } = await run(
    "UPDATE tasks SET done_at = CASE WHEN done_at IS NULL THEN datetime('now') ELSE NULL END WHERE id = ?", [id]);
  if (!changes) throw v.notFound('Task not found.');
  res.redirect(v.safeBack(req.body.back, '/tasks'));
});

router.post('/:id/delete', async (req, res) => {
  const { changes } = await run('DELETE FROM tasks WHERE id = ?', [v.id(req.params.id)]);
  if (!changes) throw v.notFound('Task not found.');
  v.flash(req, 'ok', 'Task deleted.');
  res.redirect(v.safeBack(req.body.back, '/tasks'));
});

module.exports = router;
