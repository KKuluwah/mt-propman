import PDFDocument from 'pdfkit';

const TIN = '501247788';

function fmtD(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-PG', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Returns a Buffer containing the PDF
export async function generateInvoicePDF(inv, s) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const navy = '#0d2137';
    const gold = '#c8922a';
    const muted = '#666666';
    const pageW = doc.page.width - 100; // usable width

    // ── Header bar ────────────────────────────────────────────────────────────
    doc.rect(50, 50, pageW, 70).fill(navy);

    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
      .text('MT', 65, 68, { width: 36, align: 'center' });
    doc.rect(65, 68, 36, 36).stroke('#c8922a');

    doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold')
      .text(s.company_name || 'Mayemou Trading', 115, 65);
    doc.fillColor('rgba(255,255,255,0.6)').fontSize(9).font('Helvetica')
      .text(s.physical_address || '', 115, 81)
      .text(`TIN: ${TIN}`, 115, 93);

    doc.fillColor(gold).fontSize(16).font('Helvetica-Bold')
      .text('INVOICE', 400, 65, { width: pageW - 350, align: 'right' });
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica')
      .text(inv.invoice_no, 400, 85, { width: pageW - 350, align: 'right' });

    // ── Billed To / Property ──────────────────────────────────────────────────
    let y = 140;
    doc.fillColor(navy).fontSize(9).font('Helvetica-Bold')
      .text('BILLED TO', 50, y)
      .text('PROPERTY', 300, y);

    doc.moveTo(50, y + 12).lineTo(250, y + 12).strokeColor('#cccccc').stroke();
    doc.moveTo(300, y + 12).lineTo(pageW + 50, y + 12).strokeColor('#cccccc').stroke();

    y += 18;
    doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
      .text(inv.tenant_name, 50, y)
      .text(inv.property_name + (inv.unit_name ? ' / ' + inv.unit_name : ''), 300, y);

    doc.fillColor(muted).fontSize(9).font('Helvetica');
    if (inv.postal_address) doc.text(inv.postal_address, 50, y + 14);
    if (inv.phone) doc.text('Ph: ' + inv.phone, 50, y + 26);
    doc.text('Lease Ref: ' + inv.lease_ref, 300, y + 14);
    if (inv.property_address) doc.text(inv.property_address, 300, y + 26);

    // ── Invoice details box ───────────────────────────────────────────────────
    y += 60;
    doc.rect(50, y, pageW, 56).fill('#f4f7fb');
    doc.fillColor(muted).fontSize(9).font('Helvetica')
      .text('Invoice No.', 60, y + 8)
      .text('Period', 200, y + 8)
      .text('Due Date', 380, y + 8);
    doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold')
      .text(inv.invoice_no, 60, y + 22)
      .text(`${fmtD(inv.period_start)} - ${fmtD(inv.period_end)}`, 200, y + 22)
      .text(fmtD(inv.due_date), 380, y + 22);
    doc.fillColor(muted).fontSize(9).font('Helvetica')
      .text('Payment Frequency', 60, y + 38)
      .text(inv.payment_frequency, 60, y + 38 + 12);

    // ── Line items table ──────────────────────────────────────────────────────
    y += 76;
    doc.rect(50, y, pageW, 22).fill(navy);
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
      .text('DESCRIPTION', 60, y + 7)
      .text('AMOUNT (K)', pageW - 50, y + 7, { width: 90, align: 'right' });

    y += 22;
    doc.rect(50, y, pageW, 36).fill('#ffffff').stroke('#eeeeee');
    doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold')
      .text(`Rental - ${inv.property_name}${inv.unit_name ? ' / ' + inv.unit_name : ''}`, 60, y + 6);
    doc.fillColor(muted).fontSize(9).font('Helvetica')
      .text(`${fmtD(inv.period_start)} to ${fmtD(inv.period_end)} (${inv.payment_frequency})`, 60, y + 20);
    doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
      .text(`K${Number(inv.amount_due).toLocaleString()}`, pageW - 50, y + 12, { width: 90, align: 'right' });

    y += 36;
    if (Number(inv.bond_amount) > 0) {
      doc.rect(50, y, pageW, 28).fill('#fffbf0').stroke('#eeeeee');
      doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold')
        .text('Security Bond (ONE-TIME, REFUNDABLE)', 60, y + 9);
      doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
        .text(`K${Number(inv.bond_amount).toLocaleString()}`, pageW - 50, y + 9, { width: 90, align: 'right' });
      y += 28;
    }

    // GST row
    const total = Number(inv.amount_due) + Number(inv.bond_amount || 0);
    const gst = (total / 11).toFixed(2);
    doc.rect(50, y, pageW, 22).fill('#f4f7fb').stroke('#eeeeee');
    doc.fillColor(muted).fontSize(9).font('Helvetica')
      .text('GST Included (10%)', 60, y + 7)
      .text(`K${gst}`, pageW - 50, y + 7, { width: 90, align: 'right' });
    y += 22;

    // Total row
    doc.rect(50, y, pageW, 30).fill(navy);
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold')
      .text('TOTAL DUE (GST Inc.)', 60, y + 9)
      .text(`K${total.toLocaleString()}`, pageW - 50, y + 9, { width: 90, align: 'right' });
    y += 30;

    // ── Bank details ──────────────────────────────────────────────────────────
    y += 16;
    doc.rect(50, y, pageW, 70).stroke(navy);
    doc.fillColor(navy).fontSize(9).font('Helvetica-Bold')
      .text('PAYMENT DETAILS - BANK SOUTH PACIFIC (BSP)', 60, y + 8);
    doc.moveTo(60, y + 20).lineTo(pageW + 40, y + 20).strokeColor('#cccccc').stroke();

    doc.fillColor(muted).fontSize(8).font('Helvetica')
      .text('Account Name', 60, y + 26)
      .text('Account Number', 200, y + 26)
      .text('Account Type', 340, y + 26)
      .text('Branch', 450, y + 26);
    doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold')
      .text(s.bank_account_name || '-', 60, y + 38)
      .text(s.bank_account_number || '-', 200, y + 38)
      .text(s.bank_account_type || '-', 340, y + 38)
      .text(s.bank_branch || '-', 450, y + 38);

    // ── Footer ────────────────────────────────────────────────────────────────
    y += 86;
    doc.fillColor(muted).fontSize(9).font('Helvetica')
      .text(`Please send payment proof to ${s.email || ''} within 2 business days.`, 50, y, { align: 'center', width: pageW });
    doc.text(`${s.company_name || 'Mayemou Trading'} | TIN: ${TIN}`, 50, y + 14, { align: 'center', width: pageW });

    doc.end();
  });
}

export async function generateReceiptPDF(payment, inv, s) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const navy = '#0d2137';
    const gold = '#c8922a';
    const muted = '#666666';
    const pageW = doc.page.width - 100;

    // Header
    doc.rect(50, 50, pageW, 70).fill(navy);
    doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold')
      .text(s.company_name || 'Mayemou Trading', 115, 65);
    doc.fillColor('rgba(255,255,255,0.6)').fontSize(9).font('Helvetica')
      .text(s.physical_address || '', 115, 81)
      .text(`TIN: ${TIN}`, 115, 93);
    doc.fillColor(gold).fontSize(16).font('Helvetica-Bold')
      .text('RECEIPT', 400, 65, { width: pageW - 350, align: 'right' });
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica')
      .text(payment.receipt_no, 400, 85, { width: pageW - 350, align: 'right' });

    // Receipt details
    let y = 150;
    doc.rect(50, y, pageW, 100).fill('#f4f7fb');
    doc.fillColor(navy).fontSize(11).font('Helvetica-Bold')
      .text('Payment Received From:', 60, y + 10);
    doc.fillColor('#000000').fontSize(13).font('Helvetica-Bold')
      .text(inv.tenant_name, 60, y + 26);
    doc.fillColor(muted).fontSize(9).font('Helvetica')
      .text(`Property: ${inv.property_name}${inv.unit_name ? ' / ' + inv.unit_name : ''}`, 60, y + 44)
      .text(`Invoice No: ${inv.invoice_no}`, 60, y + 58)
      .text(`Lease Ref: ${inv.lease_ref}`, 60, y + 72);

    doc.fillColor(navy).fontSize(9).font('Helvetica-Bold')
      .text('Receipt No:', 350, y + 10)
      .text('Date:', 350, y + 26)
      .text('Method:', 350, y + 42);
    doc.fillColor('#000000').fontSize(9).font('Helvetica')
      .text(payment.receipt_no, 430, y + 10)
      .text(fmtD(payment.payment_date), 430, y + 26)
      .text(payment.payment_method, 430, y + 42);

    // Amount box
    y += 120;
    doc.rect(50, y, pageW, 50).fill(navy);
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold')
      .text('AMOUNT PAID', 60, y + 8);
    doc.fillColor(gold).fontSize(22).font('Helvetica-Bold')
      .text(`K${Number(payment.amount_paid).toLocaleString()}`, 60, y + 22);
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica')
      .text(`Period: ${fmtD(inv.period_start)} - ${fmtD(inv.period_end)}`, pageW - 100, y + 18, { width: 140, align: 'right' });

    // Notes
    if (payment.notes) {
      y += 66;
      doc.fillColor(muted).fontSize(9).font('Helvetica').text(`Notes: ${payment.notes}`, 50, y);
    }

    // Footer
    y += 80;
    doc.moveTo(50, y).lineTo(pageW + 50, y).strokeColor('#cccccc').stroke();
    doc.fillColor(muted).fontSize(9).font('Helvetica')
      .text(`${s.company_name || 'Mayemou Trading'} | TIN: ${TIN} | ${s.email || ''}`, 50, y + 10, { align: 'center', width: pageW });
    doc.text('This is an official receipt. Please retain for your records.', 50, y + 24, { align: 'center', width: pageW });

    doc.end();
  });
}
