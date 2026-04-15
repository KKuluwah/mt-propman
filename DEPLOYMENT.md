# MT-PropMan Deployment Guide

## Overview
This property management app has been migrated from SQLite to PostgreSQL and is ready for cloud deployment. This guide covers deploying to **Render** (recommended) or similar Node.js/PostgreSQL platforms.

---

## Phase 1: Push to GitHub

### Prerequisites
- Git installed on your machine
- GitHub account and a new empty repository created

### Steps

1. **Initialize Git in your project** (if not already done):
   ```powershell
   cd c:\Mayemou\mt-propman
   git init
   git config user.name "Your Name"
   git config user.email "your.email@example.com"
   ```

2. **Check `.gitignore` exists** (should already include `node_modules/`, `.env`, etc.):
   ```powershell
   cat .gitignore
   ```
   If not, create one:
   ```
   node_modules/
   .env
   .env.local
   *.db
   public/uploads/*
   .DS_Store
   ```

3. **Stage and commit all files**:
   ```powershell
   git add .
   git commit -m "Initial commit: Migrate from SQLite to PostgreSQL"
   ```

4. **Add remote and push**:
   ```powershell
   git remote add origin https://github.com/YOUR_USERNAME/mt-propman.git
   git branch -M main
   git push -u origin main
   ```

5. **Verify on GitHub**: Visit https://github.com/YOUR_USERNAME/mt-propman and confirm files are there.

---

## Phase 2: Set Up PostgreSQL Database

### Option A: Render PostgreSQL (Recommended)
If deploying to Render, create a PostgreSQL database directly in their dashboard:
1. Log in to [render.com](https://render.com)
2. Click **New → PostgreSQL**
3. Set name: `mt-propman-db`
4. Select region closest to your users
5. Click **Create Database**
6. Copy the **Internal Connection String** (starts with `postgresql://`)
   - Example: `postgresql://user:password@host:5432/dbname`

### Option B: Local PostgreSQL (for testing)
If you have PostgreSQL installed locally:

1. **Start PostgreSQL service**:
   ```powershell
   pg_ctl -D "C:\Program Files\PostgreSQL\16\data" start
   ```

2. **Create a database**:
   ```powershell
   psql -U postgres -c "CREATE DATABASE mayemou_propman;"
   ```

3. **Verify connection**:
   ```powershell
   psql -U postgres -d mayemou_propman -c "\dt"
   ```

4. **Update `.env` locally**:
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mayemou_propman
   ```

5. **Test the app**:
   ```powershell
   npm install
   node server.js
   ```
   - Open http://localhost:3000 in your browser
   - Tables should auto-create on first startup

---

## Phase 3: Deploy to Render

### Prerequisites
- GitHub account with uploaded repository
- Render account ([render.com](https://render.com)) — sign up with GitHub
- PostgreSQL database created (see Phase 2 above)

### Deployment Steps

1. **Log in to Render** and go to the Dashboard.

2. **Create a new Web Service**:
   - Click **New → Web Service**
   - Select **Deploy from a Git Repository**
   - Authorize GitHub access if prompted

3. **Connect your repository**:
   - Find and select `mt-propman` from your GitHub repos
   - Click **Connect**

4. **Configure the Web Service**:
   | Setting | Value |
   |---------|-------|
   | **Name** | `mt-propman` (or your choice) |
   | **Region** | Choose your region |
   | **Branch** | `main` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `node server.js` |

5. **Add Environment Variables**:
   - Click **Environment** (before deploying)
   - Add these variables:
     ```
     PORT=3000
     NODE_ENV=production
     DATABASE_URL=[paste PostgreSQL connection string from Phase 2]
     GMAIL_USER=mayemoutrading4@gmail.com
     GMAIL_PASS=jafj kmig wdtk vqxx
     NODE_TLS_REJECT_UNAUTHORIZED=1
     ```
   - ⚠️ **Important**: Never commit `.env` to GitHub — Render reads from environment settings only.

6. **Click Deploy**:
   - Render will:
     - Clone your repository
     - Run `npm install`
     - Initialize the database (schema + seed data) on first deploy
     - Start the server
   - Monitor logs in the Render dashboard

7. **Access your app**:
   - Once deployment is complete, Render provides a URL: `https://mt-propman.onrender.com`
   - Your app is now live! 🎉

### Monitoring & Logs
- Dashboard → click your service → **Logs** tab to view real-time output
- If errors occur, check:
  - PostgreSQL connection string is correct
  - Gmail credentials are valid
  - Required environment variables are set

---

## Phase 4: Continuous Deployment

Once deployed, any future updates follow this workflow:

1. **Make code changes locally**:
   ```powershell
   cd c:\Mayemou\mt-propman
   # ... edit files ...
   ```

2. **Test locally** (optional, requires local PostgreSQL):
   ```powershell
   npm install
   node server.js
   ```

3. **Commit and push to GitHub**:
   ```powershell
   git add .
   git commit -m "Fix: description of changes"
   git push origin main
   ```

4. **Render automatically redeploys**:
   - Webhook triggers when you push to `main`
   - Render pulls latest code, runs build, and restarts the app
   - Check logs on the Render dashboard

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **"DATABASE_URL is required"** | Verify `DATABASE_URL` is set in Render environment variables. |
| **"Cannot find module 'pg'"** | Ensure `package.json` has `"pg": "^8.x.x"`. Run `npm install` locally and commit `package-lock.json`. |
| **Database connection timeout** | Check PostgreSQL connection string is correct. Ensure you copied the **Internal** string if on Render. |
| **"Connect ECONNREFUSED"** | PostgreSQL is not running. Start the service or check Render database status. |
| **Emails not sending** | Verify Gmail credentials in environment variables. Check if Gmail requires app-specific password. |

---

## File Structure After Deployment

```
mt-propman/
├── server.js                 # Express app entry point
├── package.json              # Dependencies (committed to GitHub)
├── .env.example              # Template (NO SECRETS — use Render env vars)
├── .gitignore                # Excludes node_modules, .env, etc.
├── database/
│   └── db.js                 # PostgreSQL pool, schema, helpers
├── middleware/
│   └── csrf.js               # CSRF protection
├── routes/
│   ├── settings.js
│   ├── properties.js
│   ├── tenants.js
│   ├── leases.js
│   ├── maintenance.js
│   └── invoices.js
├── public/
│   ├── index.html
│   ├── js/                   # Frontend code
│   ├── css/                  # Styles
│   └── uploads/              # User uploaded files (not committed)
└── README.txt                # Original notes
```

---

## Security Notes

1. **Never commit `.env`** — it contains credentials.
2. **Use Render environment variables** for all secrets (Gmail password, database credentials, API keys).
3. **For production**, consider:
   - Using a strong database password (not default `postgres`)
   - Enabling SSL for database connections (Render does this automatically)
   - Rotating Gmail app password periodically
   - Adding rate limiting for API endpoints
   - Using HTTPS only (Render provides free SSL)

---

## Next Steps

- **Local testing**: Install PostgreSQL locally and test the full app before final push.
- **Custom domain**: Add a custom domain to your Render service (paid feature).
- **Backups**: Enable automatic PostgreSQL backups in Render (under database settings).
- **Monitoring**: Set up Render alerts for service downtime.
- **Team access**: Invite team members to GitHub repo and Render dashboard.

---

For questions or issues, refer back to the relevant phase section above.
