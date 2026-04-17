import nodemailer from 'nodemailer';
import { db, generateRef, getSetting } from '../database/db.js';

function daysBetween(date1, date2) {
  return Math.round((new Date(date2) - new Date(date1)) / 86400000);
}

function isDueToday(lease) {
  const today = new Date();
  const start = new Date(lease.start_date);
  if (lease.payment_frequency === 'monthly') {
    return today.getDate() === start.getDate();
  }
  if (lease.payment_frequency === 'fortnightly') {
    return daysBetween(start, today) % 14 === 0;
  }
  return false;
}

async function sendInvoiceEmail(inv, lease, tenant, property, unit, settings) {
  const gmailUser = process.env.GMAIL_USER || await getSetting('gmail_user');
  const gmailPass = process.env.GMAIL_PASS || await getSetting('gmail_pass');
  if (!gmailUser || !gmailPass || !tenant.email) return;

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmailUser, pass: gmailPass }
  });

  const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PG', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  const companyName = settings.company_name || 'Mayemou Trading';
  const unitLabel = unit ? ` / ${unit.unit_name}` : '';

  await transporter.sendMail({
    from: `"${companyName}" <${gmailUser}>`,
    to: tenant.email,
    subject: `Invoice ${inv.invoice_no} — ${property.name}${unitLabel} — Due ${fmtD(inv.due_date)}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#f4f7fb;padding:20px">
        <div style="background:#0d2137;padding:20px;border-radius:10px 10px 0 0;color:#fff">
          <div style="font-size:20px;font-weight:700">${companyName}</div>
          <div style="color:#c8922a;font-size:16px;margin-top:4px">INVOICE ${inv.invoice_no}</div>
        </div>
        <div style="background:#fff;padding:24px;border-radius:0 0 10px 10px">
          <p>Dear <strong>${tenant.name}</strong>,</p>
          <p>Your invoice for <strong>${property.name}${unitLabel}</strong> is ready.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
            <tr style="background:#f4f7fb"><td style="padding:8px">Period</td><td style="padding:8px"><strong>${fmtD(inv.period_start)} – ${fmtD(inv.period_end)}</strong></td></tr>
            <tr><td style="padding:8px">Due Date</td><td style="padding:8px;color:#b22a2a"><strong>${fmtD(inv.due_date)}</strong></td></tr>
            <tr style="background:#f4f7fb"><td style="padding:8px">Amount Due</td><td style="padding:8px;font-size:18px"><strong>K${Number(inv.amount_due).toLocaleString()}</strong></td></tr>
          </table>
          <div style="background:#0d2137;color:#fff;padding:14px;border-radius:8px;font-size:13px">
            <div style="font-weight:700;margin-bottom:8px">Pay via BSP Bank Transfer:</div>
            <div>Account Name: <strong>${settings.bank_account_name || '-'}</strong></div>
            <div>Account Number: <strong>${settings.bank_account_number || '-'}</strong></div>
            <div>Branch: <strong>${settings.bank_branch || '-'}</strong></div>
          </div>
          <p style="color:#888;font-size:12px;margin-top:16px">
            After paying, notify your property manager at:<br>
            <a href="${process.env.APP_URL || 'https://mt-propman.onrender.com'}/pay-notify.html">
              ${process.env.APP_URL || 'https://mt-propman.onrender.com'}/pay-notify.html
            </a>
          </p>
        </div>
      </div>`
  });
}

export async function runScheduler() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const activeLeases = await db.prepare(`SELECT * FROM leases WHERE status='active'`).all();

    const settings = {
      company_name: await getSetting('company_name'),
      bank_account_name: await getSetting('bank_account_name'),
      bank_account_number: await getSetting('bank_account_number'),
      bank_branch: await getSetting('bank_branch'),
    };

    let generated = 0;

    for (const lease of activeLeases) {
      if (!isDueToday(lease)) continue;

      // Skip if unpaid invoice already exists for this period
      const existing = await db.prepare(
        `SELECT id FROM invoices WHERE lease_id=$1 AND status='unpaid' AND period_start=$2`
      ).get([lease.id, today]);
      if (existing) continue;

      // Calculate period end
      const endDate = lease.payment_frequency === 'fortnightly'
        ? new Date(Date.now() + 13 * 86400000).toISOString().split('T')[0]
        : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];

      const invoice_no = await generateRef('MT-INV');
      const result = await db.prepare(
        `INSERT INTO invoices (lease_id, invoice_no, period_start, period_end, due_date, amount_due, status)
         VALUES ($1,$2,$3,$4,$5,$6,'unpaid') RETURNING id`
      ).run([lease.id, invoice_no, today, endDate, endDate, lease.rent_amount]);

      const inv = { id: result.lastInsertRowid, invoice_no, period_start: today, period_end: endDate, due_date: endDate, amount_due: lease.rent_amount };
      const tenant = await db.prepare('SELECT * FROM tenants WHERE id=$1').get([lease.tenant_id]);
      const property = await db.prepare('SELECT * FROM properties WHERE id=$1').get([lease.property_id]);
      const unit = lease.unit_id ? await db.prepare('SELECT * FROM units WHERE id=$1').get([lease.unit_id]) : null;

      if (tenant?.email) {
        await sendInvoiceEmail(inv, lease, tenant, property, unit, settings);
      }

      generated++;
    }

    if (generated > 0) {
      console.log(`Scheduler: generated ${generated} invoice(s) for ${today}`);
    }
  } catch (err) {
    console.error('Scheduler error:', err.message);
  }
}

export function startScheduler() {
  // Run once on startup then every hour
  runScheduler();
  setInterval(runScheduler, 60 * 60 * 1000);
}
