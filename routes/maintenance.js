import express from 'express';
import { db } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const items = await db.prepare(`
    SELECT m.*, p.name as property_name, u.unit_name
    FROM maintenance m
    JOIN properties p ON m.property_id = p.id
    LEFT JOIN units u ON m.unit_id = u.id
    ORDER BY m.id DESC
  `).all();
  res.json(items);
});

router.post('/', csrfProtect, async (req, res) => {
  const { property_id, unit_id, title, description, priority, reported_date } = req.body;
  const result = await db.prepare(
    'INSERT INTO maintenance (property_id, unit_id, title, description, priority, reported_date, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id'
  ).run([property_id, unit_id || null, title, description || '', priority || 'medium', reported_date || new Date().toISOString().split('T')[0], 'open']);
  res.json({ id: result.lastInsertRowid, message: 'Maintenance request logged.' });
});

router.put('/resolve/:id', csrfProtect, async (req, res) => {
  const resolved_date = new Date().toISOString().split('T')[0];
  await db.prepare("UPDATE maintenance SET status = $1, resolved_date = $2 WHERE id = $3").run(['resolved', resolved_date, req.params.id]);
  res.json({ message: 'Marked as resolved.' });
});

router.delete('/:id', csrfProtect, async (req, res) => {
  await db.prepare('DELETE FROM maintenance WHERE id = $1').run([req.params.id]);
  res.json({ message: 'Deleted.' });
});

export default router;
