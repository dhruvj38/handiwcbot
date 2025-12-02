import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Config {
    // Discord
    discord: {
        token: string;
        clientId: string;
        guildId?: string;
    };

    // Database
    database: {
        url: string;
    };

    // AI Provider
    ai: {
        apiKey: string;
        baseUrl: string;
        models: {
            chat: string;
            embeddings: string;
        };
        maxTokens: number;
        temperature: number;
    };

    // Speech-to-Text (Local)
    speech: {
        serviceUrl: string;
        normalizeText: boolean;
    };

    // Bot Configuration
    bot: {
        prefix: string;
        personality: string;
        maxContextMessages: number;
        voiceChunkDurationMs: number;
        voiceSummaryIntervalMs: number;
        memoryRetrievalLimit: number;
    };

    // Logging
    logging: {
        level: string;
    };
}

function getEnvVar(key: string, defaultValue?: string): string {
    const value = process.env[key] || defaultValue;
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

function getEnvVarOptional(key: string): string | undefined {
    return process.env[key];
}

function getEnvVarNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    return value ? parseInt(value, 10) : defaultValue;
}

export const config: Config = {
    discord: {
        token: getEnvVar('DISCORD_TOKEN'),
        clientId: getEnvVar('DISCORD_CLIENT_ID'),
        guildId: getEnvVarOptional('DISCORD_GUILD_ID'),
    },

    database: {
        url: getEnvVar('DATABASE_URL'),
    },

    ai: {
        apiKey: getEnvVar('AI_API_KEY'),
        baseUrl: '', // Not needed for Google GenAI SDK
        models: {
            chat: getEnvVar('AI_MODEL_CHAT', 'gemini-2.0-flash'),
            embeddings: getEnvVar('AI_MODEL_EMBEDDINGS', 'text-embedding-004'),
        },
        maxTokens: getEnvVarNumber('AI_MAX_TOKENS', 2000),
        temperature: parseFloat(getEnvVar('AI_TEMPERATURE', '0.7')),
    },

    speech: {
        serviceUrl: getEnvVar('SPEECH_SERVICE_URL', 'http://localhost:8000/transcribe'),
        normalizeText: getEnvVar('SPEECH_NORMALIZE_TEXT', 'false') === 'true',
    },

    bot: {
        prefix: getEnvVar('BOT_PREFIX', '!'),
        personality: getEnvVar('BOT_PERSONALITY', 'friendly and helpful'),
        maxContextMessages: getEnvVarNumber('MAX_CONTEXT_MESSAGES', 50),
        voiceChunkDurationMs: getEnvVarNumber('VOICE_CHUNK_DURATION_MS', 30000),
        voiceSummaryIntervalMs: getEnvVarNumber('VOICE_SUMMARY_INTERVAL_MS', 300000),
        memoryRetrievalLimit: getEnvVarNumber('MEMORY_RETRIEVAL_LIMIT', 10),
    },

    logging: {
        level: getEnvVar('LOG_LEVEL', 'info'),
    },
};
