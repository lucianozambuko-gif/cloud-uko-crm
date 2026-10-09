const express = require('express');
const { get, run } = require('../db');
const v = require('../lib/validate');
const { saveSettings } = require('../lib/settings');
const { hashPassword, verifyPassword } = require('../lib/password');
const { validatePassword } = require('./auth');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('settings', { title: 'Settings', values: res.locals.settings });
});

router.post('/', async (req, res) => {
  const b = req.body;
  const values = {
    business_name: v.str(b.business_name, 120),
    business_address: v.text(b.business_address, 500),
    business_email: v.str(b.business_email, 160),
    business_phone: v.str(b.business_phone, 40),
    business_website: v.str(b.business_website, 160),
    business_reg_number: v.str(b.business_reg_number, 40),
    vat_registered: b.vat_registered === '1' ? '1' : '0',
    vat_number: v.str(b.vat_number, 30),
    vat_rate: v.str(b.vat_rate, 6).replace(',', '.'),
    invoice_prefix: v.str(b.invoice_prefix, 12).toUpperCase(),
    quote_prefix: v.str(b.quote_prefix, 12).toUpperCase(),
    payment_terms_days: v.str(b.payment_terms_days, 4),
    quote_valid_days: v.str(b.quote_valid_days, 4),
    bank_details: v.text(b.bank_details, 1000),
    document_footer: v.text(b.document_footer, 1000),
  };

  const errors = [];
  const rate = Number(values.vat_rate);
  if (!values.business_name) errors.push('Business name is required.');
  if (values.business_email && !v.isEmail(values.business_email)) errors.push('Email address is not valid.');
  if (values.vat_rate === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) errors.push('VAT rate must be between 0 and 100.');
  if (values.vat_registered === '1' && !values.vat_number) errors.push('Enter your VAT number, or untick VAT registered.');
  for (const key of ['invoice_prefix', 'quote_prefix']) {
    if (!/^[A-Z0-9-]{1,12}$/.test(values[key])) errors.push('Number prefixes can only contain letters, numbers and dashes.');
  }
  if (values.invoice_prefix === values.quote_prefix) errors.push('Invoice and quote prefixes must be different.');
  for (const key of ['payment_terms_days', 'quote_valid_days']) {
    if (!/^\d{1,3}$/.test(values[key])) errors.push('Payment terms and quote validity must be a number of days.');
  }
  if (errors.length) return res.status(400).render('settings', { title: 'Settings', values, errors: [...new Set(errors)] });

  await saveSettings(values);
  v.flash(req, 'ok', 'Settings saved.');
  res.redirect('/settings');
});

router.post('/password', async (req, res) => {
  const user = await get('SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]);
  const password = String(req.body.password ?? '');
  const errors = validatePassword(password, String(req.body.confirm ?? ''));
  if (!(await verifyPassword(String(req.body.current ?? ''), user.password_hash))) errors.unshift('Current password is wrong.');
  if (errors.length) {
    v.flash(req, 'err', errors.join(' '));
    return res.redirect('/settings');
  }
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), user.id]);
  // Sign out every other device.
  await run('DELETE FROM sessions WHERE sid != ?', [req.sessionID]);
  v.flash(req, 'ok', 'Password changed.');
  res.redirect('/settings');
});

module.exports = router;
