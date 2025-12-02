# Setup Discord Bot Database
# Run this script AFTER installing PostgreSQL

Write-Host "=== Discord Bot Database Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if PostgreSQL is installed
$pgVersions = @("16", "15", "14", "13")
$psqlPath = $null

foreach ($version in $pgVersions) {
    $testPath = "C:\Program Files\PostgreSQL\$version\bin\psql.exe"
    if (Test-Path $testPath) {
        $psqlPath = $testPath
        Write-Host "Found PostgreSQL $version at: $testPath" -ForegroundColor Green
        break
    }
}

if (-not $psqlPath) {
    Write-Host "ERROR: PostgreSQL not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install PostgreSQL first:" -ForegroundColor Yellow
    Write-Host "1. Download from: https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    Write-Host "2. Run the installer" -ForegroundColor Yellow
    Write-Host "3. Remember your postgres password!" -ForegroundColor Yellow
    Write-Host "4. Then run this script again" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "PostgreSQL found! Setting up database..." -ForegroundColor Green
Write-Host ""

# Get password
$password = Read-Host "Enter your PostgreSQL postgres password" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

# Set environment variable for password
$env:PGPASSWORD = $plainPassword

# Create database
Write-Host "Creating database 'discord_bot'..." -ForegroundColor Cyan
& $psqlPath -U postgres -h localhost -c "CREATE DATABASE discord_bot;" 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Database created successfully!" -ForegroundColor Green
} else {
    Write-Host "✓ Database already exists (this is fine)" -ForegroundColor Yellow
}

# Enable pgvector extension
Write-Host "Enabling pgvector extension..." -ForegroundColor Cyan
& $psqlPath -U postgres -h localhost -d discord_bot -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ pgvector extension enabled!" -ForegroundColor Green
} else {
    Write-Host "⚠ Could not enable pgvector. You may need to install it manually." -ForegroundColor Yellow
}

# Verify setup
Write-Host ""
Write-Host "Verifying database setup..." -ForegroundColor Cyan
$result = & $psqlPath -U postgres -h localhost -d discord_bot -c "\dx" 2>&1

if ($result -match "vector") {
    Write-Host "✓ Setup complete! pgvector is installed." -ForegroundColor Green
} else {
    Write-Host "⚠ Setup complete, but pgvector may not be installed." -ForegroundColor Yellow
}

# Clear password from environment
$env:PGPASSWORD = $null

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your DATABASE_URL for .env file:" -ForegroundColor Yellow
Write-Host "DATABASE_URL=postgresql://postgres:$plainPassword@localhost:5432/discord_bot" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Copy the DATABASE_URL above to your .env file" -ForegroundColor White
Write-Host "2. Run: npm install" -ForegroundColor White
Write-Host "3. Run: npm run prisma:generate" -ForegroundColor White
Write-Host "4. Run: npm run prisma:migrate" -ForegroundColor White
Write-Host ""

Read-Host "Press Enter to exit"
