function str(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

function text(v, max = 4000) {
  return String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function id(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function list(v) {
  return [].concat(v ?? []);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Only allow redirects back to our own pages.
function safeBack(v, fallback) {
  return typeof v === 'string' && /^\/(?!\/)/.test(v) && !v.includes('\\') ? v : fallback;
}

function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

function notFound(msg = 'Not found') {
  const err = new Error(msg);
  err.status = 404;
  return err;
}

module.exports = { str, text, id, list, isEmail, safeBack, flash, notFound };
