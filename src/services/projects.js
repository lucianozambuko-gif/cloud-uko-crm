const { db, get, all, run } = require('../db');
const pj = require('../lib/projects');

// Project rows with the client and checklist counts that the progress bar needs.
const PROJECT_SELECT = `
  SELECT p.*, c.name AS client_name, c.phone AS client_phone,
    (SELECT COUNT(*) FROM project_steps s WHERE s.project_id = p.id) AS steps_total,
    (SELECT COUNT(*) FROM project_steps s WHERE s.project_id = p.id AND s.done_at IS NOT NULL) AS steps_done
  FROM projects p
  JOIN clients c ON c.id = p.client_id`;

function getSteps(projectId) {
  return all('SELECT * FROM project_steps WHERE project_id = ? ORDER BY position, id', [projectId]);
}

// Adds the standard checklist from Settings. Steps for stages the project has already passed
// are ticked, so a project added part-way through does not start at 0%.
async function addStandardChecklist(project, settings) {
  const { steps } = pj.parseChecklist(settings.project_checklist);
  if (!steps.length) return 0;
  const current = pj.stageIndex(project.stage);
  const last = await get('SELECT COALESCE(MAX(position), -1) AS n FROM project_steps WHERE project_id = ?', [project.id]);
  await db.batch(
    steps.map((s, i) => ({
      sql: `INSERT INTO project_steps (project_id, stage, title, position, done_at)
            VALUES (?, ?, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END)`,
      args: [project.id, s.stage, s.title, last.n + 1 + i, pj.stageIndex(s.stage) < current ? 1 : 0],
    })),
    'write'
  );
  return steps.length;
}

async function setStage(projectId, stage) {
  await run("UPDATE projects SET stage = ?, stage_changed_at = datetime('now') WHERE id = ?", [stage, projectId]);
}

module.exports = { PROJECT_SELECT, getSteps, addStandardChecklist, setStage };
