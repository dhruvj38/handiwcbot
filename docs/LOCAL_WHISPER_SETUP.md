# Local Whisper Setup Guide

This document explains how to set up and use the local Whisper server for speech-to-text transcription.

## Overview

The bot supports two STT providers:
1. **Groq API** (cloud-based, free, fast but less accurate)
2. **Local Whisper** (self-hosted, better quality, requires Python)

This guide covers the **Local Whisper** setup, which uses `faster-whisper` for optimal performance.

## Installation

### 1. Install Python Dependencies

The following packages have been installed:
```bash
pip install openai-whisper faster-whisper flask
```

These provide:
- `openai-whisper` - Original OpenAI Whisper model
- `faster-whisper` - Optimized Whisper implementation (faster, lower memory)
- `flask` - HTTP server for the transcription API

### 2. Start the Whisper Server

Use the convenience script:
```bash
start_whisper.bat [model_size]
```

Available model sizes (small to large):
- `tiny` - Fastest, least accurate (~39M params)
- `base` - Fast, decent accuracy (~74M params)
- `small` - Balanced (~244M params)
- **`medium`** - Recommended for quality/speed balance (~769M params) ⭐
- `large-v2` - Best accuracy but slow (~1550M params)
- `large-v3` - Latest, best accuracy (~1550M params)

**Default**: `medium` (recommended)

**Example**:
```bash
# Start with default (medium) model
start_whisper.bat

# Start with small model (faster)
start_whisper.bat small

# Start with large-v3 model (best quality)
start_whisper.bat large-v3
```

### 3. Configure the Bot

In your `.env` file, set:
```env
# Speech Provider
SPEECH_PROVIDER=local

# Local Whisper Server URL
SPEECH_SERVICE_URL=http://localhost:8000/transcribe

# Optional: Normalize transcripts (removes fillers, collapses repetition)
SPEECH_NORMALIZE_TEXT=false
```

> **Note**: If using Groq instead, set `SPEECH_PROVIDER=groq` and provide `GROQ_API_KEY`

### 4. Start the Bot

In a separate terminal:
```bash
npm run dev
```

## Usage

Once both the Whisper server and bot are running:

1. Join a voice channel on Discord
2. Use the `/voice_logger start` command
3. The bot will transcribe conversations in real-time

## Server Endpoints

The Whisper server provides two endpoints:

### Health Check
```
GET http://localhost:8000/health
```
Returns server status and loaded model name.

### Transcribe
```
POST http://localhost:8000/transcribe
```
**Request**:
- Content-Type: `multipart/form-data`
- Field: `file` (audio file in opus, wav, mp3, etc.)
- Optional: `response_format` (`json` or `verbose_json`)

**Response** (verbose_json):
```json
{
  "text": "Transcribed text here",
  "confidence": 0.98,
  "language": "en",
  "duration": 5.2
}
```

## Performance Tips

### CPU vs GPU
- By default, the server uses CPU with `int8` quantization (optimized for speed)
- If you have an NVIDIA GPU, edit `start_whisper.bat`:
  ```bat
  set WHISPER_DEVICE=cuda
  set WHISPER_COMPUTE_TYPE=float16
  ```

### Model Selection
- **Development/Testing**: Use `tiny` or `base` for fast iteration
- **Production**: Use `medium` for best balance
- **Maximum Quality**: Use `large-v3` if you have powerful hardware

### Memory Requirements
Approximate RAM usage:
- `tiny`: ~1 GB
- `base`: ~1 GB
- `small`: ~2 GB
- `medium`: ~5 GB
- `large-v2/v3`: ~10 GB

## Troubleshooting

### Server Won't Start
- **Issue**: `ModuleNotFoundError: No module named 'faster_whisper'`
- **Fix**: Run `pip install faster-whisper flask`

### High CPU Usage
- **Issue**: Transcription is slow and CPU is maxed out
- **Fix**: Try a smaller model (`small` or `base`)

### Bot Can't Connect
- **Issue**: Bot logs show "Failed to transcribe with local Whisper"
- **Fix**: 
  1. Verify the Whisper server is running (`http://localhost:8000/health`)
  2. Check `SPEECH_SERVICE_URL` in `.env` matches the server URL

### Poor Transcription Quality
- **Issue**: Transcriptions have many errors
- **Fix**: 
  1. Use a larger model (`medium` or `large-v3`)
  2. Ensure audio quality is good (Discord voice quality settings)

## Auto-Start on Boot (Optional)

### Windows Task Scheduler
1. Open Task Scheduler
2. Create Basic Task: "Whisper Server"
3. Trigger: "When I log on"
4. Action: "Start a program"
5. Program: `C:\Users\[YourUser]\Documents\handiwcbot\start_whisper.bat`

### Linux systemd
Create `/etc/systemd/system/whisper-server.service`:
```ini
[Unit]
Description=Whisper STT Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/handiwcbot
ExecStart=/usr/bin/python3 scripts/whisper_server.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable whisper-server
sudo systemctl start whisper-server
```

## Alternative: Using Groq (Cloud)

If you prefer not to run a local server:

1. Sign up for a free Groq account: https://console.groq.com
2. Get your API key
3. Update `.env`:
   ```env
   SPEECH_PROVIDER=groq
   GROQ_API_KEY=your_groq_api_key_here
   ```

Groq uses `whisper-large-v3-turbo` and is **very fast** and **free**, but might have rate limits.
