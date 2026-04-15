# Quick Reference — Deploy to Production

## 5-Minute Deployment Checklist

### Step 1: GitHub
```powershell
cd c:\Mayemou\mt-propman
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/mt-propman.git
git push -u origin main
```

### Step 2: PostgreSQL
Go to [render.com](https://render.com):
- Dashboard → **New → PostgreSQL**
- Create database, copy **Internal Connection String**
- Example: `postgresql://user:pass@host.render.com:5432/dbname`

### Step 3: Deploy
On Render:
- Dashboard → **New → Web Service**
- Connect GitHub repo `mt-propman`
- **Settings**:
  - Build: `npm install`
  - Start: `node server.js`
- **Environment Variables**:
  ```
  DATABASE_URL=[paste from Step 2]
  GMAIL_USER=mayemoutrading4@gmail.com
  GMAIL_PASS=jafj kmig wdtk vqxx
  PORT=3000
  NODE_ENV=production
  NODE_TLS_REJECT_UNAUTHORIZED=1
  ```
- Click **Deploy**

### Step 4: Done!
- Wait for build to complete (~2-3 min)
- Render gives you a URL: `https://mt-propman.onrender.com`
- Your app is live! 🎉

---

## Future Updates (Continuous Deployment)

```powershell
cd c:\Mayemou\mt-propman
# Make changes...
git add .
git commit -m "Fix: description"
git push origin main
# Render automatically redeploys!
```

---

## Local Testing (Before Deploy)

```powershell
# Start PostgreSQL
pg_ctl -D "C:\Program Files\PostgreSQL\16\data" start

# Install & run
npm install
node server.js

# Open http://localhost:3000
```

---

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| **"DATABASE_URL required"** | Set in Render → Environment Variables |
| **Database connection fails** | Copy **Internal** connection string, not External |
| **"Cannot find module pg"** | Ensure `package.json` has `"pg"` in dependencies |
| **Build fails on Render** | Check Render logs, usually dependency or env var issue |
| **Emails not sending** | Verify Gmail credentials in Render environment |

---

## Monitoring

- View logs: Render Dashboard → Your Service → **Logs**
- Check uptime: Render Dashboard → Incidents
- Monitor database: Render Dashboard → Your Database → **Insights**

---

## Backup & Security

- Render auto-backups PostgreSQL (check settings)
- Never commit `.env` to Git
- Rotate Gmail password quarterly
- Use strong database passwords in production

---

## Need Help?

- [DEVELOPMENT.md](./DEVELOPMENT.md) — Local setup
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Full deployment guide
- [README.md](./README.md) — Project overview
- Render Docs: https://render.com/docs
