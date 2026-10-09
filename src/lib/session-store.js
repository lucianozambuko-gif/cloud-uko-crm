const session = require('express-session');
const { get, run } = require('../db');

const DEFAULT_TTL = 14 * 24 * 60 * 60 * 1000;

// Keeps sessions in the CRM database so a restart doesn't log you out.
class DbSessionStore extends session.Store {
  get(sid, cb) {
    get('SELECT data, expires FROM sessions WHERE sid = ?', [sid])
      .then((row) => cb(null, row && row.expires > Date.now() ? JSON.parse(row.data) : null))
      .catch(cb);
  }

  set(sid, sess, cb) {
    const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DEFAULT_TTL;
    run(
      'INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires',
      [sid, JSON.stringify(sess), expires]
    ).then(() => cb && cb(null)).catch((err) => cb && cb(err));
  }

  destroy(sid, cb) {
    run('DELETE FROM sessions WHERE sid = ?', [sid]).then(() => cb && cb(null)).catch((err) => cb && cb(err));
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }

  prune() {
    return run('DELETE FROM sessions WHERE expires <= ?', [Date.now()]);
  }
}

module.exports = { DbSessionStore, DEFAULT_TTL };
