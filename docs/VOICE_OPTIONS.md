# ElevenLabs TTS Voice Options

This bot uses **ElevenLabs** for text-to-speech, providing ultra-realistic, natural-sounding AI voices.

## Available Voices

ElevenLabs offers hundreds of voices. Here are some popular prebuilt options:

### 🎤 **George** (Male) ⭐ **DEFAULT**
- **Voice ID**: `JBFqnCBsd6RMkjVDRZzb`
- **Characteristics**: Deep, authoritative, warm
- **Best for**: Professional, confident presence

### 🗣️ **Rachel** (Female)
- **Voice ID**: `21m00Tcm4TlvDq8ikWAM`
- **Characteristics**: Clear, articulate, professional
- **Best for**: Narration, announcements

### 🎭 **Bella** (Female)
- **Voice ID**: `EXAVITQu4vr4xnSDxMaL`
- **Characteristics**: Warm, friendly, approachable
- **Best for**: Casual, friendly conversations

### 🎺 **Antoni** (Male)
- **Voice ID**: `ErXwobaYiN019PkySvjV`
- **Characteristics**: Friendly, conversational
- **Best for**: Casual chat, engaging discussions

### 🎵 **Elli** (Female)
- **Voice ID**: `MF3mGyEYCl7XYWbV9V6O`
- **Characteristics**: Expressive, youthful
- **Best for**: Dynamic, energetic content

Browse all voices at: https://elevenlabs.io/app/voice-library

## Configuration

1. Get your API key from https://elevenlabs.io/app/settings/api-keys
2. Update your `.env` file:

```env
ELEVENLABS_API_KEY=your_api_key_here
TTS_ENABLED=true
TTS_MODEL=eleven_flash_v2_5
TTS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
```

### Configuration Options

- **`ELEVENLABS_API_KEY`**: Your ElevenLabs API key (required)
- **`TTS_MODEL`**: ElevenLabs model to use
- **`TTS_VOICE_ID`**: Voice ID from ElevenLabs voice library

### Model Options

- **`eleven_flash_v2_5`** ⭐ **RECOMMENDED**
  - Fastest, lowest latency (~75ms)
  - Best for real-time voice chat
  - Great quality with minimal cost

- **`eleven_multilingual_v2`**
  - Best quality for 29 languages
  - Slightly higher latency
  - Best for multi-language support

- **`eleven_turbo_v2_5`**
  - Optimized for low latency
  - English-focused
  - Great for English-only bots

## Finding Voice IDs

1. Visit https://elevenlabs.io/app/voice-library
2. Browse or search for a voice
3. Click on a voice to view its details
4. Copy the Voice ID from the URL or settings

You can also use the `/voice list` command (if implemented) to see available voices.

## Testing Your Voice

After configuring, test the voice by:

1. **Join a voice channel** with the bot
2. **Mention the bot** or trigger a voice response
3. **Listen** to verify the voice sounds good
4. **Try different voices** by changing `TTS_VOICE_ID`

## Tips for Natural Speech

1. **Keep responses short**: Set `VOICE_MAX_RESPONSE_LENGTH=200` to avoid long speeches
2. **Match the voice to your bot**: Choose a voice that fits your bot's personality
3. **Use Flash model**: `eleven_flash_v2_5` provides the best latency for real-time chat
4. **Clone your own voice**: ElevenLabs lets you create custom voices!

## Troubleshooting

### Bot not speaking
- Check `TTS_ENABLED=true` in your `.env`
- Verify `ELEVENLABS_API_KEY` is set and valid
- Check console for TTS errors
- Ensure you have API credits remaining

### Audio quality issues
- Try a different `TTS_MODEL` (e.g., `eleven_multilingual_v2`)
- Try a different voice

### Rate limiting
- ElevenLabs has rate limits based on your plan
- Consider upgrading your plan for higher limits
- Use shorter responses to reduce API calls

## Pricing

ElevenLabs offers various plans:
- **Free**: ~10,000 characters/month
- **Starter**: More characters + more features
- **Creator/Pro**: Higher limits + commercial use

Check https://elevenlabs.io/pricing for current pricing.
