import express from 'express';
import { db, generateRef } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';

const router = express.Router();

router.post('/', csrfProtect, async (req, res) => {
  const { property_id, unit_id, tenant_id, start_date, end_date,
          rent_amount, bond_amount, payment_frequency, max_occupants } = req.body;
  const ref_no = await generateRef('MT-LA');
  const result = await db.prepare(`
    INSERT INTO leases (property_id, unit_id, tenant_id, ref_no, start_date, end_date,
    rent_amount, bond_amount, payment_frequency, max_occupants)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
  `).run([
    property_id,
    unit_id || null,
    tenant_id,
    ref_no,
    start_date,
    end_date,
    rent_amount,
    bond_amount || 0,
    payment_frequency || 'monthly',
    max_occupants || 1,
  ]);

  if (unit_id) {
    await db.prepare("UPDATE units SET status = 'occupied' WHERE id = $1").run([unit_id]);
  }
  await db.prepare("UPDATE properties SET status = 'occupied' WHERE id = $1").run([property_id]);

  res.json({ id: result.lastInsertRowid, ref_no, message: 'Lease created.' });
});

router.get('/', async (req, res) => {
  const leases = await db.prepare(`
    SELECT l.*, t.name as tenant_name, t.email as tenant_email,
           p.name as property_name, u.unit_name
    FROM leases l
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    ORDER BY l.id DESC
  `).all();
  res.json(leases);
});

router.put('/:id', csrfProtect, async (req, res) => {
  const { payment_frequency, rent_amount, bond_amount, max_occupants, start_date, end_date } = req.body;
  await db.prepare(`
    UPDATE leases SET payment_frequency=$1, rent_amount=$2, bond_amount=$3, max_occupants=$4, start_date=$5, end_date=$6
    WHERE id=$7
  `).run([payment_frequency, rent_amount, bond_amount || 0, max_occupants || 1, start_date, end_date, req.params.id]);
  res.json({ success: true });
});

router.put('/terminate/:id', csrfProtect, async (req, res) => {
  const lease = await db.prepare('SELECT * FROM leases WHERE id = $1').get([req.params.id]);
  if (!lease) return res.status(404).json({ message: 'Lease not found.' });
  await db.prepare("UPDATE leases SET status = 'terminated' WHERE id = $1").run([req.params.id]);
  if (lease.unit_id) {
    await db.prepare("UPDATE units SET status = 'vacant' WHERE id = $1").run([lease.unit_id]);
  }
  const active = await db.prepare("SELECT COUNT(*) as c FROM leases WHERE property_id = $1 AND status = 'active'").get([lease.property_id]);
  if (Number(active.c) === 0) {
    await db.prepare("UPDATE properties SET status = 'vacant' WHERE id = $1").run([lease.property_id]);
  }
  res.json({ message: 'Lease terminated.' });
});

export default router;
