import express from 'express';
import { db } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';

const router = express.Router();

// Public -- lookup unpaid invoices (all if no name, filtered if name provided)
router.get('/lookup', async (req, res) => {
  const name = (req.query.name || '').trim();
  let invoices;
  if (!name) {
    invoices = await db.prepare(`
      SELECT i.id, i.invoice_no, i.amount_due, i.due_date, i.period_start, i.period_end,
             t.name as tenant_name, p.name as property_name, u.unit_name
      FROM invoices i
      JOIN leases l ON i.lease_id = l.id
      JOIN tenants t ON l.tenant_id = t.id
      JOIN properties p ON l.property_id = p.id
      LEFT JOIN units u ON l.unit_id = u.id
      WHERE i.status = 'unpaid'
      ORDER BY i.due_date ASC
    `).all();
  } else {
    invoices = await db.prepare(`
      SELECT i.id, i.invoice_no, i.amount_due, i.due_date, i.period_start, i.period_end,
             t.name as tenant_name, p.name as property_name, u.unit_name
      FROM invoices i
      JOIN leases l ON i.lease_id = l.id
      JOIN tenants t ON l.tenant_id = t.id
      JOIN properties p ON l.property_id = p.id
      LEFT JOIN units u ON l.unit_id = u.id
      WHERE i.status = 'unpaid'
        AND LOWER(t.name) LIKE LOWER($1)
      ORDER BY i.due_date ASC
    `).all([`%${name}%`]);
  }
  res.json(invoices);
});

// Public -- tenant submits payment notification
router.post('/pay-notify', async (req, res) => {
  const { tenant_name, amount, payment_date, bank_reference, notes, invoice_no } = req.body;
  if (!tenant_name || !amount || !payment_date || !invoice_no) {
    return res.status(400).json({ error: 'Name, invoice number, amount and date are required.' });
  }
  await db.prepare(
    `INSERT INTO notifications (tenant_name, amount, payment_date, bank_reference, notes, invoice_no)
     VALUES ($1, $2, $3, $4, $5, $6)`
  ).run([tenant_name, amount, payment_date, bank_reference || '', notes || '', invoice_no]);
  res.json({ ok: true, message: 'Payment notification sent to your property manager.' });
});

// Admin -- get all notifications
router.get('/', async (req, res) => {
  const rows = await db.prepare(
    `SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`
  ).all();
  const pending = rows.filter(r => r.status === 'pending').length;
  res.json({ pending, notifications: rows });
});

// Admin -- dismiss all (must be before /:id/dismiss)
router.put('/dismiss-all', csrfProtect, async (req, res) => {
  await db.prepare(`UPDATE notifications SET status='dismissed' WHERE status='pending'`).run([]);
  res.json({ ok: true });
});

// Admin -- dismiss a notification
router.put('/:id/dismiss', csrfProtect, async (req, res) => {
  await db.prepare(`UPDATE notifications SET status='dismissed' WHERE id=$1`).run([req.params.id]);
  res.json({ ok: true });
});

export default router;
