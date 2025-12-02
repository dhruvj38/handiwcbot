# PostgreSQL Setup Instructions for Windows

## Quick Installation Steps

### 1. Download PostgreSQL Installer
- Visit: https://www.postgresql.org/download/windows/
- Click "Download the installer"
- Choose latest version (PostgreSQL 16 recommended)
- Download the `.exe` file (~250 MB)

### 2. Run Installer
1. Double-click the downloaded installer
2. Installation settings:
   - **Directory**: Default (`C:\Program Files\PostgreSQL\16\`)
   - **Components**: Select all (Server, pgAdmin 4, Command Line Tools, Stack Builder)
   - **Password**: Choose and **REMEMBER** your postgres superuser password
   - **Port**: 5432 (default)
   - **Locale**: Default

### 3. Create Database for Bot

After installation, open **SQL Shell (psql)** from Start menu:

```
Server [localhost]:          (press Enter)
Database [postgres]:         (press Enter)
Port [5432]:                 (press Enter)
Username [postgres]:         (press Enter)
Password:                    (enter your password)
```

Then run these commands:

```sql
-- Create the database
CREATE DATABASE discord_bot;

-- Connect to it
\c discord_bot

-- Enable pgvector extension
CREATE EXTENSION vector;

-- Verify it's installed
\dx
```

You should see `vector` in the list of extensions.

### 4. Get Your Database URL

Your `DATABASE_URL` for the `.env` file will be:

```
postgresql://postgres:YOUR_PASSWORD@localhost:5432/discord_bot
```

Replace `YOUR_PASSWORD` with the password you set during installation.

## Troubleshooting

### pgvector Extension Not Available

If `CREATE EXTENSION vector;` fails, you need to install pgvector manually:

**Option 1: Pre-built binaries**
- Download from: https://github.com/pgvector/pgvector/releases
- Extract to PostgreSQL installation directory
- Restart PostgreSQL service

**Option 2: Build from source** (requires Visual Studio)
- Run the `install_pgvector.bat` script provided

### Can't Connect to Database

1. Check PostgreSQL service is running:
   - Open Services (Win+R, type `services.msc`)
   - Find "postgresql-x64-16" (or your version)
   - Status should be "Running"
   - If not, right-click → Start

2. Verify port 5432 is open:
   ```
   netstat -an | findstr 5432
   ```

### Forgot postgres Password

1. Stop PostgreSQL service
2. Edit `pg_hba.conf` (in `C:\Program Files\PostgreSQL\16\data\`)
3. Change `md5` to `trust` for local connections
4. Restart service
5. Connect without password and reset:
   ```sql
   ALTER USER postgres WITH PASSWORD 'new_password';
   ```
6. Revert `pg_hba.conf` back to `md5`
7. Restart service again

## Next Steps

Once PostgreSQL is installed and the database is created:

1. Update your `.env` file with the DATABASE_URL
2. Run database migrations:
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

3. Verify with Prisma Studio:
   ```bash
   npm run prisma:studio
   ```

## Useful Commands

```bash
# Start PostgreSQL service
net start postgresql-x64-16

# Stop PostgreSQL service
net stop postgresql-x64-16

# Connect to database
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d discord_bot

# Backup database
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U postgres discord_bot > backup.sql

# Restore database
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres discord_bot < backup.sql
```

## Installation Complete! ✅

Your PostgreSQL is ready. Proceed to the next step in the main setup guide.
