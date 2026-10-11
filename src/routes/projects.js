const express = require('express');
const { db, get, all, run } = require('../db');
const v = require('../lib/validate');
const pj = require('../lib/projects');
const wa = require('../lib/whatsapp');
const { today, isDate } = require('../lib/format');
const { DOC_SELECT } = require('../services/documents');
const { PROJECT_SELECT, getSteps, addStandardChecklist, setStage } = require('../services/projects');
const { closeResolvedTasks, projectWentLive } = require('../services/automation');

const router = express.Router();
const VIEWS = { all: 'All', progress: 'In progress', live: 'Live', closed: 'Paused or cancelled' };

function clientOptions(currentId) {
  return all('SELECT id, name FROM clients WHERE archived = 0 OR id = ? ORDER BY name COLLATE NOCASE', [currentId ?? 0]);
}

async function parseProject(body) {
  const values = {
    client_id: v.id(body.client_id),
    name: v.str(body.name, 120),
    type: v.str(body.type, 60),
    stage: v.str(body.stage, 20),
    state: v.str(body.state, 20),
    demo_url: v.str(body.demo_url, 200),
    url: v.str(body.url, 200),
    start_date: v.str(body.start_date, 10),
    target_date: v.str(body.target_date, 10),
    notes: v.text(body.notes),
  };
  const errors = [];
  if (!values.name) errors.push('Project name is required.');
  if (!pj.STAGE_KEYS.includes(values.stage)) errors.push('Choose a stage.');
  if (!pj.STATES.includes(values.state)) errors.push('Choose whether the project is open, paused or cancelled.');
  if (!values.client_id || !(await get('SELECT id FROM clients WHERE id = ?', [values.client_id]))) errors.push('Choose a client.');
  if (values.demo_url && !pj.isSiteLink(values.demo_url)) errors.push('Demo link is not a valid web address.');
  if (values.url && !pj.isSiteLink(values.url)) errors.push('Live link is not a valid web address.');
  if (values.start_date && !isDate(values.start_date)) errors.push('Start date is not valid.');
  if (values.target_date && !isDate(values.target_date)) errors.push('Target date is not valid.');
  if (isDate(values.start_date) && isDate(values.target_date) && values.target_date < values.start_date) errors.push('Target date cannot be before the start date.');
  return { values, errors };
}

async function loadProject(req) {
  const id = v.id(req.params.id);
  const project = id && (await get(`${PROJECT_SELECT} WHERE p.id = ?`, [id]));
  if (!project) throw v.notFound('Project not found.');
  return project;
}

async function renderForm(res, { title, action, project, errors, status, isNew }) {
  res.status(status || 200).render('projects/form', {
    title, action, project, isNew: Boolean(isNew), errors: errors || [],
    stages: pj.STAGES, states: pj.STATES, clients: await clientOptions(project.client_id),
  });
}

router.get('/', async (req, res) => {
  const view = Object.hasOwn(VIEWS, req.query.view) ? req.query.view : 'all';
  const where = {
    all: '1 = 1',
    progress: "p.state = 'open' AND p.stage != 'live'",
    live: "p.state = 'open' AND p.stage = 'live'",
    closed: "p.state != 'open'",
  }[view];
  const projects = await all(`${PROJECT_SELECT} WHERE ${where} ORDER BY c.name COLLATE NOCASE, p.name COLLATE NOCASE`);
  // Furthest-along first within "in progress", so what is closest to done is on top.
  projects.sort((a, b) => (a.state !== b.state ? (a.state === 'open' ? -1 : 1) : pj.stageIndex(b.stage) - pj.stageIndex(a.stage)));
  res.render('projects/list', { title: 'Projects', projects, view, views: VIEWS });
});

router.get('/new', async (req, res) => {
  await renderForm(res, {
    title: 'New project', action: '/projects', isNew: true,
    project: { client_id: v.id(req.query.client_id), stage: 'planning', state: 'open', start_date: today() },
  });
});

router.post('/', async (req, res) => {
  const { values, errors } = await parseProject(req.body);
  if (errors.length) return renderForm(res, { title: 'New project', action: '/projects', project: values, errors, status: 400, isNew: true });
  const { id } = await run(
    `INSERT INTO projects (client_id, name, type, stage, state, demo_url, url, start_date, target_date, notes, stage_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [values.client_id, values.name, values.type, values.stage, values.state, values.demo_url, values.url,
      values.start_date || null, values.target_date || null, values.notes]
  );
  if (req.body.checklist === '1') await addStandardChecklist({ id, stage: values.stage }, res.locals.settings);
  if (values.stage === 'live') await projectWentLive(await get(`${PROJECT_SELECT} WHERE p.id = ?`, [id]));
  v.flash(req, 'ok', 'Project added.');
  res.redirect(`/projects/${id}`);
});

router.get('/:id', async (req, res) => {
  const project = await loadProject(req);
  const [steps, documents, tasks, recurring] = await Promise.all([
    getSteps(project.id),
    all(`${DOC_SELECT} WHERE d.project_id = ? ORDER BY d.issue_date DESC, d.number DESC`, [project.id]),
    all('SELECT * FROM tasks WHERE project_id = ? AND done_at IS NULL ORDER BY due_date IS NULL, due_date, id', [project.id]),
    all('SELECT * FROM recurring WHERE project_id = ? ORDER BY active DESC, next_date', [project.id]),
  ]);
  const current = steps.filter((s) => s.stage === project.stage);
  res.render('projects/show', {
    title: project.name, project, steps, documents, tasks, recurring, today: today(),
    stages: pj.STAGES,
    next: pj.nextStage(project.stage),
    stageDone: current.length > 0 && current.every((s) => s.done_at),
    whatsapp: wa.projectButtons({ project, settings: res.locals.settings }),
  });
});

router.get('/:id/edit', async (req, res) => {
  const project = await loadProject(req);
  await renderForm(res, { title: `Edit ${project.name}`, action: `/projects/${project.id}`, project });
});

router.post('/:id', async (req, res) => {
  const project = await loadProject(req);
  const { values, errors } = await parseProject(req.body);
  if (errors.length) {
    return renderForm(res, {
      title: `Edit ${project.name}`, action: `/projects/${project.id}`, project: { ...values, id: project.id }, errors, status: 400,
    });
  }
  await run(
    `UPDATE projects SET client_id = ?, name = ?, type = ?, state = ?, demo_url = ?, url = ?, start_date = ?, target_date = ?, notes = ?
     WHERE id = ?`,
    [values.client_id, values.name, values.type, values.state, values.demo_url, values.url,
      values.start_date || null, values.target_date || null, values.notes, project.id]
  );
  if (values.stage !== project.stage) {
    await setStage(project.id, values.stage);
    if (values.stage === 'live') await projectWentLive({ ...project, ...values });
  }
  await closeResolvedTasks();
  v.flash(req, 'ok', 'Project saved.');
  res.redirect(`/projects/${project.id}`);
});

router.post('/:id/stage', async (req, res) => {
  const project = await loadProject(req);
  const stage = v.str(req.body.stage, 20);
  if (!pj.STAGE_KEYS.includes(stage)) throw Object.assign(new Error('Unknown stage.'), { status: 400 });
  if (stage !== project.stage) {
    await setStage(project.id, stage);
    if (stage === 'live') await projectWentLive(project);
    await closeResolvedTasks();
    v.flash(req, 'ok', `${project.name} moved to ${pj.stageLabel(stage)}.`);
  }
  res.redirect(`/projects/${project.id}`);
});

router.post('/:id/steps', async (req, res) => {
  const project = await loadProject(req);
  const title = v.str(req.body.title, 200);
  const stage = v.str(req.body.stage, 20);
  if (!title || !pj.STAGE_KEYS.includes(stage)) {
    v.flash(req, 'err', 'A step needs a description and a stage.');
    return res.redirect(`/projects/${project.id}`);
  }
  const last = await get('SELECT COALESCE(MAX(position), -1) AS n FROM project_steps WHERE project_id = ?', [project.id]);
  await run('INSERT INTO project_steps (project_id, stage, title, position) VALUES (?, ?, ?, ?)', [project.id, stage, title, last.n + 1]);
  res.redirect(`/projects/${project.id}`);
});

router.post('/:id/steps/standard', async (req, res) => {
  const project = await loadProject(req);
  if (project.steps_total > 0) {
    v.flash(req, 'err', 'This project already has a checklist.');
  } else {
    const added = await addStandardChecklist(project, res.locals.settings);
    v.flash(req, added ? 'ok' : 'err', added ? `Standard checklist added (${added} steps).` : 'The standard checklist in Settings is empty.');
  }
  res.redirect(`/projects/${project.id}`);
});

router.post('/:id/steps/:stepId/toggle', async (req, res) => {
  const project = await loadProject(req);
  const { changes } = await run(
    "UPDATE project_steps SET done_at = CASE WHEN done_at IS NULL THEN datetime('now') ELSE NULL END WHERE id = ? AND project_id = ?",
    [v.id(req.params.stepId), project.id]);
  if (!changes) throw v.notFound('Step not found.');

  // Nudge to move on once everything for the current stage is ticked.
  const left = await get('SELECT COUNT(*) AS total, SUM(done_at IS NULL) AS open FROM project_steps WHERE project_id = ? AND stage = ?', [project.id, project.stage]);
  const next = pj.nextStage(project.stage);
  if (left.total > 0 && !left.open && next) {
    v.flash(req, 'ok', `All ${pj.stageLabel(project.stage)} steps are ticked. Move the project to ${next.label} when you are ready.`);
  }
  res.redirect(`/projects/${project.id}`);
});

router.post('/:id/steps/:stepId/delete', async (req, res) => {
  const project = await loadProject(req);
  const { changes } = await run('DELETE FROM project_steps WHERE id = ? AND project_id = ?', [v.id(req.params.stepId), project.id]);
  if (!changes) throw v.notFound('Step not found.');
  res.redirect(`/projects/${project.id}`);
});

module.exports = router;
