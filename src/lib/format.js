const TZ = 'Africa/Johannesburg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Dates are stored and passed around as ISO yyyy-mm-dd strings.
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00Z') - new Date(fromIso + 'T00:00:00Z')) / 86400000);
}

// Clamps to the last day of the target month (31 Jan + 1 month = 28/29 Feb).
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

function addInterval(iso, interval) {
  return addMonths(iso, interval === 'yearly' ? 12 : 1);
}

function fmtDate(iso) {
  if (!isDate(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

// Timestamp (ISO, UTC) shown in South African time, e.g. "10 Oct 2026, 15:15".
function fmtDateTime(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${fmtDate(date)}, ${time}`;
}

function fmtMonth(iso) {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function money(cents) {
  const n = Number(cents) || 0;
  const s = (Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-R' : 'R') + s;
}

function moneyInput(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2);
}

// Accepts "1700", "1 700.50", "R1,700.50" and "1700,50". Returns cents, or null if invalid.
function parseMoney(v) {
  const s = String(v ?? '')
    .replace(/[R\s]/gi, '')
    .replace(/,(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

// Display state for a document row that carries paid_cents.
function docState(doc) {
  if (doc.kind === 'quote') {
    return { label: doc.status.charAt(0).toUpperCase() + doc.status.slice(1), cls: doc.status };
  }
  if (doc.status === 'void') return { label: 'Void', cls: 'void' };
  if (doc.status === 'draft') return { label: 'Draft', cls: 'draft' };
  const paid = Number(doc.paid_cents) || 0;
  if (paid >= doc.total_cents) return { label: 'Paid', cls: 'paid' };
  const overdue = doc.due_date < today();
  if (paid > 0) return { label: overdue ? 'Part-paid, overdue' : 'Part-paid', cls: overdue ? 'overdue' : 'part' };
  return overdue ? { label: 'Overdue', cls: 'overdue' } : { label: 'Sent', cls: 'sent' };
}

module.exports = {
  today, isDate, addDays, daysBetween, addMonths, addInterval, fmtDate, fmtDateTime, fmtMonth,
  money, moneyInput, parseMoney, docState,
};
