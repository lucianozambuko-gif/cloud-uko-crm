const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const { migrate, get, dataDir } = require('./db');
const { loadSettings } = require('./lib/settings');
const { DbSessionStore, DEFAULT_TTL } = require('./lib/session-store');
const fmt = require('./lib/format');
const whatsapp = require('./lib/whatsapp');
const { runAutomation } = require('./services/automation');
const auth = require('./routes/auth');

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, '.session-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function main() {
  await migrate();

  const app = express();
  const store = new DbSessionStore();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.disable('x-powered-by');
  // "tailscale serve" proxies HTTPS to this server from the same machine. Trusting only loopback proxies
  // keeps the real client address for the login lockout without letting outside requests fake one.
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
    });
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: true, limit: '200kb' }));
  app.use(session({
    name: 'crm.sid',
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: DEFAULT_TTL },
  }));

  // View locals, flash messages and CSRF protection for every form post.
  app.use(async (req, res, next) => {
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
    res.locals.csrf = req.session.csrf;
    res.locals.f = fmt;
    res.locals.wa = whatsapp;
    res.locals.path = req.path;
    res.locals.user = null;
    res.locals.errors = [];
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.settings = await loadSettings();

    if (req.method !== 'GET' && req.method !== 'HEAD' && !tokensMatch(req.body?._csrf, req.session.csrf)) {
      return res.status(403).render('error', {
        title: 'Form expired',
        message: 'This form has expired. Go back, refresh the page and try again.',
      });
    }
    next();
  });

  app.use(auth.router);

  app.use(async (req, res, next) => {
    const user = req.session.userId ? await get('SELECT id, username FROM users WHERE id = ?', [req.session.userId]) : null;
    if (!user) return res.redirect('/login');
    req.user = user;
    res.locals.user = user;
    next();
  });

  app.use('/', require('./routes/dashboard'));
  app.use('/clients', require('./routes/clients'));
  app.use('/projects', require('./routes/projects'));
  app.use('/tasks', require('./routes/tasks'));
  app.use('/quotes', require('./routes/documents')('quote'));
  app.use('/invoices', require('./routes/documents')('invoice'));
  app.use('/recurring', require('./routes/recurring'));
  app.use('/settings', require('./routes/settings'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(status).render('error', {
      title: status === 404 ? 'Not found' : 'Something went wrong',
      message: status >= 500 ? 'The CRM hit an error. Details are in the server window.' : err.message,
    });
  });

  await store.prune();
  setInterval(() => store.prune().catch((err) => console.error('Session prune failed', err)), 6 * 60 * 60 * 1000).unref();

  // Automation runs at startup (to catch up on anything missed while the PC was off) and then every hour.
  const automate = () => runAutomation()
    .then(({ actions }) => { for (const a of actions) console.log('[automation] ' + a); })
    .catch((err) => console.error('[automation] failed:', err));
  setInterval(automate, 60 * 60 * 1000).unref();

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  // Express 5 also calls this callback with the error when listening fails.
  app.listen(port, host, (err) => {
    if (err) {
      console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT in .env or close the other program.` : err);
      process.exit(1);
    }
    // Lets scripts/stop.ps1 find this server when it runs without a window.
    fs.writeFileSync(path.join(dataDir, 'crm.pid'), String(process.pid));
    console.log(`Cloud Uko CRM running: http://localhost:${port}`);
    automate();
    if (host === '0.0.0.0') {
      for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
          if (a.family === 'IPv4' && !a.internal) console.log(`  ${name}: http://${a.address}:${port}`);
        }
      }
    }
  });
}

main().catch((err) => {
  console.error('Failed to start the CRM:', err);
  process.exit(1);
});
