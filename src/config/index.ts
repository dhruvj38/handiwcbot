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
            chat: string;      // Fast model for responses (gemini-2.0-flash)
            analysis: string;  // Pro model for deep server analysis
            embeddings: string;
        };
        providers: {
            chat: 'google' | 'openai';
            voice: 'google' | 'openai';
        };
        openaiApiKey: string;
        openaiModels: {
            chat: string;
            voice: string;
        };
        maxTokens: number;
        temperature: number;
    };

    // Speech-to-Text
    speech: {
        provider: 'local' | 'groq';
        serviceUrl: string;
        groqApiKey: string;
        normalizeText: boolean;
    };

    // Text-to-Speech (ElevenLabs)
    tts: {
        enabled: boolean;
        apiKey: string;        // ElevenLabs API key
        model: string;         // ElevenLabs model (eleven_flash_v2_5, eleven_multilingual_v2, etc.)
        voiceId: string;       // ElevenLabs voice ID
    };

    // Voice Chat Behavior (defaults for new guilds)
    voiceChat: {
        autoJoinEnabled: boolean;     // Auto-join popular VCs
        minMembersToJoin: number;     // Min non-bot members to trigger auto-join
        chimeInEnabled: boolean;      // Enable chiming in to conversations
        chimeInChance: number;        // 0-1, chance to chime in when relevant
        minSecondsBetweenChimes: number;
        maxResponseLength: number;    // Max chars for voice responses
    };

    // Bot Configuration
    bot: {
        prefix: string;
        maxContextMessages: number;
        voiceChunkDurationMs: number;
        voiceSummaryIntervalMs: number;
        memoryRetrievalLimit: number;
    };

    // Realtime Learning
    learning: {
        enabled: boolean;
        batchSize: number;
        batchTimeoutMs: number;
        personalityUpdateIntervalMs: number;
        consolidationIntervalMs: number;
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
            analysis: getEnvVar('AI_MODEL_ANALYSIS', 'gemini-3-pro-preview'), // Pro model for deep learning
            embeddings: getEnvVar('AI_MODEL_EMBEDDINGS', 'text-embedding-004'),
        },
        providers: {
            chat: getEnvVar('AI_CHAT_PROVIDER', 'google') as 'google' | 'openai',
            voice: getEnvVar('AI_VOICE_PROVIDER', 'google') as 'google' | 'openai',
        },
        openaiApiKey: getEnvVarOptional('OPENAI_API_KEY') || '',
        openaiModels: {
            chat: getEnvVar('AI_OPENAI_MODEL_CHAT', 'gpt-4o'),
            voice: getEnvVar('AI_OPENAI_MODEL_VOICE', 'gpt-4o'),
        },
        maxTokens: getEnvVarNumber('AI_MAX_TOKENS', 8192),
        temperature: parseFloat(getEnvVar('AI_TEMPERATURE', '0.7')),
    },

    speech: {
        provider: (getEnvVar('SPEECH_PROVIDER', 'groq') as 'local' | 'groq'),
        serviceUrl: getEnvVar('SPEECH_SERVICE_URL', 'http://localhost:8000/transcribe'),
        groqApiKey: process.env['GROQ_API_KEY'] || '',
        normalizeText: getEnvVar('SPEECH_NORMALIZE_TEXT', 'false') === 'true',
    },

    tts: {
        enabled: getEnvVar('TTS_ENABLED', 'false') === 'true',
        apiKey: getEnvVar('ELEVENLABS_API_KEY', ''),
        model: getEnvVar('TTS_MODEL', 'eleven_flash_v2_5'),
        voiceId: getEnvVar('TTS_VOICE_ID', 'JBFqnCBsd6RMkjVDRZzb'), // George - deep male voice
    },

    voiceChat: {
        autoJoinEnabled: getEnvVar('VOICE_AUTO_JOIN_ENABLED', 'true') === 'true',
        minMembersToJoin: getEnvVarNumber('VOICE_MIN_MEMBERS_TO_JOIN', 2),
        chimeInEnabled: getEnvVar('VOICE_CHIME_IN_ENABLED', 'true') === 'true',
        chimeInChance: parseFloat(getEnvVar('VOICE_CHIME_IN_CHANCE', '0.15')), // 15% chance
        minSecondsBetweenChimes: getEnvVarNumber('VOICE_MIN_SECONDS_BETWEEN_CHIMES', 60),
        maxResponseLength: getEnvVarNumber('VOICE_MAX_RESPONSE_LENGTH', 200),
    },

    bot: {
        prefix: getEnvVar('BOT_PREFIX', '!'),
        maxContextMessages: getEnvVarNumber('MAX_CONTEXT_MESSAGES', 50),
        voiceChunkDurationMs: getEnvVarNumber('VOICE_CHUNK_DURATION_MS', 5000),
        voiceSummaryIntervalMs: getEnvVarNumber('VOICE_SUMMARY_INTERVAL_MS', 300000),
        memoryRetrievalLimit: getEnvVarNumber('MEMORY_RETRIEVAL_LIMIT', 10),
    },

    learning: {
        enabled: getEnvVar('LEARNING_ENABLED', 'true') === 'true',
        batchSize: getEnvVarNumber('LEARNING_BATCH_SIZE', 20),
        batchTimeoutMs: getEnvVarNumber('LEARNING_BATCH_TIMEOUT_MS', 60000),
        personalityUpdateIntervalMs: getEnvVarNumber('LEARNING_PERSONALITY_UPDATE_MS', 300000),
        consolidationIntervalMs: getEnvVarNumber('LEARNING_CONSOLIDATION_MS', 3600000),
    },

    logging: {
        level: getEnvVar('LOG_LEVEL', 'info'),
    },
};
