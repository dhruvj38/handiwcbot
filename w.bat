@echo off
REM Start Whisper Server for Discord Bot
REM Usage: start_whisper.bat [model_size]
REM Example: start_whisper.bat medium

echo Starting Whisper Server...
echo.

REM Get model size from argument or default to medium
set MODEL=%1
if "%MODEL%"=="" set MODEL=medium

echo Model: %MODEL%
echo Device: CPU
echo Compute Type: int8 (optimized for CPU)
echo.
echo The server will be available at http://localhost:8000
echo Press Ctrl+C to stop the server
echo.

REM Set environment variables
set WHISPER_MODEL=%MODEL%
set WHISPER_DEVICE=cpu
set WHISPER_COMPUTE_TYPE=int8
set PORT=8000

REM Start the server (Python Whisper HTTP API)
python scripts\ws.py
