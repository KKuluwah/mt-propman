import express from 'express';
import nodemailer from 'nodemailer';
import { db, generateRef, getSetting } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';

const router = express.Router();

// ── Bulk Email ────────────────────────────────────────────────────────────────

router.post('/email-invoices', csrfProtect, async (req, res) => {
  const { invoice_ids } = req.body; // array of invoice IDs
  if (!Array.isArray(invoice_ids) || invoice_ids.length === 0)
    return res.status(400).json({ error: 'No invoice IDs provided.' });

  const gmailUser = process.env.GMAIL_USER || await getSetting('gmail_user');
  const gmailPass = process.env.GMAIL_PASS || await getSetting('gmail_pass');
  if (!gmailUser || !gmailPass)
    return res.status(400).json({ error: 'Gmail credentials not configured.' });

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmailUser, pass: gmailPass }
  });

  const companyName = await getSetting('company_name');
  const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PG', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

  const results = { sent: [], failed: [], skipped: [] };

  for (const id of invoice_ids) {
    const inv = await db.prepare(`
      SELECT i.*, l.bond_amount, l.payment_frequency, l.ref_no as lease_ref,
             t.name as tenant_name, t.email as tenant_email,
             p.name as property_name, u.unit_name
      FROM invoices i
      JOIN leases l ON i.lease_id = l.id
      JOIN tenants t ON l.tenant_id = t.id
      JOIN properties p ON l.property_id = p.id
      LEFT JOIN units u ON l.unit_id = u.id
      WHERE i.id = $1
    `).get([id]);

    if (!inv) { results.skipped.push({ id, reason: 'Not found' }); continue; }
    if (!inv.tenant_email) { results.skipped.push({ id, reason: 'No email' }); continue; }

    try {
      await transporter.sendMail({
        from: `"${companyName}" <${gmailUser}>`,
        to: inv.tenant_email,
        subject: `Invoice ${inv.invoice_no} — ${inv.property_name}${inv.unit_name ? ' / ' + inv.unit_name : ''} — Due ${fmtD(inv.due_date)}`,
        html: buildEmailHtml(inv, { company_name: companyName }, fmtD)
      });
      await db.prepare("UPDATE invoices SET email_sent = true WHERE id = $1").run([id]);
      results.sent.push(id);
    } catch (e) {
      results.failed.push({ id, reason: e.message });
    }
  }

  res.json(results);
});

// ── Payment Reminders ─────────────────────────────────────────────────────────

router.post('/send-reminders', csrfProtect, async (req, res) => {
  const { days_overdue = 0 } = req.body;

  const overdue = await db.prepare(`
    SELECT i.*, t.name as tenant_name, t.email as tenant_email,
           p.name as property_name, u.unit_name
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE i.status = 'unpaid'
      AND i.due_date <= current_date - ($1 || ' days')::INTERVAL
  `).all([days_overdue]);

  if (overdue.length === 0) return res.json({ sent: 0, message: 'No overdue invoices found.' });

  const gmailUser = process.env.GMAIL_USER || await getSetting('gmail_user');
  const gmailPass = process.env.GMAIL_PASS || await getSetting('gmail_pass');
  if (!gmailUser || !gmailPass)
    return res.status(400).json({ error: 'Gmail credentials not configured.' });

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmailUser, pass: gmailPass }
  });

  const companyName = await getSetting('company_name');
  const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PG', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  let sent = 0;

  for (const inv of overdue) {
    if (!inv.tenant_email) continue;
    try {
      await transporter.sendMail({
        from: `"${companyName}" <${gmailUser}>`,
        to: inv.tenant_email,
        subject: `⚠️ Payment Reminder — ${inv.invoice_no} OVERDUE`,
        html: buildReminderHtml(inv, companyName, fmtD)
      });
      sent++;
    } catch (_) { /* continue on individual failure */ }
  }

  res.json({ sent, total: overdue.length });
});

// ── Late Fees ─────────────────────────────────────────────────────────────────

// Preview late fees without applying
router.get('/late-fees/preview', async (req, res) => {
  const rate = parseFloat(req.query.rate) || 5; // % of amount_due
  const grace = parseInt(req.query.grace) || 7;  // days grace period

  const overdue = await db.prepare(`
    SELECT i.id, i.invoice_no, i.amount_due, i.due_date,
           (current_date - i.due_date) as days_overdue,
           t.name as tenant_name,
           p.name as property_name, u.unit_name
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE i.status = 'unpaid'
      AND i.due_date < current_date - ($1 || ' days')::INTERVAL
  `).all([grace]);

  const preview = overdue.map(inv => ({
    ...inv,
    late_fee: Math.round(Number(inv.amount_due) * (rate / 100) * 100) / 100,
    new_total: Math.round((Number(inv.amount_due) * (1 + rate / 100)) * 100) / 100
  }));

  res.json({ rate, grace, preview });
});

// Apply late fees — updates amount_due on overdue invoices
router.post('/late-fees/apply', csrfProtect, async (req, res) => {
  const { rate = 5, grace = 7, invoice_ids } = req.body;

  let query = `
    SELECT id, amount_due FROM invoices
    WHERE status = 'unpaid'
      AND due_date < current_date - ($1 || ' days')::INTERVAL
  `;
  const params = [grace];

  const targets = invoice_ids?.length
    ? (await db.prepare(query).all(params)).filter(i => invoice_ids.includes(i.id))
    : await db.prepare(query).all(params);

  let applied = 0;
  for (const inv of targets) {
    const newAmount = Math.round(Number(inv.amount_due) * (1 + rate / 100) * 100) / 100;
    await db.prepare('UPDATE invoices SET amount_due = $1 WHERE id = $2').run([newAmount, inv.id]);
    applied++;
  }

  res.json({ applied, rate, grace });
});

// ── CSV Export ────────────────────────────────────────────────────────────────

router.get('/export/tenants', async (req, res) => {
  const rows = await db.prepare(`
    SELECT t.id, t.name, t.phone, t.fax, t.email, t.postal_address, t.physical_address,
           l.ref_no as lease_ref, p.name as property_name, u.unit_name,
           l.rent_amount, l.payment_frequency, l.status as lease_status
    FROM tenants t
    LEFT JOIN leases l ON l.tenant_id = t.id AND l.status = 'active'
    LEFT JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    ORDER BY t.name
  `).all();

  const headers = ['ID','Name','Phone','Fax','Email','Postal Address','Physical Address',
    'Lease Ref','Property','Unit','Rent Amount','Payment Frequency','Lease Status'];
  const csv = [headers.join(','),
    ...rows.map(r => [
      r.id, q(r.name), q(r.phone), q(r.fax), q(r.email),
      q(r.postal_address), q(r.physical_address),
      q(r.lease_ref), q(r.property_name), q(r.unit_name),
      r.rent_amount, q(r.payment_frequency), q(r.lease_status)
    ].join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="tenants.csv"');
  res.send(csv);
});

router.get('/export/properties', async (req, res) => {
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.address, p.lot, p.section, p.type, p.status,
      COUNT(u.id) as unit_count,
      SUM(CASE WHEN u.status = 'occupied' THEN 1 ELSE 0 END) as occupied_units,
      COALESCE(SUM(pay.amount_paid), 0) as total_revenue
    FROM properties p
    LEFT JOIN units u ON u.property_id = p.id
    LEFT JOIN leases l ON l.property_id = p.id
    LEFT JOIN invoices i ON i.lease_id = l.id
    LEFT JOIN payments pay ON pay.invoice_id = i.id
    GROUP BY p.id, p.name, p.address, p.lot, p.section, p.type, p.status
    ORDER BY p.name
  `).all();

  const headers = ['ID','Name','Address','Lot','Section','Type','Status','Units','Occupied Units','Total Revenue'];
  const csv = [headers.join(','),
    ...rows.map(r => [
      r.id, q(r.name), q(r.address), q(r.lot), q(r.section),
      q(r.type), q(r.status), r.unit_count, r.occupied_units, r.total_revenue
    ].join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="properties.csv"');
  res.send(csv);
});

router.get('/export/leases', async (req, res) => {
  const rows = await db.prepare(`
    SELECT l.id, l.ref_no, l.status, l.start_date, l.end_date,
           l.rent_amount, l.bond_amount, l.payment_frequency, l.max_occupants,
           t.name as tenant_name, t.email as tenant_email, t.phone,
           p.name as property_name, u.unit_name
    FROM leases l
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    ORDER BY l.id DESC
  `).all();

  const headers = ['ID','Ref No','Status','Start Date','End Date','Rent Amount',
    'Bond Amount','Frequency','Max Occupants','Tenant','Email','Phone','Property','Unit'];
  const csv = [headers.join(','),
    ...rows.map(r => [
      r.id, q(r.ref_no), q(r.status), r.start_date, r.end_date,
      r.rent_amount, r.bond_amount, q(r.payment_frequency), r.max_occupants,
      q(r.tenant_name), q(r.tenant_email), q(r.phone), q(r.property_name), q(r.unit_name)
    ].join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leases.csv"');
  res.send(csv);
});

router.get('/export/payments', async (req, res) => {
  const rows = await db.prepare(`
    SELECT pay.id, pay.receipt_no, pay.amount_paid, pay.payment_date,
           pay.payment_method, pay.notes,
           i.invoice_no, i.amount_due, i.period_start, i.period_end,
           t.name as tenant_name, p.name as property_name, u.unit_name
    FROM payments pay
    JOIN invoices i ON pay.invoice_id = i.id
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    ORDER BY pay.payment_date DESC
  `).all();

  const headers = ['ID','Receipt No','Amount Paid','Payment Date','Method','Notes',
    'Invoice No','Amount Due','Period Start','Period End','Tenant','Property','Unit'];
  const csv = [headers.join(','),
    ...rows.map(r => [
      r.id, q(r.receipt_no), r.amount_paid, r.payment_date, q(r.payment_method), q(r.notes),
      q(r.invoice_no), r.amount_due, r.period_start, r.period_end,
      q(r.tenant_name), q(r.property_name), q(r.unit_name)
    ].join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
  res.send(csv);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// CSV quote helper — wraps value in quotes and escapes internal quotes
function q(val) {
  if (val == null) return '';
  return `"${String(val).replace(/"/g, '""')}"`;
}

function buildEmailHtml(inv, s, fmtD) {
  const total = Number(inv.amount_due) + Number(inv.bond_amount || 0);
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2 style="color:#0d2137">Invoice ${inv.invoice_no}</h2>
    <p>Dear ${inv.tenant_name},</p>
    <p>Please find your invoice for <strong>${inv.property_name}${inv.unit_name ? ' / ' + inv.unit_name : ''}</strong>.</p>
    <table style="width:100%;border-collapse:collapse">
      <tr><td>Period</td><td>${fmtD(inv.period_start)} – ${fmtD(inv.period_end)}</td></tr>
      <tr><td>Due Date</td><td style="color:#b22a2a"><strong>${fmtD(inv.due_date)}</strong></td></tr>
      <tr><td>Amount Due</td><td><strong>K${total.toLocaleString()}</strong></td></tr>
    </table>
    <p style="color:#888;font-size:12px">${s.company_name}</p>
  </div>`;
}

function buildReminderHtml(inv, companyName, fmtD) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2 style="color:#b22a2a">⚠️ Payment Overdue — ${inv.invoice_no}</h2>
    <p>Dear ${inv.tenant_name},</p>
    <p>Your invoice for <strong>${inv.property_name}${inv.unit_name ? ' / ' + inv.unit_name : ''}</strong>
       was due on <strong>${fmtD(inv.due_date)}</strong> and remains unpaid.</p>
    <p><strong>Amount Due: K${Number(inv.amount_due).toLocaleString()}</strong></p>
    <p>Please arrange payment immediately to avoid further action.</p>
    <p style="color:#888;font-size:12px">${companyName}</p>
  </div>`;
}

export default router;
