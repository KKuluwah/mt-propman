import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import { db, getSetting } from '../database/db.js';
import { signTenantToken, tenantAuth } from '../middleware/tenantAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Photo uploads for maintenance requests
const photoDir = path.resolve(__dirname, '../public/uploads/maintenance');
if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, photoDir),
    filename: (req, file, cb) => cb(null, `maint-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') && ALLOWED_IMAGE_EXTS.has(ext)) cb(null, true);
    else cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed.'));
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getTransporter() {
  const gmailUser = process.env.GMAIL_USER || await getSetting('gmail_user');
  const gmailPass = process.env.GMAIL_PASS || await getSetting('gmail_pass');
  if (!gmailUser || !gmailPass) return null;
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmailUser, pass: gmailPass }
  });
}

async function sendMail(to, subject, html) {
  const transporter = await getTransporter();
  if (!transporter) return;
  const companyName = await getSetting('company_name');
  const gmailUser = process.env.GMAIL_USER || await getSetting('gmail_user');
  await transporter.sendMail({ from: `"${companyName}" <${gmailUser}>`, to, subject, html });
}

// ── 3.1 Authentication ────────────────────────────────────────────────────────

// Activate account (admin sends invite, tenant sets password)
router.post('/activate', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const account = await db.prepare(
    'SELECT * FROM tenant_accounts WHERE activation_token = $1 AND activated = FALSE'
  ).get([token]);
  if (!account) return res.status(400).json({ error: 'Invalid or already used activation link.' });

  const hash = await bcrypt.hash(password, 12);
  await db.prepare(
    'UPDATE tenant_accounts SET password_hash=$1, activated=TRUE, activation_token=NULL WHERE id=$2'
  ).run([hash, account.id]);

  res.json({ message: 'Account activated. You can now log in.' });
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const account = await db.prepare(
    'SELECT ta.*, t.name as tenant_name FROM tenant_accounts ta JOIN tenants t ON ta.tenant_id = t.id WHERE ta.email = $1'
  ).get([email.toLowerCase().trim()]);

  if (!account || !account.activated) {
    return res.status(401).json({ error: 'Invalid credentials or account not activated.' });
  }

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

  await db.prepare('UPDATE tenant_accounts SET last_login=NOW() WHERE id=$1').run([account.id]);

  const token = signTenantToken({ accountId: account.id, tenantId: account.tenant_id, email: account.email });
  res.json({ token, name: account.tenant_name });
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const account = await db.prepare(
    'SELECT ta.*, t.name as tenant_name FROM tenant_accounts ta JOIN tenants t ON ta.tenant_id = t.id WHERE ta.email = $1 AND ta.activated = TRUE'
  ).get([email?.toLowerCase().trim()]);

  // Always return success to prevent email enumeration
  if (account) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.prepare(
      'UPDATE tenant_accounts SET reset_token=$1, reset_token_expires=$2 WHERE id=$3'
    ).run([token, expires.toISOString(), account.id]);

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    await sendMail(
      account.email,
      'Reset your MT-PropMan password',
      `<p>Hi ${account.tenant_name},</p>
       <p>Click the link below to reset your password (expires in 1 hour):</p>
       <p><a href="${appUrl}/portal.html?reset=${token}">Reset Password</a></p>
       <p>If you did not request this, ignore this email.</p>`
    );
  }

  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

// Reset password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const account = await db.prepare(
    'SELECT * FROM tenant_accounts WHERE reset_token=$1 AND reset_token_expires > NOW()'
  ).get([token]);
  if (!account) return res.status(400).json({ error: 'Invalid or expired reset link.' });

  const hash = await bcrypt.hash(password, 12);
  await db.prepare(
    'UPDATE tenant_accounts SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2'
  ).run([hash, account.id]);

  res.json({ message: 'Password updated. You can now log in.' });
});

// ── Admin: Invite tenant (requires admin API key) ────────────────────────────

router.post('/invite', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const configuredKey = process.env.API_KEY;
  if (!configuredKey || apiKey !== configuredKey) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }
  next();
}, async (req, res) => {
  const { tenant_id } = req.body;
  const tenant = await db.prepare('SELECT * FROM tenants WHERE id=$1').get([tenant_id]);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
  if (!tenant.email) return res.status(400).json({ error: 'Tenant has no email address.' });

  const token = crypto.randomBytes(32).toString('hex');
  const email = tenant.email.toLowerCase().trim();

  // Upsert account record
  await db.prepare(`
    INSERT INTO tenant_accounts (tenant_id, email, activation_token, activated)
    VALUES ($1, $2, $3, FALSE)
    ON CONFLICT (tenant_id) DO UPDATE SET activation_token=$3, activated=FALSE
  `).run([tenant_id, email, token]);

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const companyName = await getSetting('company_name');
  await sendMail(
    email,
    `Your ${companyName} Tenant Portal Invitation`,
    `<p>Hi ${tenant.name},</p>
     <p>You have been invited to access the ${companyName} tenant portal.</p>
     <p>Click the link below to set your password and activate your account:</p>
     <p><a href="${appUrl}/portal.html?activate=${token}">Activate My Account</a></p>
     <p>This link is valid for 7 days.</p>`
  );

  res.json({ message: `Invitation sent to ${email}.` });
});

// ── 3.2 Tenant Dashboard ──────────────────────────────────────────────────────

router.get('/dashboard', tenantAuth, async (req, res) => {
  const { tenantId } = req.tenant;

  const tenant = await db.prepare(
    'SELECT id, name, email, phone, postal_address, physical_address FROM tenants WHERE id=$1'
  ).get([tenantId]);

  const lease = await db.prepare(`
    SELECT l.*, p.name as property_name, p.address as property_address, p.photo as property_photo,
           p.type as property_type, u.unit_name, u.shared_facilities
    FROM leases l
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE l.tenant_id=$1 AND l.status='active'
    LIMIT 1
  `).get([tenantId]);

  const unpaidInvoices = await db.prepare(`
    SELECT i.id, i.invoice_no, i.amount_due, i.due_date, i.period_start, i.period_end, i.status
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    WHERE l.tenant_id=$1 AND i.status='unpaid'
    ORDER BY i.due_date ASC
  `).all([tenantId]);

  const recentPayments = await db.prepare(`
    SELECT pay.receipt_no, pay.amount_paid, pay.payment_date, pay.payment_method,
           i.invoice_no, i.period_start, i.period_end
    FROM payments pay
    JOIN invoices i ON pay.invoice_id = i.id
    JOIN leases l ON i.lease_id = l.id
    WHERE l.tenant_id=$1
    ORDER BY pay.payment_date DESC LIMIT 5
  `).all([tenantId]);

  const openMaintenance = await db.prepare(`
    SELECT id, title, priority, status, reported_date
    FROM maintenance
    WHERE property_id = (SELECT property_id FROM leases WHERE tenant_id=$1 AND status='active' LIMIT 1)
      AND status='open'
    ORDER BY reported_date DESC LIMIT 5
  `).all([tenantId]);

  res.json({ tenant, lease, unpaidInvoices, recentPayments, openMaintenance });
});

// Update profile
router.put('/profile', tenantAuth, async (req, res) => {
  const { phone, postal_address, physical_address } = req.body;
  await db.prepare(
    'UPDATE tenants SET phone=$1, postal_address=$2, physical_address=$3 WHERE id=$4'
  ).run([phone, postal_address, physical_address, req.tenant.tenantId]);
  res.json({ message: 'Profile updated.' });
});

// Change password
router.put('/change-password', tenantAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  const account = await db.prepare('SELECT * FROM tenant_accounts WHERE id=$1').get([req.tenant.accountId]);
  const valid = await bcrypt.compare(current_password, account.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

  const hash = await bcrypt.hash(new_password, 12);
  await db.prepare('UPDATE tenant_accounts SET password_hash=$1 WHERE id=$2').run([hash, account.id]);
  res.json({ message: 'Password changed successfully.' });
});

// ── Invoices ──────────────────────────────────────────────────────────────────

router.get('/invoices', tenantAuth, async (req, res) => {
  const invoices = await db.prepare(`
    SELECT i.*, p.name as property_name, u.unit_name,
           pay.receipt_no, pay.amount_paid, pay.payment_date, pay.payment_method
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    LEFT JOIN payments pay ON pay.invoice_id = i.id
    WHERE l.tenant_id=$1
    ORDER BY i.created_at DESC
  `).all([req.tenant.tenantId]);
  res.json(invoices);
});

// ── 3.3 Maintenance Portal ────────────────────────────────────────────────────

router.get('/maintenance', tenantAuth, async (req, res) => {
  const lease = await db.prepare(
    'SELECT property_id, unit_id FROM leases WHERE tenant_id=$1 AND status=\'active\' LIMIT 1'
  ).get([req.tenant.tenantId]);
  if (!lease) return res.json([]);

  const items = await db.prepare(`
    SELECT m.*, p.name as property_name, u.unit_name,
           COALESCE(
             json_agg(tmp.filename ORDER BY tmp.created_at) FILTER (WHERE tmp.id IS NOT NULL),
             '[]'
           ) as photos
    FROM maintenance m
    JOIN properties p ON m.property_id = p.id
    LEFT JOIN units u ON m.unit_id = u.id
    LEFT JOIN tenant_maintenance_photos tmp ON tmp.maintenance_id = m.id
    WHERE m.property_id=$1 AND m.tenant_id=$2
    GROUP BY m.id, p.name, u.unit_name
    ORDER BY m.created_at DESC
  `).all([lease.property_id, req.tenant.tenantId]);
  res.json(items);
});

router.post('/maintenance', tenantAuth, upload.array('photos', 5), async (req, res) => {
  const { title, description, priority } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required.' });

  const lease = await db.prepare(
    'SELECT property_id, unit_id FROM leases WHERE tenant_id=$1 AND status=\'active\' LIMIT 1'
  ).get([req.tenant.tenantId]);
  if (!lease) return res.status(400).json({ error: 'No active lease found.' });

  const today = new Date().toISOString().split('T')[0];
  const result = await db.prepare(`
    INSERT INTO maintenance (property_id, unit_id, title, description, priority, reported_date, status, tenant_id)
    VALUES ($1, $2, $3, $4, $5, $6, 'open') RETURNING id
  `).run([lease.property_id, lease.unit_id || null, title, description || '', priority || 'medium', today]);

  const maintId = result.lastInsertRowid;

  // Save uploaded photos
  if (req.files?.length) {
    for (const file of req.files) {
      await db.prepare(
        'INSERT INTO tenant_maintenance_photos (maintenance_id, filename) VALUES ($1, $2)'
      ).run([maintId, file.filename]);
    }
  }

  // Notify admin by email
  const companyEmail = await getSetting('email');
  if (companyEmail) {
    const tenant = await db.prepare('SELECT name FROM tenants WHERE id=$1').get([req.tenant.tenantId]);
    await sendMail(
      companyEmail,
      `New Maintenance Request from ${tenant.name}`,
      `<p><strong>${tenant.name}</strong> submitted a maintenance request:</p>
       <p><strong>${title}</strong> (${priority} priority)</p>
       <p>${description || ''}</p>
       <p>Log in to the admin panel to review.</p>`
    ).catch(() => {}); // non-blocking
  }

  res.json({ id: maintId, message: 'Maintenance request submitted.' });
});

export default router;
