const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { dataDir } = require('./db');
const { money, fmtDate } = require('./lib/format');

const MARGIN = 50;
const PAGE_BOTTOM = 780;
const NAVY = '#293A4A';
const GREY = '#667085';
const LINE = '#D0D5DD';

// The built-in PDF fonts only cover Latin characters, so drop emoji and the like.
function safe(s) {
  return String(s ?? '').replace(/[^\x0A\x20-\x7E\xA0-\xFF–—‘’“”]/g, '').trim();
}

function findLogo() {
  for (const name of ['logo.png', 'logo.jpg', 'logo.jpeg']) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function renderPdf(stream, { doc, items, payments, client, settings }) {
  const isInvoice = doc.kind === 'invoice';
  const hasVat = doc.vat_rate > 0;
  const heading = isInvoice ? (hasVat ? 'TAX INVOICE' : 'INVOICE') : 'QUOTE';

  const pdf = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: `${heading} ${doc.number}` } });
  pdf.pipe(stream);
  const right = pdf.page.width - MARGIN;
  const width = right - MARGIN;

  // Business block (left) and document block (right)
  let y = MARGIN;
  const logo = findLogo();
  if (logo) {
    try {
      pdf.image(logo, MARGIN, y, { fit: [150, 60] });
      y += 68;
    } catch (err) {
      console.error('Could not add logo to PDF:', err.message);
    }
  }
  pdf.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text(safe(settings.business_name), MARGIN, y, { width: 280 });
  pdf.font('Helvetica').fontSize(9).fillColor(GREY);
  const business = [
    settings.business_address,
    settings.business_phone,
    settings.business_email,
    settings.business_website,
    settings.business_reg_number && `Reg no: ${settings.business_reg_number}`,
    hasVat && settings.vat_number && `VAT no: ${settings.vat_number}`,
  ].filter(Boolean).map(safe).join('\n');
  if (business) pdf.text(business, MARGIN, pdf.y + 3, { width: 280 });
  const leftBottom = pdf.y;

  pdf.font('Helvetica-Bold').fontSize(20).fillColor(NAVY).text(heading, MARGIN, MARGIN, { width, align: 'right' });
  pdf.font('Helvetica').fontSize(10).fillColor('#000');
  const meta = [
    ['Number', doc.number],
    ['Date', fmtDate(doc.issue_date)],
    [isInvoice ? 'Due' : 'Valid until', fmtDate(doc.due_date)],
  ];
  let metaY = MARGIN + 30;
  for (const [k, val] of meta) {
    pdf.fillColor(GREY).text(k, right - 220, metaY, { width: 100, align: 'right' });
    pdf.fillColor('#000').text(safe(val), right - 110, metaY, { width: 110, align: 'right' });
    metaY += 15;
  }

  // Client block
  y = Math.max(leftBottom, metaY) + 22;
  pdf.font('Helvetica-Bold').fontSize(9).fillColor(GREY).text(isInvoice ? 'BILL TO' : 'QUOTE FOR', MARGIN, y);
  pdf.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(safe(client.company || client.name), MARGIN, pdf.y + 3);
  pdf.font('Helvetica').fontSize(9).fillColor(GREY);
  const clientLines = [
    client.company && client.name,
    client.address,
    client.phone,
    client.email,
    client.vat_number && `VAT no: ${client.vat_number}`,
    doc.project_name && `Project: ${doc.project_name}`,
  ].filter(Boolean).map(safe).join('\n');
  if (clientLines) pdf.text(clientLines, MARGIN, pdf.y + 2, { width: 300 });

  // Line items
  const col = { desc: MARGIN, qty: 330, unit: 385, amount: 465 };
  const descWidth = col.qty - col.desc - 10;
  const tableHeader = (top) => {
    pdf.rect(MARGIN, top, width, 20).fill(NAVY);
    pdf.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
    pdf.text('Description', col.desc + 6, top + 6);
    pdf.text('Qty', col.qty, top + 6, { width: 45, align: 'right' });
    pdf.text('Unit price', col.unit, top + 6, { width: 70, align: 'right' });
    pdf.text('Amount', col.amount, top + 6, { width: right - col.amount - 6, align: 'right' });
    pdf.font('Helvetica').fontSize(10).fillColor('#000');
    return top + 28;
  };

  y = tableHeader(pdf.y + 22);
  for (const it of items) {
    const description = safe(it.description);
    const h = pdf.heightOfString(description, { width: descWidth });
    if (y + h > PAGE_BOTTOM - 40) {
      pdf.addPage();
      y = tableHeader(MARGIN);
    }
    pdf.text(description, col.desc + 6, y, { width: descWidth });
    pdf.text(String(it.quantity), col.qty, y, { width: 45, align: 'right' });
    pdf.text(money(it.unit_cents), col.unit, y, { width: 70, align: 'right' });
    pdf.text(money(it.line_cents), col.amount, y, { width: right - col.amount - 6, align: 'right' });
    y += h + 8;
    pdf.moveTo(MARGIN, y - 4).lineTo(right, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  // Totals
  const paid = Number(doc.paid_cents) || 0;
  const totals = [];
  if (hasVat) {
    totals.push(['Subtotal', money(doc.subtotal_cents)]);
    totals.push([`VAT (${doc.vat_rate}%)`, money(doc.vat_cents)]);
  }
  totals.push(['Total', money(doc.total_cents), true]);
  if (isInvoice && paid > 0) {
    totals.push(['Paid', money(-paid)]);
    totals.push(['Balance due', money(doc.total_cents - paid), true]);
  }
  if (y + totals.length * 18 > PAGE_BOTTOM) {
    pdf.addPage();
    y = MARGIN;
  }
  y += 6;
  for (const [k, val, bold] of totals) {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor('#000');
    pdf.text(k, col.unit - 60, y, { width: 130, align: 'right' });
    pdf.text(val, col.amount, y, { width: right - col.amount - 6, align: 'right' });
    y += 18;
  }

  // Payments received, banking details, notes and footer
  const sections = [];
  if (isInvoice && payments.length) {
    sections.push(['Payments received', payments.map((p) =>
      `${fmtDate(p.paid_on)}  ${money(p.amount_cents)}  ${p.method}${p.reference ? ` (${p.reference})` : ''}`).join('\n')]);
  }
  if (isInvoice && settings.bank_details) sections.push(['Banking details', settings.bank_details]);
  if (doc.notes) sections.push(['Notes', doc.notes]);
  if (settings.document_footer) sections.push(['', settings.document_footer]);

  y += 14;
  for (const [title, body] of sections) {
    const text = safe(body);
    pdf.font('Helvetica').fontSize(9);
    if (y + pdf.heightOfString(text, { width }) + 16 > PAGE_BOTTOM) {
      pdf.addPage();
      y = MARGIN;
    }
    if (title) {
      pdf.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(title.toUpperCase(), MARGIN, y);
      y = pdf.y + 2;
    }
    pdf.font('Helvetica').fontSize(9).fillColor('#000').text(text, MARGIN, y, { width });
    y = pdf.y + 12;
  }

  pdf.end();
}

module.exports = { renderPdf };
