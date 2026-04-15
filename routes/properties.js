import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db } from '../database/db.js';
import csrfProtect from '../middleware/csrf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();
const uploadsDir = path.resolve(__dirname, '../public/uploads');
const publicDir = path.resolve(__dirname, '../public');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `prop-${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  const props = await db.prepare('SELECT * FROM properties ORDER BY id').all();
  const units = await db.prepare('SELECT * FROM units ORDER BY id').all();
  const result = props.map(p => ({ ...p, units: units.filter(u => u.property_id === p.id) }));
  res.json(result);
});

router.post('/', csrfProtect, async (req, res) => {
  const { name, address, lot, section, type } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = await db.prepare(
    'INSERT INTO properties (name, address, lot, section, type) VALUES ($1, $2, $3, $4, $5) RETURNING id'
  ).run([name, address, lot, section, type || 'house']);
  const unitName = type === 'boarding' ? 'Room 1' : 'Main House';
  await db.prepare(
    'INSERT INTO units (property_id, unit_name, rent_monthly, rent_fortnightly, status) VALUES ($1, $2, $3, $4, $5)'
  ).run([result.lastInsertRowid, unitName, 0, 0, 'vacant']);
  res.json({ id: result.lastInsertRowid, message: 'Property added.' });
});

router.put('/:id', csrfProtect, async (req, res) => {
  const { name, address, lot, section, type } = req.body;
  await db.prepare('UPDATE properties SET name=$1, address=$2, lot=$3, section=$4, type=$5 WHERE id=$6').run([
    name,
    address,
    lot,
    section,
    type,
    req.params.id,
  ]);
  res.json({ success: true });
});

router.post('/:id/photo', csrfProtect, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const photoUrl = '/uploads/' + req.file.filename;
  const prop = await db.prepare('SELECT photo FROM properties WHERE id=$1').get([req.params.id]);
  if (prop && prop.photo) {
    const oldPath = path.resolve(publicDir, prop.photo.replace(/^\//, ''));
    if (oldPath.startsWith(publicDir) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  await db.prepare('UPDATE properties SET photo=$1 WHERE id=$2').run([photoUrl, req.params.id]);
  res.json({ success: true, photoUrl });
});

router.put('/units/:id/status', csrfProtect, async (req, res) => {
  const { status } = req.body;
  await db.prepare('UPDATE units SET status=$1 WHERE id=$2').run([status, req.params.id]);
  res.json({ success: true });
});

router.put('/units/:id', csrfProtect, async (req, res) => {
  const { unit_name, rent_monthly, rent_fortnightly } = req.body;
  await db.prepare('UPDATE units SET unit_name=$1, rent_monthly=$2, rent_fortnightly=$3 WHERE id=$4').run([
    unit_name,
    rent_monthly,
    rent_fortnightly,
    req.params.id,
  ]);
  res.json({ success: true });
});

router.post('/:id/units', csrfProtect, async (req, res) => {
  const { unit_name, rent_monthly, rent_fortnightly } = req.body;
  const result = await db.prepare(
    'INSERT INTO units (property_id, unit_name, rent_monthly, rent_fortnightly, status) VALUES ($1, $2, $3, $4, $5) RETURNING id'
  ).run([req.params.id, unit_name, rent_monthly || 0, rent_fortnightly || 0, 'vacant']);
  res.json({ id: result.lastInsertRowid });
});

router.delete('/:id', csrfProtect, async (req, res) => {
  const prop = await db.prepare('SELECT photo FROM properties WHERE id=$1').get([req.params.id]);
  if (prop && prop.photo) {
    const oldPath = path.resolve(publicDir, prop.photo.replace(/^\//, ''));
    if (oldPath.startsWith(publicDir) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  await db.prepare('DELETE FROM units WHERE property_id=$1').run([req.params.id]);
  await db.prepare('DELETE FROM properties WHERE id=$1').run([req.params.id]);
  res.json({ success: true });
});

export default router;
