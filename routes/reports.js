import express from 'express';
import { db } from '../database/db.js';

const router = express.Router();

// Monthly revenue for last 12 months
router.get('/revenue', async (req, res) => {
  const rows = await db.prepare(`
    SELECT
      to_char(payment_date, 'YYYY-MM') as month,
      SUM(amount_paid) as total,
      COUNT(*) as payment_count
    FROM payments
    WHERE payment_date >= current_date - INTERVAL '12 months'
    GROUP BY month
    ORDER BY month ASC
  `).all();
  res.json(rows);
});

// Occupancy rates — properties and units
router.get('/occupancy', async (req, res) => {
  const props = await db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
      SUM(CASE WHEN status = 'vacant' THEN 1 ELSE 0 END) as vacant
    FROM properties
  `).get();
  const units = await db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
      SUM(CASE WHEN status = 'vacant' THEN 1 ELSE 0 END) as vacant
    FROM units
  `).get();
  const byProperty = await db.prepare(`
    SELECT p.name, p.type, p.status,
      COUNT(u.id) as unit_count,
      SUM(CASE WHEN u.status = 'occupied' THEN 1 ELSE 0 END) as occupied_units
    FROM properties p
    LEFT JOIN units u ON u.property_id = p.id
    GROUP BY p.id, p.name, p.type, p.status
    ORDER BY p.name
  `).all();
  res.json({ properties: props, units, byProperty });
});

// P&L — revenue vs expected rent
router.get('/pnl', async (req, res) => {
  const months = await db.prepare(`
    SELECT
      to_char(gs.month, 'YYYY-MM') as month,
      COALESCE(SUM(p.amount_paid), 0) as collected,
      COALESCE(SUM(i.amount_due), 0) as invoiced
    FROM generate_series(
      date_trunc('month', current_date - INTERVAL '11 months'),
      date_trunc('month', current_date),
      '1 month'
    ) AS gs(month)
    LEFT JOIN invoices i ON to_char(i.created_at, 'YYYY-MM') = to_char(gs.month, 'YYYY-MM')
    LEFT JOIN payments p ON to_char(p.payment_date, 'YYYY-MM') = to_char(gs.month, 'YYYY-MM')
    GROUP BY gs.month
    ORDER BY gs.month ASC
  `).all();
  res.json(months);
});

// Lease expiry alerts — leases expiring within N days (default 60)
router.get('/lease-expiry', async (req, res) => {
  const days = parseInt(req.query.days) || 60;
  const rows = await db.prepare(`
    SELECT l.id, l.ref_no, l.end_date, l.rent_amount, l.status,
           t.name as tenant_name, t.email as tenant_email, t.phone,
           p.name as property_name, u.unit_name,
           (l.end_date - current_date) as days_remaining
    FROM leases l
    JOIN tenants t ON l.tenant_id = t.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE l.status = 'active'
      AND l.end_date IS NOT NULL
      AND l.end_date <= current_date + ($1 || ' days')::INTERVAL
    ORDER BY l.end_date ASC
  `).all([days]);
  res.json(rows);
});

// Maintenance analytics
router.get('/maintenance', async (req, res) => {
  const summary = await db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN priority = 'high' AND status = 'open' THEN 1 ELSE 0 END) as high_open,
      ROUND(AVG(CASE WHEN resolved_date IS NOT NULL
        THEN resolved_date - reported_date END)) as avg_resolution_days
    FROM maintenance
  `).get();
  const byProperty = await db.prepare(`
    SELECT p.name as property_name,
      COUNT(m.id) as total,
      SUM(CASE WHEN m.status = 'open' THEN 1 ELSE 0 END) as open
    FROM properties p
    LEFT JOIN maintenance m ON m.property_id = p.id
    GROUP BY p.id, p.name
    ORDER BY total DESC
  `).all();
  const byPriority = await db.prepare(`
    SELECT priority, COUNT(*) as count, status
    FROM maintenance
    GROUP BY priority, status
    ORDER BY priority, status
  `).all();
  res.json({ summary, byProperty, byPriority });
});

// Tenant payment history
router.get('/tenant/:id/payments', async (req, res) => {
  const tenant = await db.prepare('SELECT id, name, email, phone FROM tenants WHERE id = $1').get([req.params.id]);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
  const payments = await db.prepare(`
    SELECT pay.*, i.invoice_no, i.period_start, i.period_end, i.amount_due,
           p.name as property_name, u.unit_name
    FROM payments pay
    JOIN invoices i ON pay.invoice_id = i.id
    JOIN leases l ON i.lease_id = l.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE l.tenant_id = $1
    ORDER BY pay.payment_date DESC
  `).all([req.params.id]);
  const unpaid = await db.prepare(`
    SELECT i.*, p.name as property_name, u.unit_name
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN properties p ON l.property_id = p.id
    LEFT JOIN units u ON l.unit_id = u.id
    WHERE l.tenant_id = $1 AND i.status = 'unpaid'
    ORDER BY i.due_date ASC
  `).all([req.params.id]);
  res.json({ tenant, payments, unpaid });
});

// Property utilization — revenue per property
router.get('/property-utilization', async (req, res) => {
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.type, p.status,
      COUNT(DISTINCT l.id) as total_leases,
      COUNT(DISTINCT CASE WHEN l.status = 'active' THEN l.id END) as active_leases,
      COALESCE(SUM(pay.amount_paid), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN to_char(pay.payment_date,'YYYY-MM') = to_char(current_date,'YYYY-MM')
        THEN pay.amount_paid END), 0) as this_month_revenue
    FROM properties p
    LEFT JOIN leases l ON l.property_id = p.id
    LEFT JOIN invoices i ON i.lease_id = l.id
    LEFT JOIN payments pay ON pay.invoice_id = i.id
    GROUP BY p.id, p.name, p.type, p.status
    ORDER BY total_revenue DESC
  `).all();
  res.json(rows);
});

export default router;
