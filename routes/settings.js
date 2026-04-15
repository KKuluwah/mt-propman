import express from 'express';
import { db } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json(settings);
});

router.post('/', csrfProtect, async (req, res) => {
  const updates = req.body;
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value');
  for (const [key, value] of Object.entries(updates)) {
    await stmt.run([key, value]);
  }
  res.json({ message: 'Settings saved.' });
});

export default router;
