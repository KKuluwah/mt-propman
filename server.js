import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './database/db.js';
import propertiesRouter from './routes/properties.js';
import tenantsRouter from './routes/tenants.js';
import leasesRouter from './routes/leases.js';
import invoicesRouter from './routes/invoices.js';
import maintenanceRouter from './routes/maintenance.js';
import settingsRouter from './routes/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.resolve(__dirname, 'public');
const uploadsDir = path.resolve(__dirname, 'public/uploads');

const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (process.env.API_KEY && apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (!process.env.API_KEY) {
    console.warn('WARNING: API_KEY is not set; /api routes are unprotected.');
  }
  next();
};

app.use(express.json());
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin || req.headers.referer || '';
    if (origin && !origin.startsWith(`http://localhost:${port}`)) {
      return res.status(403).json({ error: 'Forbidden: invalid request origin.' });
    }
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', authenticate);
app.use('/api/properties', propertiesRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/leases', leasesRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/settings', settingsRouter);

app.get('/api/payments-list', async (req, res) => {
  const payments = await db.prepare(`
    SELECT pay.*, i.invoice_no, t.name as tenant_name, p.name as property_name
    FROM payments pay
    JOIN invoices i ON pay.invoice_id = i.id
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    ORDER BY pay.id DESC
  `).all();
  res.json(payments);
});

app.get('/api/dashboard', async (req, res) => {
  const totalProperties = Number((await db.prepare('SELECT COUNT(*) as c FROM properties').get()).c || 0);
  const occupiedProperties = Number((await db.prepare("SELECT COUNT(*) as c FROM properties WHERE status = 'occupied'").get()).c || 0);
  const vacantProperties = Number((await db.prepare("SELECT COUNT(*) as c FROM properties WHERE status = 'vacant'").get()).c || 0);
  const totalUnits = Number((await db.prepare('SELECT COUNT(*) as c FROM units').get()).c || 0);
  const occupiedUnits = Number((await db.prepare("SELECT COUNT(*) as c FROM units WHERE status = 'occupied'").get()).c || 0);
  const unpaidInvoices = Number((await db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status = 'unpaid'").get()).c || 0);
  const overdueInvoices = Number((await db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status = 'unpaid' AND due_date < current_date").get()).c || 0);
  const openMaintenance = Number((await db.prepare("SELECT COUNT(*) as c FROM maintenance WHERE status = 'open'").get()).c || 0);
  const monthlyRevenue = Number((await db.prepare(`
    SELECT COALESCE(SUM(amount_paid), 0) as total FROM payments
    WHERE to_char(payment_date, 'YYYY-MM') = to_char(current_date, 'YYYY-MM')
  `).get()).total || 0);
  const totalRevenue = Number((await db.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM payments').get()).total || 0);
  const recentPayments = await db.prepare(`
    SELECT pay.*, i.invoice_no, t.name as tenant_name, p.name as property_name, u.unit_name
    FROM payments pay
    JOIN invoices i ON pay.invoice_id = i.id
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    ORDER BY pay.id DESC LIMIT 5
  `).all();
  const upcomingDue = await db.prepare(`
    SELECT i.*, t.name as tenant_name, p.name as property_name, u.unit_name
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE i.status = 'unpaid'
    ORDER BY i.due_date ASC LIMIT 5
  `).all();

  res.json({
    totalProperties, occupiedProperties, vacantProperties,
    totalUnits, occupiedUnits,
    unpaidInvoices, overdueInvoices, openMaintenance,
    monthlyRevenue, totalRevenue,
    recentPayments, upcomingDue
  });
});

app.get('/', (req, res) => {
  const indexPath = path.resolve(publicDir, 'index.html');
  res.sendFile(indexPath);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`\n✅ MT-PropMan is running!`);
  console.log(`   Open your browser at: http://localhost:${port}\n`);
});
