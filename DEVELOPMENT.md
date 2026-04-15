# Local Development Setup

## Quick Start

1. **Install PostgreSQL** (if not already installed):
   - Windows: Download from https://www.postgresql.org/download/windows/
   - During installation, note the password you set for the `postgres` user

2. **Clone and navigate to the project**:
   ```powershell
   cd c:\Mayemou\mt-propman
   ```

3. **Install Node dependencies**:
   ```powershell
   npm install
   ```

4. **Create PostgreSQL database**:
   ```powershell
   psql -U postgres -c "CREATE DATABASE mayemou_propman;"
   ```

5. **Configure `.env`** (if not already set):
   ```powershell
   # Verify or create .env file with:
   # (copy from .env.example and fill in values)
   
   # For local development with default PostgreSQL:
   # DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/mayemou_propman
   ```

6. **Start the server**:
   ```powershell
   node server.js
   ```

7. **Open in browser**:
   - http://localhost:3000

---

## Common Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install/update dependencies |
| `npm start` | Start the server (uses `node server.js`) |
| `npm test` | Run tests (if configured) |
| `npm audit` | Check for security vulnerabilities |
| `npm audit fix` | Auto-fix minor vulnerabilities |

---

## Database Management

### Connect to the database:
```powershell
psql -U postgres -d mayemou_propman
```

### View all tables:
```
\dt
```

### Drop and recreate the database:
```powershell
psql -U postgres -c "DROP DATABASE IF EXISTS mayemou_propman;"
psql -U postgres -c "CREATE DATABASE mayemou_propman;"
node server.js  # Re-initializes schema
```

### Backup the database:
```powershell
pg_dump -U postgres -d mayemou_propman > backup.sql
```

### Restore from backup:
```powershell
psql -U postgres -d mayemou_propman < backup.sql
```

---

## Stopping PostgreSQL

### Windows (PowerShell as Admin):
```powershell
pg_ctl -D "C:\Program Files\PostgreSQL\16\data" stop
```

Or use Services → stop "postgresql-x64-16" service.

---

## Environment Variables

See `.env.example` for all available configuration options.

**Key variables for development**:
- `DATABASE_URL`: PostgreSQL connection string
- `GMAIL_USER` / `GMAIL_PASS`: Gmail SMTP credentials (for email features)
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Set to `development` or `production`

---

## Troubleshooting

**"psql: error: connection to server at 'localhost' (::1), port 5432 failed"**
- PostgreSQL service is not running
- Start it from Services or command line:
  ```powershell
  pg_ctl -D "C:\Program Files\PostgreSQL\16\data" start
  ```

**"Cannot find module 'pg'"**
- Dependencies not installed
- Run: `npm install`

**"Database 'mayemou_propman' does not exist"**
- Create it first:
  ```powershell
  psql -U postgres -c "CREATE DATABASE mayemou_propman;"
  ```

**Server crashes on startup**
- Check `.env` file has `DATABASE_URL` set correctly
- Verify PostgreSQL is running and accessible

---

## Next: Push to GitHub & Deploy

Once everything works locally, follow [DEPLOYMENT.md](./DEPLOYMENT.md) to:
1. Push code to GitHub
2. Deploy to Render (or similar platform)
3. Set up continuous deployment

