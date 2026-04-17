import express from 'express';
import { db } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';

const router = express.Router();

// Public — tenant submits payment notification (no auth needed)
router.post('/pay-notify', async (req, res) => {
  const { tenant_name, amount, payment_date, bank_reference, notes } = req.body;
  if (!tenant_name || !amount || !payment_date) {
    return res.status(400).json({ error: 'Name, amount and date are required.' });
  }
  await db.prepare(
    `INSERT INTO notifications (tenant_name, amount, payment_date, bank_reference, notes)
     VALUES ($1, $2, $3, $4, $5)`
  ).run([tenant_name, amount, payment_date, bank_reference || '', notes || '']);
  res.json({ ok: true, message: 'Payment notification sent to your property manager.' });
});

// Admin — get all pending notifications (bell count + list)
router.get('/', async (req, res) => {
  const rows = await db.prepare(
    `SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`
  ).all();
  const pending = rows.filter(r => r.status === 'pending').length;
  res.json({ pending, notifications: rows });
});

// Admin — dismiss a notification
router.put('/:id/dismiss', csrfProtect, async (req, res) => {
  await db.prepare(`UPDATE notifications SET status='dismissed' WHERE id=$1`).run([req.params.id]);
  res.json({ ok: true });
});

// Admin — dismiss all
router.put('/dismiss-all', csrfProtect, async (req, res) => {
  await db.prepare(`UPDATE notifications SET status='dismissed' WHERE status='pending'`).run([]);
  res.json({ ok: true });
});

export default router;
