# Discord Memory Bot

A production-ready Discord bot that provides natural language interaction, voice chat logging, and long-term memory about server culture, members, and conversations.

## Features

- 🗣️ **Natural Chat Interaction**: Responds to mentions with context-aware, personality-driven responses
- 🎙️ **Voice Logging**: Joins voice channels and transcribes conversations in real-time
- 🧠 **Long-term Memory**: Builds and maintains memories about:
  - Server culture, memes, and running jokes
  - Individual member personalities and preferences
  - Important events, plans, and decisions
- 🔍 **Semantic Search**: Vector-based memory retrieval using pgvector
- 💬 **Slash Commands**: Easy-to-use commands for managing voice logging and viewing memories

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js LTS
- **Discord**: discord.js v14 + @discordjs/voice
- **Database**: PostgreSQL with pgvector extension
- **ORM**: Prisma
- **AI**: OpenAI-compatible API (abstracted for easy swapping)
- **Speech-to-Text**: Whisper-compatible API (abstracted)

## Prerequisites

- Node.js 18 or higher
- PostgreSQL 14+ with pgvector extension
- Discord Bot Token
- OpenAI API key (or compatible provider)

## Setup

### 1. Clone and Install Dependencies

```bash
# Install dependencies (using npm or pnpm)
npm install
# or
pnpm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your configuration:

```bash
cp .env.example .env
```

Required variables:
- `DISCORD_TOKEN`: Your Discord bot token
- `DISCORD_CLIENT_ID`: Your Discord application client ID
- `DATABASE_URL`: PostgreSQL connection string
- `AI_API_KEY`: OpenAI API key (or compatible provider)
- `SPEECH_API_KEY`: Speech-to-text API key

Optional variables:
- `DISCORD_GUILD_ID`: For faster command registration during development
- `AI_BASE_URL`: Custom AI provider endpoint
- `SPEECH_BASE_URL`: Custom speech provider endpoint

### 3. Setup Database

Ensure PostgreSQL is running and the pgvector extension is available:

```sql
CREATE DATABASE discord_bot;
\c discord_bot
CREATE EXTENSION vector;
```

Run Prisma migrations:

```bash
npm run prisma:migrate
# or
npx prisma migrate dev
```

Generate Prisma client:

```bash
npm run prisma:generate
```

### 4. Build and Run

Development mode (with hot reload):
```bash
npm run dev
```

Production build:
```bash
npm run build
npm start
```

## Usage

### Text Chat

Mention the bot in any text channel:
```
@BotName What's happening in the server?
@BotName Tell me about @User
```

The bot will:
1. Fetch recent channel messages for context
2. Retrieve relevant memories from the database
3. Generate a contextual response using AI
4. Respond naturally in the conversation

### Voice Logging

Start logging a voice channel:
```
/voice_logger start channel:#voice-channel
```

Stop logging:
```
/voice_logger stop
```

When active, the bot will:
- Join the specified voice channel
- Transcribe conversations in real-time
- Store transcripts in the database
- Periodically summarize conversations
- Update server memories and user profiles

### Memory Management

View server memory summary:
```
/server_memory summary
```

View user profile:
```
/server_memory user @User
```

Search memories:
```
/server_memory search query:game night plans
```

## Project Structure

```
handiwcbot/
├── src/
│   ├── config/           # Configuration and environment variables
│   ├── db/               # Database client and Prisma setup
│   ├── discord/          # Discord client and event handlers
│   │   ├── commands/     # Slash command definitions and handlers
│   │   └── voice/        # Voice session management
│   ├── services/         # Business logic layer
│   │   ├── ai/          # AI service (LLM, embeddings)
│   │   ├── memory/      # Memory storage and retrieval
│   │   └── speech/      # Speech-to-text service
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions (logging, retry logic)
│   └── index.ts         # Main entry point
├── prisma/
│   └── schema.prisma    # Database schema
├── package.json
├── tsconfig.json
└── .env.example
```

## Database Schema

### ServerMemory
Stores server-level memories (events, memes, rules, plans, habits)

### UserProfile
Stores user personality profiles, preferences, and tags

### TranscriptChunk
Stores raw voice transcripts with timestamps

### SessionSummary
Stores summarized voice sessions with extracted insights

All tables support vector embeddings for semantic search using pgvector.

## Configuration

### AI Provider

The bot uses an abstracted AI service that's compatible with OpenAI's API. To use a different provider:

1. Update `AI_BASE_URL` in `.env`
2. Ensure the provider implements OpenAI-compatible endpoints
3. Adjust `AI_MODEL_CHAT` and `AI_MODEL_EMBEDDINGS` as needed

### Speech Provider

Similarly, the speech service is abstracted and Whisper-compatible:

1. Update `SPEECH_BASE_URL` in `.env`
2. Ensure the provider implements Whisper-compatible endpoints
3. Adjust `SPEECH_MODEL` as needed

### Bot Behavior

Customize bot behavior via environment variables:
- `BOT_PERSONALITY`: Personality description for chat responses
- `MAX_CONTEXT_MESSAGES`: Number of messages to include in context
- `VOICE_CHUNK_DURATION_MS`: Audio chunk duration for transcription
- `VOICE_SUMMARY_INTERVAL_MS`: How often to summarize voice sessions
- `MEMORY_RETRIEVAL_LIMIT`: Number of memories to retrieve per query

## Development

### Database Management

View database with Prisma Studio:
```bash
npm run prisma:studio
```

Create a new migration:
```bash
npm run prisma:migrate
```

Reset database:
```bash
npx prisma migrate reset
```

### Testing

Run unit tests:
```bash
npm test
```

### Linting and Formatting

```bash
npm run lint
npm run format
```

## Error Handling

The bot implements comprehensive error handling:

- **Retry Logic**: External API calls (AI, speech) use exponential backoff
- **Graceful Degradation**: If AI/speech services fail, the bot continues running
- **Logging**: All errors are logged with Winston to files and console
- **User Feedback**: Users receive helpful error messages when commands fail

## Privacy and Consent

**Important**: This bot logs voice and text activity. By default, it assumes all users in the server have consented to this data collection. Ensure you have proper consent mechanisms in place before deploying this bot to a server with users.

## License

MIT

## Support

For issues, questions, or contributions, please open an issue on the project repository.
