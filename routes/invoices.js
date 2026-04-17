import express from 'express';
import nodemailer from 'nodemailer';
import { db, generateRef, getSetting } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';
import { generateInvoicePDF, generateReceiptPDF } from './pdfHelper.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const invoices = await db.prepare(`
    SELECT i.*, l.rent_amount, l.payment_frequency,
           t.name as tenant_name, t.email as tenant_email,
           p.name as property_name, u.unit_name
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    ORDER BY i.id DESC
  `).all();
  res.json(invoices);
});

router.post('/generate', csrfProtect, async (req, res) => {
  const { lease_id, period_start, period_end, due_date, amount_due } = req.body;
  const lease = await db.prepare('SELECT * FROM leases WHERE id = $1').get([lease_id]);
  if (!lease) return res.status(404).json({ message: 'Lease not found.' });
  const invoice_no = await generateRef('MT-INV');
  const finalAmount = amount_due || lease.rent_amount;
  const result = await db.prepare(
    'INSERT INTO invoices (lease_id, invoice_no, period_start, period_end, amount_due, due_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id'
  ).run([lease_id, invoice_no, period_start, period_end, finalAmount, due_date]);
  res.json({ id: result.lastInsertRowid, invoice_no, message: 'Invoice generated.' });
});

router.post('/generate-all', csrfProtect, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const activeLeases = await db.prepare(`SELECT * FROM leases WHERE status = 'active'`).all();
  let created = 0, skipped = 0;
  for (const lease of activeLeases) {
    const existing = await db.prepare(`SELECT id FROM invoices WHERE lease_id = $1 AND status = 'unpaid'`).get([lease.id]);
    if (existing) { skipped++; continue; }
    const end = lease.payment_frequency === 'fortnightly'
      ? new Date(Date.now() + 13 * 86400000).toISOString().split('T')[0]
      : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];
    const invoice_no = await generateRef('MT-INV');
    await db.prepare(`INSERT INTO invoices (lease_id, invoice_no, period_start, period_end, due_date, amount_due, status) VALUES ($1, $2, $3, $4, $5, $6, 'unpaid')`).run([
      lease.id,
      invoice_no,
      today,
      end,
      end,
      lease.rent_amount,
    ]);
    created++;
  }
  res.json({ created, skipped });
});

router.post('/pay/:id', csrfProtect, async (req, res) => {
  const { amount_paid, payment_date, payment_method, notes } = req.body;
  const receipt_no = await generateRef('MT-REC');
  await db.prepare(
    'INSERT INTO payments (invoice_id, receipt_no, amount_paid, payment_date, payment_method, notes) VALUES ($1, $2, $3, $4, $5, $6)'
  ).run([req.params.id, receipt_no, amount_paid, payment_date, payment_method || 'BSP Transfer', notes || '']);
  await db.prepare("UPDATE invoices SET status = 'paid' WHERE id = $1").run([req.params.id]);
  res.json({ receipt_no, invoice_id: req.params.id, message: 'Payment recorded.' });
});

// Download receipt as PDF
router.get('/:id/receipt-pdf', async (req, res) => {
  const payment = await db.prepare(
    'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY id DESC LIMIT 1'
  ).get([req.params.id]);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });

  const inv = await db.prepare(`
    SELECT i.*, l.rent_amount, l.payment_frequency, l.bond_amount, l.ref_no as lease_ref,
           t.name as tenant_name, t.email as tenant_email, t.postal_address, t.phone,
           p.name as property_name, p.address as property_address, u.unit_name
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE i.id = $1
  `).get([req.params.id]);

  const s = {
    company_name: await getSetting('company_name'),
    physical_address: await getSetting('physical_address'),
    email: await getSetting('email'),
    bank_account_name: await getSetting('bank_account_name'),
    bank_account_number: await getSetting('bank_account_number'),
    bank_account_type: await getSetting('bank_account_type'),
    bank_branch: await getSetting('bank_branch'),
  };

  const pdf = await generateReceiptPDF(payment, inv, s);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${payment.receipt_no}.pdf"`);
  res.send(pdf);
});

router.get('/:id/print', async (req, res) => {
  const inv = await db.prepare(`
    SELECT i.*, l.rent_amount, l.payment_frequency, l.bond_amount, l.ref_no as lease_ref,
           t.name as tenant_name, t.postal_address, t.phone,
           p.name as property_name, p.address as property_address,
           u.unit_name
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE i.id = $1
  `).get([req.params.id]);
  if (!inv) return res.status(404).json({ message: 'Invoice not found.' });
  inv.settings = {
    company_name: await getSetting('company_name'),
    contact_person: await getSetting('contact_person'),
    postal_address: await getSetting('postal_address'),
    physical_address: await getSetting('physical_address'),
    email: await getSetting('email'),
    bank_name: await getSetting('bank_name'),
    bank_account_name: await getSetting('bank_account_name'),
    bank_account_number: await getSetting('bank_account_number'),
    bank_account_type: await getSetting('bank_account_type'),
    bank_branch: await getSetting('bank_branch'),
  };
  res.json(inv);
});

router.get('/:id/email-preview', async (req, res) => {
  const inv = await db.prepare(`
    SELECT i.*, l.rent_amount, l.payment_frequency, l.bond_amount, l.ref_no as lease_ref,
           t.name as tenant_name, t.email as tenant_email, t.postal_address, t.phone,
           p.name as property_name, p.address as property_address,
           u.unit_name
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE i.id = $1
  `).get([req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  const settings = {
    company_name: await getSetting('company_name'),
    contact_person: await getSetting('contact_person'),
    postal_address: await getSetting('postal_address'),
    physical_address: await getSetting('physical_address'),
    email: await getSetting('email'),
    bank_name: await getSetting('bank_name'),
    bank_account_name: await getSetting('bank_account_name'),
    bank_account_number: await getSetting('bank_account_number'),
    bank_account_type: await getSetting('bank_account_type'),
    bank_branch: await getSetting('bank_branch'),
  };
  res.json({ inv, settings });
});

router.post('/:id/send-email', csrfProtect, async (req, res) => {
  const inv = await db.prepare(`
    SELECT i.*, l.rent_amount, l.payment_frequency, l.bond_amount, l.ref_no as lease_ref,
           t.name as tenant_name, t.email as tenant_email,
           p.name as property_name, p.address as property_address, u.unit_name
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE i.id = $1
  `).get([req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  if (!inv.tenant_email) return res.status(400).json({ error: 'Tenant has no email address.' });

  const gmailUser = process.env.GMAIL_USER || await getSetting('gmail_user');
  const gmailPass = process.env.GMAIL_PASS || await getSetting('gmail_pass');
  if (!gmailUser || !gmailPass) return res.status(400).json({ error: 'Gmail credentials not set in Settings.' });

  const s = {
    company_name: await getSetting('company_name'),
    physical_address: await getSetting('physical_address'),
    email: await getSetting('email'),
    bank_account_name: await getSetting('bank_account_name'),
    bank_account_number: await getSetting('bank_account_number'),
    bank_account_type: await getSetting('bank_account_type'),
    bank_branch: await getSetting('bank_branch'),
  };

  const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PG', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  const unitLabel = inv.unit_name ? ' / ' + inv.unit_name : '';
  const appUrl = process.env.APP_URL || 'https://mt-propman.onrender.com';
  const subject = `Invoice ${inv.invoice_no} - ${inv.property_name}${unitLabel} - Due ${fmtD(inv.due_date)}`;

  // Generate PDF attachment
  const pdfBuffer = await generateInvoicePDF(inv, s);

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmailUser, pass: gmailPass }
  });

  try {
    await transporter.sendMail({
      from: `"${s.company_name || 'Mayemou Trading'}" <${gmailUser}>`,
      to: inv.tenant_email,
      subject,
      text: `Dear ${inv.tenant_name},\n\nPlease find your invoice ${inv.invoice_no} attached for ${inv.property_name}${unitLabel}.\n\nAmount Due: K${Number(inv.amount_due).toLocaleString()}\nDue Date: ${fmtD(inv.due_date)}\n\nKindly arrange payment by the due date via BSP Bank Transfer to:\nAccount Name: ${s.bank_account_name || ''}\nAccount Number: ${s.bank_account_number || ''}\nAccount Type: ${s.bank_account_type || ''}\nBranch: ${s.bank_branch || ''}\n\nOnce payment is made, please notify us at:\n${appUrl}/pay-notify.html\n\n${s.company_name || 'Mayemou Trading'}`,
      attachments: [{
        filename: `${inv.invoice_no}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    });
    await db.prepare("UPDATE invoices SET email_sent = true WHERE id = $1").run([req.params.id]);
    res.json({ success: true, sentTo: inv.tenant_email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
