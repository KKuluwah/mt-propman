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

export async function runScheduler() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const activeLeases = await db.prepare(`SELECT * FROM leases WHERE status='active'`).all();
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
      await db.prepare(
        `INSERT INTO invoices (lease_id, invoice_no, period_start, period_end, due_date, amount_due, status)
         VALUES ($1,$2,$3,$4,$5,$6,'unpaid')`
      ).run([lease.id, invoice_no, today, endDate, endDate, lease.rent_amount]);

      generated++;
    }

    if (generated > 0) {
      console.log(`Scheduler: generated ${generated} invoice(s) for ${today}`);
    }

    // Check for invoices due within 3 days and create reminder notifications
    await checkUpcomingReminders();

  } catch (err) {
    console.error('Scheduler error:', err.message);
  }
}

async function checkUpcomingReminders() {
  // Find unpaid invoices due in 1, 2 or 3 days that haven't been reminded yet
  const upcoming = await db.prepare(`
    SELECT i.id, i.invoice_no, i.amount_due, i.due_date,
           t.name as tenant_name, p.name as property_name, u.unit_name,
           (i.due_date::date - current_date) as days_until_due
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE i.status = 'unpaid'
      AND i.due_date::date BETWEEN current_date AND current_date + INTERVAL '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.invoice_no = i.invoice_no
          AND n.status = 'reminder'
      )
  `).all();

  for (const inv of upcoming) {
    const daysText = inv.days_until_due === 0 ? 'DUE TODAY' : `due in ${inv.days_until_due} day(s)`;
    await db.prepare(
      `INSERT INTO notifications (tenant_name, amount, payment_date, bank_reference, notes, invoice_no, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'reminder')`
    ).run([
      inv.tenant_name,
      inv.amount_due,
      inv.due_date,
      '',
      `REMINDER: Invoice ${inv.invoice_no} for ${inv.property_name}${inv.unit_name ? ' / ' + inv.unit_name : ''} is ${daysText}. Please send invoice email to tenant.`,
      inv.invoice_no
    ]);
  }

  if (upcoming.length > 0) {
    console.log(`Scheduler: created ${upcoming.length} reminder(s) for upcoming invoices`);
  }
}

export function startScheduler() {
  // Run once on startup then every hour
  runScheduler();
  setInterval(runScheduler, 60 * 60 * 1000);
}
