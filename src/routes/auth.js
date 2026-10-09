const express = require('express');
const crypto = require('crypto');
const { get, run } = require('../db');
const { hashPassword, verifyPassword } = require('../lib/password');
const { str } = require('../lib/validate');

const router = express.Router();

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map(); // ip -> { count, until }

function locked(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (f.until && f.until > Date.now()) return true;
  if (f.until) fails.delete(ip);
  return false;
}

function recordFail(ip) {
  const f = fails.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) f.until = Date.now() + LOCK_MS;
  fails.set(ip, f);
}

async function hasUsers() {
  return (await get('SELECT COUNT(*) AS n FROM users')).n > 0;
}

function validatePassword(password, confirm) {
  const errors = [];
  if (password.length < 10) errors.push('Password must be at least 10 characters.');
  if (password.length > 200) errors.push('Password is too long.');
  if (password !== confirm) errors.push('The two passwords do not match.');
  return errors;
}

// New session id on login so a pre-login cookie can't be reused.
function signIn(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      req.session.save((err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

// First run: no account exists yet, so the only page available is /setup.
router.use(async (req, res, next) => {
  if (req.path !== '/setup' && !(await hasUsers())) return res.redirect('/setup');
  next();
});

router.get('/setup', async (req, res) => {
  if (await hasUsers()) return res.redirect('/login');
  res.render('setup', { title: 'Create your login', username: '' });
});

router.post('/setup', async (req, res) => {
  if (await hasUsers()) return res.redirect('/login');
  const username = str(req.body.username, 40);
  const password = String(req.body.password ?? '');
  const errors = validatePassword(password, String(req.body.confirm ?? ''));
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) errors.unshift('Username must be 3-40 letters, numbers, dots, dashes or underscores.');
  if (errors.length) return res.status(400).render('setup', { title: 'Create your login', username, errors });

  const { id } = await run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, await hashPassword(password)]);
  await signIn(req, id);
  res.redirect('/');
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { title: 'Sign in', username: '' });
});

router.post('/login', async (req, res) => {
  const username = str(req.body.username, 40);
  if (locked(req.ip)) {
    return res.status(429).render('login', { title: 'Sign in', username, errors: ['Too many failed attempts. Try again in 15 minutes.'] });
  }
  const user = await get('SELECT id, password_hash FROM users WHERE username = ?', [username]);
  const ok = user ? await verifyPassword(String(req.body.password ?? ''), user.password_hash) : false;
  if (!ok) {
    recordFail(req.ip);
    return res.status(401).render('login', { title: 'Sign in', username, errors: ['Wrong username or password.'] });
  }
  fails.delete(req.ip);
  await signIn(req, user.id);
  res.redirect('/');
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('crm.sid');
    res.redirect('/login');
  });
});

module.exports = { router, validatePassword };
