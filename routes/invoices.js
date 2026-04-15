import express from 'express';
import nodemailer from 'nodemailer';
import { db, generateRef, getSetting } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';

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
  res.json({ receipt_no, message: 'Payment recorded.' });
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
           p.name as property_name, u.unit_name
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

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass }
  });

  const fmtD = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PG', { day:'2-digit', month:'short', year:'numeric' }) : '-';
  const s = {
    company_name: await getSetting('company_name'),
    email: await getSetting('email'),
    physical_address: await getSetting('physical_address'),
    bank_account_name: await getSetting('bank_account_name'),
    bank_account_number: await getSetting('bank_account_number'),
    bank_account_type: await getSetting('bank_account_type'),
    bank_branch: await getSetting('bank_branch'),
  };

  const subject = `Invoice ${inv.invoice_no} — ${inv.property_name}${inv.unit_name ? ' / ' + inv.unit_name : ''} — Due ${fmtD(inv.due_date)}`;
  const totalDue = Number(inv.amount_due) + Number(inv.bond_amount || 0);

  const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,sans-serif">
<div style="max-width:580px;margin:16px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.10)">
  <div style="background:#0d2137;padding:20px 26px;display:flex;align-items:center;gap:14px">
    <div style="background:#c8922a;width:46px;height:46px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:#fff">MT</div>
    <div style="display:inline-block;margin-left:14px;flex:1">
      <div style="color:#fff;font-size:15px;font-weight:700">${s.company_name || 'Mayemou Trading'}</div>
      <div style="color:rgba(255,255,255,0.5);font-size:11px">${s.physical_address || ''}</div>
    </div>
    <div style="text-align:right;float:right">
      <div style="color:#c8922a;font-size:17px;font-weight:700">INVOICE</div>
      <div style="color:rgba(255,255,255,0.8);font-size:13px">${inv.invoice_no}</div>
    </div>
  </div>
  <div style="padding:22px 26px">
    <p style="font-size:14px;margin:0 0 14px">Dear <strong>${inv.tenant_name}</strong>,</p>
    <p style="color:#555;font-size:13px;margin:0 0 18px">Please find your invoice for <strong>${inv.property_name}${inv.unit_name ? ' — ' + inv.unit_name : ''}</strong>. Kindly arrange payment by the due date below.</p>
    <div style="background:#f4f7fb;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="color:#888;padding:3px 0">Invoice No.</td><td style="font-weight:600;text-align:right">${inv.invoice_no}</td></tr>
        <tr><td style="color:#888;padding:3px 0">Lease Ref.</td><td style="font-weight:600;text-align:right">${inv.lease_ref}</td></tr>
        <tr><td style="color:#888;padding:3px 0">Period</td><td style="font-weight:600;text-align:right">${fmtD(inv.period_start)} – ${fmtD(inv.period_end)}</td></tr>
        <tr><td style="color:#b22a2a;font-weight:700;padding-top:8px">Due Date</td><td style="color:#b22a2a;font-weight:700;text-align:right;padding-top:8px">${fmtD(inv.due_date)}</td></tr>
      </table>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr style="background:#0d2137">
        <th style="padding:8px 12px;text-align:left;color:#fff;font-size:12px">Description</th>
        <th style="padding:8px 12px;text-align:right;color:#fff;font-size:12px">Amount</th>
      </tr>
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px">Rental — ${inv.property_name}${inv.unit_name ? ' / ' + inv.unit_name : ''}<br><span style="color:#888;font-size:11px">${fmtD(inv.period_start)} to ${fmtD(inv.period_end)} (${inv.payment_frequency})</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700">K${Number(inv.amount_due).toLocaleString()}</td>
      </tr>
      ${Number(inv.bond_amount) > 0 ? `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px">Security Bond <span style="background:#fff3dc;color:#8a5000;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;margin-left:4px">ONE-TIME · REFUNDABLE</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700">K${Number(inv.bond_amount).toLocaleString()}</td>
      </tr>` : ''}
      <tr style="background:#f4f7fb">
        <td style="padding:10px 12px;font-weight:700">TOTAL DUE</td>
        <td style="padding:10px 12px;text-align:right;font-size:18px;font-weight:700;color:#0d2137">K${totalDue.toLocaleString()}</td>
      </tr>
    </table>
    <div style="background:#0d2137;color:#fff;border-radius:8px;padding:14px 18px;margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.5);margin-bottom:10px">Payment Details — BSP</div>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <tr><td style="color:rgba(255,255,255,0.6);width:50%">Account Name</td><td style="color:rgba(255,255,255,0.6)">Account Number</td></tr>
        <tr><td style="font-weight:700;padding-bottom:6px">${s.bank_account_name || '-'}</td><td style="font-weight:700;padding-bottom:6px">${s.bank_account_number || '-'}</td></tr>
        <tr><td style="color:rgba(255,255,255,0.6)">Account Type</td><td style="color:rgba(255,255,255,0.6)">Branch</td></tr>
        <tr><td style="font-weight:700">${s.bank_account_type || '-'}</td><td style="font-weight:700">${s.bank_branch || '-'}</td></tr>
      </table>
    </div>
    <p style="color:#aaa;font-size:11px;text-align:center;margin:0">Send payment proof to ${s.email || ''} within 2 business days.</p>
  </div>
  <div style="background:#f4f7fb;padding:12px 26px;border-top:1px solid #dde3ed;text-align:center">
    <p style="color:#bbb;font-size:10px;margin:0">${s.company_name || 'Mayemou Trading'} &bull; ${s.email || ''}</p>
  </div>
</div>
</body></html>`;

  try {
    await transporter.sendMail({
      from: `"${s.company_name || 'Mayemou Trading'}" <${gmailUser}>`,
      to: inv.tenant_email,
      subject,
      html: htmlBody
    });
    await db.prepare("UPDATE invoices SET email_sent = true WHERE id = $1").run([req.params.id]);
    res.json({ success: true, sentTo: inv.tenant_email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
