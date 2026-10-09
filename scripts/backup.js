// Writes a consistent snapshot of the database to data/backups/.
// Usage: npm run backup
const fs = require('fs');
const path = require('path');
const { db, dataDir } = require('../src/db');

async function main() {
  if (process.env.DATABASE_URL) throw new Error('Backup only supports the local database file. Use Turso backups for a remote database.');
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = path.join(dir, `crm-${stamp}.db`);
  await db.execute({ sql: 'VACUUM INTO ?', args: [file.replace(/\\/g, '/')] });
  console.log(`Backup written: ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  console.log('Copy it somewhere off this PC. It contains client personal information, so keep it private.');
}

main().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
