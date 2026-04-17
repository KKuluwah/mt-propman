import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();

const { Pool } = pkg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required. Please set it in your environment.');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
  process.exit(1);
});

const schemaSql = `
CREATE TABLE IF NOT EXISTS properties (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  lot TEXT,
  section TEXT,
  type TEXT DEFAULT 'house',
  status TEXT DEFAULT 'vacant',
  photo TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
  id SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  rent_monthly NUMERIC DEFAULT 0,
  rent_fortnightly NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'vacant',
  shared_facilities TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  postal_address TEXT,
  physical_address TEXT,
  phone TEXT,
  fax TEXT,
  email TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leases (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  ref_no TEXT UNIQUE,
  start_date DATE,
  end_date DATE,
  rent_amount NUMERIC,
  bond_amount NUMERIC,
  payment_frequency TEXT DEFAULT 'monthly',
  max_occupants INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  lease_id INTEGER REFERENCES leases(id) ON DELETE SET NULL,
  invoice_no TEXT UNIQUE,
  period_start DATE,
  period_end DATE,
  amount_due NUMERIC,
  due_date DATE,
  status TEXT DEFAULT 'unpaid',
  email_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  receipt_no TEXT UNIQUE,
  amount_paid NUMERIC,
  payment_date DATE,
  payment_method TEXT DEFAULT 'BSP Transfer',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maintenance (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'open',
  reported_date DATE,
  resolved_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS tenant_accounts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  activated BOOLEAN DEFAULT FALSE,
  activation_token TEXT,
  reset_token TEXT,
  reset_token_expires TIMESTAMP,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_maintenance_photos (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER REFERENCES maintenance(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  tenant_name TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  payment_date DATE NOT NULL,
  bank_reference TEXT,
  notes TEXT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_no TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

async function prepareSchema() {
  await pool.query(schemaSql);

  // Add columns that may not exist in older deployments
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS invoice_no TEXT`);
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL`);

  const settingsDefaults = [
    ['company_name', 'Mayemou Trading'],
    ['contact_person', 'Anna Kuluwah'],
    ['postal_address', 'P.O. Box 704, Lae, 411, Morobe Province, PNG'],
    ['physical_address', 'Independence Drive, Speedway, Top Town, Lae 411, Morobe Province, PNG'],
    ['phone', ''],
    ['email', 'mayemoutrading4@gmail.com'],
    ['bank_name', 'Bank South Pacific (BSP)'],
    ['bank_account_name', 'MAYEMOU TRADING (Anna Kuluwah)'],
    ['bank_account_number', '1012414544'],
    ['bank_account_type', 'Cheque (CHQ)'],
    ['bank_branch', 'BSP Top Town, Lae, Morobe Province'],
    ['invoice_prefix', 'MT-INV'],
    ['lease_prefix', 'MT-LA'],
    ['receipt_prefix', 'MT-REC'],
  ];

  for (const [key, value] of settingsDefaults) {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }

  const result = await pool.query('SELECT COUNT(*) as c FROM properties');
  if (Number(result.rows[0].c) === 0) {
    const addr = 'P.O. Box 704, Independence Drive, Speedway, Top Town, Lae 411, Morobe Province, PNG';

    const p1 = await pool.query(
      "INSERT INTO properties (name, address, type, status) VALUES ($1, $2, 'house', 'vacant') RETURNING id",
      ['MT House 1', addr]
    );
    await pool.query(
      "INSERT INTO units (property_id, unit_name, rent_monthly, rent_fortnightly, status) VALUES ($1, 'Main House', 2000, 1000, 'vacant')",
      [p1.rows[0].id]
    );

    const p2 = await pool.query(
      "INSERT INTO properties (name, address, type, status) VALUES ($1, $2, 'house', 'vacant') RETURNING id",
      ['MT House 2', addr]
    );
    await pool.query(
      "INSERT INTO units (property_id, unit_name, rent_monthly, rent_fortnightly, status) VALUES ($1, 'Main House', 1500, 750, 'vacant')",
      [p2.rows[0].id]
    );

    const p3 = await pool.query(
      "INSERT INTO properties (name, address, type, status) VALUES ($1, $2, 'boarding', 'vacant') RETURNING id",
      ['MT Boarding House 3', addr]
    );
    for (let i = 1; i <= 8; i++) {
      await pool.query(
        "INSERT INTO units (property_id, unit_name, rent_monthly, rent_fortnightly, status, shared_facilities) VALUES ($1, $2, 600, 300, 'vacant', 'Shared shower & toilet')",
        [p3.rows[0].id, `Room ${i}`]
      );
    }
  }
}

prepareSchema().catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

function prepare(text) {
  return {
    all: async (params = []) => (await pool.query(text, params)).rows,
    get: async (params = []) => (await pool.query(text, params)).rows[0],
    run: async (params = []) => {
      const result = await pool.query(text, params);
      return {
        lastInsertRowid: result.rows[0]?.id ?? null,
        rowCount: result.rowCount,
      };
    },
  };
}

async function checkDbHealth() {
  const start = Date.now();
  try {
    const result = await pool.query('SELECT COUNT(*) as c FROM properties');
    return {
      status: 'healthy',
      connection: 'ok',
      responseMs: Date.now() - start,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
      recordCount: Number(result.rows[0].c)
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      connection: 'failed',
      responseMs: Date.now() - start,
      error: err.message
    };
  }
}

async function generateRef(prefix) {
  const year = new Date().getFullYear();
  // Whitelist map — table/col never come from user input
  const allowed = {
    'MT-LA':  { table: 'leases',   col: 'ref_no'     },
    'MT-INV': { table: 'invoices', col: 'invoice_no'  },
    'MT-REC': { table: 'payments', col: 'receipt_no'  }
  };
  const entry = allowed[prefix];
  if (!entry) throw new Error(`Invalid prefix: ${prefix}`);
  const { table, col } = entry;
  const pattern = `${prefix}-${year}-%`;
  // table and col are from a closed whitelist, not user input
  const result = await pool.query(
    `SELECT ${col} FROM ${table} WHERE ${col} LIKE $1 ORDER BY id DESC LIMIT 1`,
    [pattern]
  );
  const match = result.rows[0];
  if (match?.[col]?.startsWith(`${prefix}-${year}-`)) {
    const last = parseInt(match[col].split('-').pop(), 10);
    return `${prefix}-${year}-${String(last + 1).padStart(3, '0')}`;
  }
  return `${prefix}-${year}-001`;
}

async function getSetting(key) {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0]?.value || '';
}

const db = { prepare };

export { db, generateRef, getSetting, checkDbHealth };

