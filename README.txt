# MT-PropMan v2.1
## Mayemou Trading Property Manager

**🎉 NOW MIGRATED TO POSTGRESQL & READY FOR CLOUD DEPLOYMENT!**

---

## DOCUMENTATION GUIDES

📖 **Read these guides (in order):**
1. **QUICKSTART.md** — 5-minute deployment checklist (START HERE!)
2. **DEVELOPMENT.md** — Local setup with PostgreSQL
3. **DEPLOYMENT.md** — Deploy to Render (GitHub + PostgreSQL)
4. **README.md** — Full API reference & project docs

---

## LOCAL QUICK START (requires PostgreSQL installed)

1. Open terminal in this folder
2. Run: npm install
3. Update .env with DATABASE_URL (or use default if PostgreSQL on localhost)
4. Run: node server.js
5. Open your browser at: http://localhost:3000

---

## FOLDER STRUCTURE

mt-propman/
├── server.js              ← Start the app from here
├── package.json           ← Dependencies (now includes 'pg' for PostgreSQL)
├── .env.example           ← Environment template (copy to .env and fill in)
├── database/
│   └── db.js              ← PostgreSQL pool & schema initialization
├── routes/
│   ├── properties.js
│   ├── tenants.js
│   ├── leases.js
│   ├── invoices.js
│   ├── maintenance.js
│   └── settings.js
├── public/
│   └── index.html         ← Full web app UI
├── QUICKSTART.md          ← Fast deployment guide
├── DEPLOYMENT.md          ← Cloud hosting setup
├── DEVELOPMENT.md         ← Local development guide
└── README.md              ← Full documentation

---

## YOUR PROPERTIES (pre-loaded)

| Property           | Units    | Rent                        |
|--------------------|----------|-----------------------------|
| MT House 1         | 1 unit   | K2,000/month                |
| MT House 2         | 1 unit   | K1,500/month                |
| MT Boarding House 3| 8 rooms  | K600/month OR K300/fortnight|

Address for all: Independence Drive, Speedway, Top Town, Lae 411, Morobe Province, PNG

---

## DOCUMENT REFERENCE NUMBERS

- Leases:   MT-LA-2026-001, MT-LA-2026-002, ...
- Invoices: MT-INV-2026-001, MT-INV-2026-002, ...
- Receipts: MT-REC-2026-001, MT-REC-2026-002, ...

---

## BSP BANK DETAILS (pre-loaded in settings)

Account Name:   MAYEMOU TRADING (Anna Kuluwah)
Account Number: 1012414544
Account Type:   Cheque (CHQ)
Bank:           Bank South Pacific (BSP)
Branch:         BSP Top Town, Lae, Morobe Province

---

## MONTHLY WORKFLOW

1. Start of month/fortnight → Invoices tab → Generate Invoice for each tenant
2. When tenant pays → click Pay on the invoice → record amount, method, date
3. Log any issues → Maintenance tab → Log Request
4. Check dashboard anytime for overview

---

## EMAIL INTEGRATION (Already configured!)

✅ Gmail SMTP is ready to send invoices to tenants.
- Set GMAIL_USER and GMAIL_PASS in .env
- Go to Invoices tab → click "Email Invoice" to send HTML-formatted invoices
- Automated emails on cloud deployment via Render

---

Developed for Mayemou Trading, Lae, Morobe Province, PNG.
