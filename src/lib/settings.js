const { db, all } = require('../db');

const DEFAULTS = {
  business_name: 'Cloud Uko',
  business_address: '',
  business_email: '',
  business_phone: '',
  business_website: 'clouduko.co.za',
  business_reg_number: '',
  vat_registered: '0',
  vat_number: '',
  vat_rate: '15',
  invoice_prefix: 'CU-INV',
  quote_prefix: 'CU-QUO',
  payment_terms_days: '7',
  quote_valid_days: '30',
  bank_details: '',
  document_footer: '',
};

async function loadSettings() {
  const rows = await all('SELECT key, value FROM settings');
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

async function saveSettings(values) {
  const stmts = Object.entries(values)
    .filter(([key]) => key in DEFAULTS)
    .map(([key, value]) => ({
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      args: [key, String(value)],
    }));
  if (stmts.length) await db.batch(stmts, 'write');
}

function currentVatRate(settings) {
  return settings.vat_registered === '1' ? Number(settings.vat_rate) || 0 : 0;
}

module.exports = { DEFAULTS, loadSettings, saveSettings, currentVatRate };
