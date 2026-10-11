// Project life cycle: the stages a project moves through, in order.
const STAGES = [
  { key: 'planning', label: 'Planning' },
  { key: 'building', label: 'Building' },
  { key: 'demo', label: 'Demo ready' },
  { key: 'review', label: 'Client review' },
  { key: 'final', label: 'Final changes' },
  { key: 'live', label: 'Live' },
];
const STAGE_KEYS = STAGES.map((s) => s.key);
const STATES = ['open', 'paused', 'cancelled'];

const DEFAULT_CHECKLIST = [
  'Planning: Requirements agreed with the client',
  'Planning: Quote accepted',
  'Planning: Deposit received',
  'Building: Project and repository set up',
  'Building: Main pages and features built',
  'Building: Content and images received from the client',
  'Demo ready: Demo site deployed',
  'Demo ready: Demo link sent to the client',
  'Client review: Client feedback received',
  'Client review: Client approved the demo',
  'Final changes: Requested changes done',
  'Final changes: Domain bought and connected',
  'Final changes: Tested on phone and desktop',
  'Live: Production site deployed',
  'Live: Final invoice sent',
  'Live: Hosting billing set up',
  'Live: Handover done (logins and how-to)',
].join('\n');

function stageLabel(key) {
  return STAGES.find((s) => s.key === key)?.label || key;
}

function stageIndex(key) {
  return Math.max(0, STAGE_KEYS.indexOf(key));
}

function nextStage(key) {
  return STAGES[stageIndex(key) + 1] || null;
}

// Template text is one step per line, "Stage name: step". Returns { steps, errors }.
function parseChecklist(text) {
  const steps = [];
  const errors = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const cut = line.indexOf(':');
    const name = cut === -1 ? '' : line.slice(0, cut).trim().toLowerCase();
    const title = cut === -1 ? '' : line.slice(cut + 1).trim().slice(0, 200);
    const stage = STAGES.find((s) => s.label.toLowerCase() === name || s.key === name);
    if (!stage || !title) {
      errors.push(`Checklist line "${line.slice(0, 60)}" must look like "Stage name: step", using one of: ${STAGES.map((s) => s.label).join(', ')}.`);
      continue;
    }
    steps.push({ stage: stage.key, title });
  }
  return { steps, errors };
}

// With a checklist, progress is the share of steps ticked. Without one, it follows the stage.
function progress(project) {
  const total = Number(project.steps_total) || 0;
  if (total > 0) return Math.round(((Number(project.steps_done) || 0) / total) * 100);
  return Math.round((stageIndex(project.stage) / (STAGES.length - 1)) * 100);
}

// Accepts "example.com/path" or a full http(s) address. Anything else is rejected.
function isSiteLink(value) {
  return /^(https?:\/\/)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?(\/[^\s<>"']*)?$/i.test(value);
}

// Safe value for an href: always an http(s) address.
function href(value) {
  const v = String(value ?? '').trim();
  if (!v || !isSiteLink(v)) return '';
  return /^https?:\/\//i.test(v) ? v : 'https://' + v;
}

module.exports = {
  STAGES, STAGE_KEYS, STATES, DEFAULT_CHECKLIST,
  stageLabel, stageIndex, nextStage, parseChecklist, progress, isSiteLink, href,
};
