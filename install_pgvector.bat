@echo off
echo Installing pgvector for PostgreSQL...
echo.
echo This script will download and install pgvector extension.
echo Make sure PostgreSQL is installed first!
echo.
pause

REM Check if git is installed
where git >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Git is not installed. Please install Git first.
    echo Download from: https://git-scm.com/download/win
    pause
    exit /b 1
)

REM Check if Visual Studio is installed
where cl >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Visual Studio C++ compiler not found.
    echo You need to install "Visual Studio Build Tools"
    echo Download from: https://visualstudio.microsoft.com/downloads/
    echo Select "Desktop development with C++"
    pause
    exit /b 1
)

REM Clone pgvector
cd %TEMP%
if exist pgvector rmdir /s /q pgvector
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector

REM Set PostgreSQL path (adjust version if needed)
set PGROOT=C:\Program Files\PostgreSQL\16

REM Build and install
nmake /F Makefile.win
nmake /F Makefile.win install

echo.
echo pgvector installed successfully!
echo.
pause
