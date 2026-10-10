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

  // Automation
  auto_invoice_mode: 'draft', // off | draft | sent
  renewal_reminder_days: '30', // 0 = off
  overdue_followup_days: '7', // repeat interval; 0 = off
  quote_followup_days: '7', // 0 = off

  // WhatsApp message templates. Placeholders: {name} {number} {total} {outstanding} {date} {due} {business} {bank}
  wa_invoice: 'Hi {name}, here is invoice {number} from {business} for {total}, due {due}.\n\n{bank}\n\nPlease use {number} as your payment reference. Thank you.',
  wa_reminder: 'Hi {name}, a friendly reminder that {outstanding} is still outstanding on invoice {number} (due {due}).\n\n{bank}\n\nPlease use {number} as your payment reference. Thank you.',
  wa_receipt: 'Hi {name}, thank you. We have received your payment and invoice {number} is now paid in full.',
  wa_quote: 'Hi {name}, here is quote {number} from {business} for {total}, valid until {due}. Let me know if you would like to go ahead or have any questions.',
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
