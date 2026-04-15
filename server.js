import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import connectPgSimple from 'connect-pg-simple';
import path from 'path';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { db, checkDbHealth } from './database/db.js';
import logger from './middleware/logger.js';
import { responseTimeMiddleware, getResponseTimeStats } from './middleware/responseTime.js';
import { apiLimiter, emailLimiter } from './middleware/rateLimiter.js';
import { requireAdmin } from './middleware/adminAuth.js';
import propertiesRouter from './routes/properties.js';
import tenantsRouter from './routes/tenants.js';
import leasesRouter from './routes/leases.js';
import invoicesRouter from './routes/invoices.js';
import maintenanceRouter from './routes/maintenance.js';
import settingsRouter from './routes/settings.js';
import reportsRouter from './routes/reports.js';
import bulkRouter from './routes/bulk.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.resolve(__dirname, 'public');

// Simple request counter for health endpoint
const metrics = { requests: 0, errors: 0, startTime: Date.now() };

// ── Core Middleware ───────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.set('trust proxy', 1);
app.use(responseTimeMiddleware);
app.use(morgan('combined', {
  skip: () => process.env.NODE_ENV === 'test',
  stream: { write: msg => logger.http(msg.trim()) }
}));
app.use((req, res, next) => { metrics.requests++; next(); });

// Session for admin auth — stored in PostgreSQL so sessions survive restarts
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'admin_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'mt-propman-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// ── Health Check (public — used by Render uptime monitoring) ──────────────────

app.get('/health', async (req, res) => {
  const dbHealth = await checkDbHealth();
  const mem = process.memoryUsage();
  const status = dbHealth.status === 'healthy' ? 'healthy' : 'unhealthy';
  res.status(status === 'healthy' ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    version: '2.1.0',
    environment: process.env.NODE_ENV || 'development',
    database: dbHealth,
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
      rss: Math.round(mem.rss / 1024 / 1024) + 'MB'
    },
    requests: metrics.requests,
    errors: metrics.errors,
    responseTimes: getResponseTimeStats()
  });
});

// ── Admin Auth Routes ─────────────────────────────────────────────────────────

app.post('/auth/login', apiLimiter, async (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

  logger.info('Login attempt', {
    usernameReceived: username,
    adminUser,
    usernameMatch: username === adminUser,
    hasHash: !!adminHash,
    hasPlainPass: !!process.env.ADMIN_PASSWORD
  });

  if (!adminHash) {
    if (username !== adminUser || password !== adminPass) {
      logger.warn('Login failed — plain password mismatch');
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
  } else {
    if (username !== adminUser || !(await bcrypt.compare(password, adminHash))) {
      logger.warn('Login failed — bcrypt mismatch');
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
  }

  req.session.admin = true;
  req.session.loginTime = Date.now();
  logger.info('Login success', { username });
  res.json({ ok: true });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/auth/status', (req, res) => {
  res.json({ loggedIn: !!req.session?.admin });
});

// ── Static Files ──────────────────────────────────────────────────────────────

// login.html is public
app.use(express.static(publicDir, { index: false }));
app.use('/uploads', express.static(path.resolve(__dirname, 'public/uploads')));

// Serve login page
app.get('/login.html', (req, res) => res.sendFile(path.resolve(publicDir, 'login.html')));

// Main app — requires login
app.get('/', requireAdmin, (req, res) => res.sendFile(path.resolve(publicDir, 'index.html')));

// ── API Routes (all require admin session) ────────────────────────────────────

app.use('/api', requireAdmin, apiLimiter);
app.use('/api/properties', propertiesRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/leases', leasesRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/invoices/:id/send-email', emailLimiter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/bulk', bulkRouter);

app.get('/api/payments-list', requireAdmin, apiLimiter, async (req, res) => {
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

app.get('/api/dashboard', requireAdmin, apiLimiter, async (req, res) => {
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

// ── Error Handling ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  metrics.errors++;
  logger.error('Unhandled error', { message: err.message, stack: err.stack, path: req.path, method: req.method });
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

process.on('SIGTERM', () => { logger.info('SIGTERM — shutting down'); process.exit(0); });
process.on('SIGINT',  () => { logger.info('SIGINT — shutting down');  process.exit(0); });
process.on('uncaughtException',  (err)    => { logger.error('Uncaught exception',        { message: err.message, stack: err.stack }); process.exit(1); });
process.on('unhandledRejection', (reason) => { logger.error('Unhandled rejection',       { reason: String(reason) }); });

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(port, () => {
  logger.info('MT-PropMan started', {
    port,
    env: process.env.NODE_ENV || 'development',
    db: process.env.DATABASE_URL ? 'configured' : 'NOT CONFIGURED',
    adminUser: process.env.ADMIN_USER || 'admin',
    authMode: process.env.ADMIN_PASSWORD_HASH ? 'bcrypt' : 'plaintext (set ADMIN_PASSWORD_HASH in production)'
  });
});
