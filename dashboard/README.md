# Mr. Handi WC Dashboard

A Next.js web dashboard for managing and monitoring your Discord bot.

## Features

- **Discord OAuth2 Authentication** - Secure login with Discord
- **Guild Selection** - Manage multiple servers where you have admin access
- **Configuration Management**
  - AI settings (model, temperature, tokens)
  - Voice settings (TTS, auto-join, chime-in)
  - Personality customization (name, traits, slang, emoji usage)
- **Activity Logs** - View all bot activity with filtering
- **Analytics** - Usage statistics, token usage, and cost tracking
- **Memory Browser** - View learned server memories and user profiles

## Setup

### Prerequisites

- Node.js 18+
- Bot API server running (port 3000 by default)

### Installation

```bash
# From the dashboard directory
npm install
```

### Configuration

Create `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Development

```bash
npm run dev
```

The dashboard will be available at http://localhost:3001

### Production Build

```bash
npm run build
npm start
```

## Architecture

- **Frontend**: Next.js 14 with App Router
- **Styling**: Tailwind CSS with custom dark theme
- **State Management**: TanStack Query (React Query)
- **Charts**: Recharts
- **Icons**: Lucide React

## Pages

| Route | Description |
|-------|-------------|
| `/` | Redirects to guild selection or login |
| `/login` | Discord OAuth login |
| `/guilds` | Guild selection page |
| `/guilds/[id]` | Guild overview dashboard |
| `/guilds/[id]/personality` | Personality customization |
| `/guilds/[id]/ai` | AI model settings |
| `/guilds/[id]/voice` | Voice and TTS settings |
| `/guilds/[id]/memory` | Memory and learning browser |
| `/guilds/[id]/logs` | Activity logs |
| `/guilds/[id]/analytics` | Usage analytics |

## API Endpoints Used

The dashboard communicates with the bot's API server:

- `GET/POST /api/auth/*` - Authentication
- `GET/PATCH /api/guilds/:id/config` - Guild configuration
- `GET /api/guilds/:id/logs` - Activity logs
- `GET /api/guilds/:id/metrics` - Usage metrics
- `GET/PATCH/DELETE /api/guilds/:id/personality` - Personality settings
