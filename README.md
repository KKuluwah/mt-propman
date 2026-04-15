# MT-PropMan — Property Management System

A modern, full-featured property management application built with Node.js, Express, and PostgreSQL. Manage properties, tenants, leases, invoices, and maintenance requests with ease.

---

## Features

✅ **Property & Unit Management**
- Add and manage multiple properties
- Support for single homes and multi-unit properties
- Photo uploads for properties
- Occupancy tracking (vacant/occupied)

✅ **Tenant Management**
- Centralized tenant database
- Contact information and postal addresses
- Active lease tracking per tenant
- Tenant search and filtering

✅ **Lease Management**
- Create and manage rental agreements
- Track lease dates, rent amounts, and payment frequency
- Bond/security deposit tracking
- Automatic lease status updates

✅ **Invoicing & Payments**
- Automated invoice generation from lease details
- Email invoicing with HTML templates
- Payment recording and receipt generation
- Reference number tracking (MT-INV, MT-REC, MT-LA)

✅ **Maintenance Tracking**
- Log maintenance requests and issues
- Assign priority levels (low, medium, high)
- Track resolution dates
- Property and unit-specific filtering

✅ **System Settings**
- Configurable company details
- Gmail integration for email notifications
- Bank account information for invoices
- Extensible settings panel

---

## Tech Stack

- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL (async queries)
- **Frontend**: HTML, CSS, JavaScript
- **Hosting**: Ready for Render, Heroku, or any Node.js platform
- **Email**: Gmail SMTP integration

---

## Getting Started

### For Local Development

1. **Read [DEVELOPMENT.md](./DEVELOPMENT.md)** — Step-by-step setup for your local machine
2. Install PostgreSQL
3. Clone, install dependencies, initialize database
4. Run `node server.js`
5. Open http://localhost:3000

### For Production Deployment

1. **Read [DEPLOYMENT.md](./DEPLOYMENT.md)** — Complete deployment guide
2. Push code to GitHub
3. Create PostgreSQL database (Render, AWS, or self-hosted)
4. Deploy to Render with one click
5. Set up continuous deployment

---

## Project Structure

```
mt-propman/
├── server.js                 # Express app entry
├── package.json              # Dependencies
├── .env.example              # Configuration template
├── database/
│   └── db.js                 # PostgreSQL setup & helpers
├── middleware/
│   └── csrf.js               # CSRF protection
├── routes/                   # API endpoints
│   ├── properties.js
│   ├── tenants.js
│   ├── leases.js
│   ├── invoices.js
│   ├── maintenance.js
│   └── settings.js
├── public/                   # Frontend
│   ├── index.html
│   ├── js/
│   ├── css/
│   └── uploads/
├── DEVELOPMENT.md            # Local setup guide
├── DEPLOYMENT.md             # Cloud deployment guide
└── README.md                 # This file
```

---

## API Endpoints

### Properties
- `GET /api/properties` — List all properties
- `POST /api/properties` — Create property
- `PUT /api/properties/:id` — Update property
- `DELETE /api/properties/:id` — Delete property

### Tenants
- `GET /api/tenants` — List all tenants
- `POST /api/tenants` — Add tenant
- `PUT /api/tenants/:id` — Update tenant
- `DELETE /api/tenants/:id` — Remove tenant

### Leases
- `GET /api/leases` — List all leases
- `POST /api/leases` — Create lease
- `PUT /api/leases/:id` — Update lease
- `POST /api/leases/:id/terminate` — Terminate lease

### Invoices
- `GET /api/invoices` — List all invoices
- `POST /api/invoices/generate` — Create single invoice
- `POST /api/invoices/generate-all` — Batch generate invoices
- `POST /api/invoices/:id/pay` — Record payment
- `GET /api/invoices/:id/print` — Invoice details for printing
- `POST /api/invoices/:id/send-email` — Email invoice to tenant

### Maintenance
- `GET /api/maintenance` — List all requests
- `POST /api/maintenance` — Log new request
- `PUT /api/maintenance/resolve/:id` — Mark as resolved
- `DELETE /api/maintenance/:id` — Delete request

### Settings
- `GET /api/settings` — Get all settings
- `POST /api/settings` — Update settings

---

## Environment Variables

See `.env.example` for details. Key variables:

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
GMAIL_USER=your-email@gmail.com
GMAIL_PASS=your-app-password
PORT=3000
NODE_ENV=production
```

---

## Security Features

- CSRF protection on state-changing requests
- PostgreSQL parameterized queries (prevents SQL injection)
- Environment variable isolation (credentials not in code)
- SSL support for database connections
- Gmail app-password authentication (not plain password)

---

## Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] PostgreSQL database created
- [ ] Render account set up and connected to GitHub
- [ ] Environment variables configured in Render
- [ ] Web service deployed and tested at provided URL
- [ ] Custom domain configured (optional)
- [ ] Backups enabled
- [ ] Team members invited

---

## Troubleshooting

**Server won't start?**
- Check `.env` has `DATABASE_URL`
- Verify PostgreSQL is running
- Run `npm install` to ensure dependencies are installed

**Database not initializing?**
- Ensure PostgreSQL credentials are correct
- Check database name exists
- Review server logs for SQL errors

**Emails not sending?**
- Verify Gmail credentials in `.env` or Render settings
- Check if Gmail requires app-specific password (usually does)
- Confirm SMTP is accessible (may need to disable firewall rules)

**Deployment failing?**
- Check Render dashboard logs
- Verify all environment variables are set
- Ensure `package-lock.json` is committed to Git
- Try rebuilding the service in Render

---

## Support & Development

For issues or questions:
1. Check the [DEVELOPMENT.md](./DEVELOPMENT.md) or [DEPLOYMENT.md](./DEPLOYMENT.md) guides
2. Review error messages in server logs
3. Test locally first before deploying changes
4. Use `git log` to review recent changes

---

## License

This project is for personal/business use. Modify and deploy as needed.

---

## Credits

Built with modern Node.js and PostgreSQL for reliable, scalable property management.

Last updated: April 2026
