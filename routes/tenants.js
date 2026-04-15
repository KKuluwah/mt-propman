import express from 'express';
import { db } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const tenants = await db.prepare('SELECT * FROM tenants ORDER BY name ASC').all();
  for (const t of tenants) {
    t.lease = await db.prepare(`
      SELECT l.*, p.name as property_name, u.unit_name
      FROM leases l
      JOIN properties p ON l.property_id = p.id
      LEFT JOIN units u ON l.unit_id = u.id
      WHERE l.tenant_id = $1 AND l.status = 'active'
      LIMIT 1
    `).get([t.id]) || null;
  }
  res.json(tenants);
});

router.post('/', csrfProtect, async (req, res) => {
  const { name, postal_address, physical_address, phone, fax, email } = req.body;
  const result = await db.prepare(
    'INSERT INTO tenants (name, postal_address, physical_address, phone, fax, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id'
  ).run([name, postal_address, physical_address, phone, fax, email || '']);
  res.json({ id: result.rows[0]?.id, message: 'Tenant added.' });
});

router.put('/:id', csrfProtect, async (req, res) => {
  const { name, postal_address, physical_address, phone, fax, email } = req.body;
  await db.prepare(
    'UPDATE tenants SET name=$1, postal_address=$2, physical_address=$3, phone=$4, fax=$5, email=$6 WHERE id=$7'
  ).run([name, postal_address, physical_address, phone, fax, email || '', req.params.id]);
  res.json({ message: 'Tenant updated.' });
});

router.delete('/:id', csrfProtect, async (req, res) => {
  await db.prepare('DELETE FROM tenants WHERE id = $1').run([req.params.id]);
  res.json({ message: 'Tenant deleted.' });
});

export default router;
