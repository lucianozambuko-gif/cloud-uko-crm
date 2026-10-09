const express = require('express');
const { get, all, run } = require('../db');
const v = require('../lib/validate');

const router = express.Router();
const STATUSES = ['active', 'paused', 'completed'];

function clientOptions(currentId) {
  return all('SELECT id, name FROM clients WHERE archived = 0 OR id = ? ORDER BY name COLLATE NOCASE', [currentId ?? 0]);
}

async function parseProject(body) {
  const values = {
    client_id: v.id(body.client_id),
    name: v.str(body.name, 120),
    type: v.str(body.type, 60),
    status: v.str(body.status, 20),
    url: v.str(body.url, 200),
    notes: v.text(body.notes),
  };
  const errors = [];
  if (!values.name) errors.push('Project name is required.');
  if (!STATUSES.includes(values.status)) errors.push('Choose a valid status.');
  if (!values.client_id || !(await get('SELECT id FROM clients WHERE id = ?', [values.client_id]))) errors.push('Choose a client.');
  return { values, errors };
}

async function loadProject(req) {
  const id = v.id(req.params.id);
  const project = id && (await get('SELECT * FROM projects WHERE id = ?', [id]));
  if (!project) throw v.notFound('Project not found.');
  return project;
}

router.get('/', async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const projects = await all(
    `SELECT p.*, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id
     WHERE (? = '' OR p.status = ?) ORDER BY p.status, c.name COLLATE NOCASE, p.name COLLATE NOCASE`,
    [status, status]
  );
  res.render('projects/list', { title: 'Projects', projects, status, statuses: STATUSES });
});

router.get('/new', async (req, res) => {
  res.render('projects/form', {
    title: 'New project', action: '/projects', statuses: STATUSES, clients: await clientOptions(),
    project: { client_id: v.id(req.query.client_id), status: 'active' },
  });
});

router.post('/', async (req, res) => {
  const { values, errors } = await parseProject(req.body);
  if (errors.length) {
    return res.status(400).render('projects/form', {
      title: 'New project', action: '/projects', statuses: STATUSES, clients: await clientOptions(values.client_id), project: values, errors,
    });
  }
  await run('INSERT INTO projects (client_id, name, type, status, url, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [values.client_id, values.name, values.type, values.status, values.url, values.notes]);
  v.flash(req, 'ok', 'Project added.');
  res.redirect(`/clients/${values.client_id}`);
});

router.get('/:id/edit', async (req, res) => {
  const project = await loadProject(req);
  res.render('projects/form', {
    title: `Edit ${project.name}`, action: `/projects/${project.id}`, statuses: STATUSES, clients: await clientOptions(project.client_id), project,
  });
});

router.post('/:id', async (req, res) => {
  const project = await loadProject(req);
  const { values, errors } = await parseProject(req.body);
  if (errors.length) {
    return res.status(400).render('projects/form', {
      title: `Edit ${project.name}`, action: `/projects/${project.id}`, statuses: STATUSES, clients: await clientOptions(project.client_id),
      project: { ...values, id: project.id }, errors,
    });
  }
  await run('UPDATE projects SET client_id = ?, name = ?, type = ?, status = ?, url = ?, notes = ? WHERE id = ?',
    [values.client_id, values.name, values.type, values.status, values.url, values.notes, project.id]);
  v.flash(req, 'ok', 'Project saved.');
  res.redirect(`/clients/${values.client_id}`);
});

module.exports = router;
