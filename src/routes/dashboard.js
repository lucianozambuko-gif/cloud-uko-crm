const express = require('express');
const { get, all } = require('../db');
const { today, addDays } = require('../lib/format');
const { DOC_SELECT } = require('../services/documents');
const { recentActions } = require('../services/automation');

const router = express.Router();

router.get('/', async (req, res) => {
  const t = today();
  const month = t.slice(0, 7);

  const [billed, received, outstanding, tasks, recurring, automation] = await Promise.all([
    get("SELECT COALESCE(SUM(total_cents), 0) AS n FROM documents WHERE kind = 'invoice' AND status = 'sent' AND substr(issue_date, 1, 7) = ?", [month]),
    get('SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE substr(paid_on, 1, 7) = ?', [month]),
    all(`SELECT * FROM (${DOC_SELECT} WHERE d.kind = 'invoice' AND d.status = 'sent') WHERE total_cents > paid_cents ORDER BY due_date, number`),
    all(`SELECT t.*, c.name AS client_name, d.number AS doc_number, d.kind AS doc_kind FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
         LEFT JOIN documents d ON d.id = t.document_id
         WHERE t.done_at IS NULL ORDER BY t.due_date IS NULL, t.due_date, t.id LIMIT 10`),
    all(`SELECT r.*, c.name AS client_name FROM recurring r JOIN clients c ON c.id = r.client_id
         WHERE r.active = 1 AND r.next_date <= ? ORDER BY r.next_date`, [addDays(t, 30)]),
    recentActions(6),
  ]);

  res.render('dashboard', {
    title: 'Dashboard',
    today: t,
    month,
    billed: billed.n,
    received: received.n,
    outstanding,
    outstandingTotal: outstanding.reduce((sum, d) => sum + (d.total_cents - d.paid_cents), 0),
    overdueCount: outstanding.filter((d) => d.due_date < t).length,
    tasks,
    recurring,
    automation,
  });
});

module.exports = router;
