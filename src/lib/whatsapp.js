const { money, fmtDate } = require('./format');
const { href: projectHref } = require('./projects');

// wa.me needs the full international number without "+". Local 0... numbers are assumed to be South African.
function number(phone) {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  return digits.startsWith('0') ? '27' + digits.slice(1) : digits;
}

function link(phone, text) {
  const n = number(phone);
  if (!n) return null;
  return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}

function fill(template, vars) {
  return String(template)
    .replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// type: invoice | reminder | receipt | quote
function documentMessage(type, { doc, client, settings }) {
  return fill(settings[`wa_${type}`], {
    name: client.name,
    number: doc.number,
    total: money(doc.total_cents),
    outstanding: money(doc.total_cents - (Number(doc.paid_cents) || 0)),
    date: fmtDate(doc.issue_date),
    due: fmtDate(doc.due_date),
    business: settings.business_name,
    bank: settings.bank_details ? `Banking details:\n${settings.bank_details}` : '',
  });
}

// The ready-to-send buttons that make sense for a document in its current state.
function documentButtons({ doc, client, settings }) {
  let types = [];
  if (doc.kind === 'quote') {
    if (doc.status !== 'declined') types = [['quote', 'WhatsApp quote']];
  } else if (doc.status === 'sent') {
    types = doc.paid_cents >= doc.total_cents
      ? [['receipt', 'WhatsApp thank-you']]
      : [['invoice', 'WhatsApp invoice'], ['reminder', 'WhatsApp reminder']];
  }
  return types.map(([type, label]) => ({
    type,
    label,
    href: link(client.phone, documentMessage(type, { doc, client, settings })),
  }));
}

// Buttons for a project: send the demo link while it is being reviewed, the live link once it is live.
// project needs client_name and client_phone (PROJECT_SELECT provides them).
function projectButtons({ project, settings }) {
  const options = [];
  const demo = projectHref(project.demo_url);
  const live = projectHref(project.url);
  if (demo && project.stage !== 'live') options.push(['demo', 'WhatsApp demo link', demo]);
  if (live && project.stage === 'live') options.push(['live', 'WhatsApp live link', live]);
  return options.map(([type, label, url]) => ({
    type,
    label,
    href: link(project.client_phone, fill(settings[`wa_${type}`], {
      name: project.client_name,
      project: project.name,
      link: url,
      business: settings.business_name,
    })),
  }));
}

module.exports = { number, link, fill, documentMessage, documentButtons, projectButtons };
