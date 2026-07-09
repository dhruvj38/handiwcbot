import { logger } from './utils/logger';
import { getPrismaClient, enablePgVector, disconnectDatabase } from './db/client';
import { AiService } from './services/ai/AiService';
import { LocalSpeechService } from './services/speech/SpeechService';
import { TtsService, setTtsService } from './services/speech/TtsService';
import { config } from './config';
import { MemoryRepository } from './services/memory/MemoryRepository';
import { MemoryService } from './services/memory/MemoryService';
import { RealtimeLearningService } from './services/learning/RealtimeLearningService';
import { MemoryConsolidationService } from './services/learning/MemoryConsolidationService';
import { DiscordClient } from './discord/client';
import { VoiceSessionManager } from './discord/voice/VoiceSessionManager';
import { CommandHandler } from './discord/commands/CommandHandler';
import { registerCommands } from './discord/commands/register';
import { Events } from 'discord.js';
import { execSync } from 'child_process';
import { startApiServer, stopApiServer } from './api/server';

// Check FFmpeg availability for voice audio playback
function checkFFmpeg(): boolean {
    try {
        // Try to use ffmpeg-static first
        try {
            const ffmpegPath = require('ffmpeg-static');
            if (ffmpegPath) {
                logger.info(`FFmpeg found (ffmpeg-static): ${ffmpegPath}`);
                return true;
            }
        } catch {
            // ffmpeg-static not installed, try system FFmpeg
        }

        // Fall back to system FFmpeg
        const output = execSync('ffmpeg -version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const version = output.split('\n')[0];
        logger.info(`FFmpeg found (system): ${version}`);
        return true;
    } catch {
        logger.warn('FFmpeg not found! Voice TTS playback may not work.');
        logger.warn('Install ffmpeg-static: npm install ffmpeg-static');
        logger.warn('Or install FFmpeg system-wide: https://ffmpeg.org/download.html');
        return false;
    }
}

async function main() {
    try {
        logger.info('Starting Discord Memory Bot...');

        // Always check FFmpeg since TTS can be toggled per guild at runtime
        checkFFmpeg();

        // Initialize database
        logger.info('Connecting to database...');
        const db = getPrismaClient();
        await db.$connect();
        await enablePgVector();
        logger.info('Database connected successfully');

        // Initialize services
        logger.info('Initializing services...');
        const aiService = new AiService();
        const speechService = new LocalSpeechService();
        const ttsService = new TtsService();
        setTtsService(ttsService);  // Register for API access
        const memoryRepository = new MemoryRepository();
        const memoryService = new MemoryService(aiService, memoryRepository);

        // Initialize realtime learning services
        let learningService: RealtimeLearningService | undefined;
        let consolidationService: MemoryConsolidationService | undefined;

        if (config.learning.enabled) {
            logger.info('Initializing realtime learning services...');
            learningService = new RealtimeLearningService(aiService, memoryRepository);
            consolidationService = new MemoryConsolidationService(aiService, memoryRepository);
            consolidationService.startPeriodicConsolidation();
            logger.info('Realtime learning enabled - bot will learn from ALL messages');
        }

        const voiceSessionManager = new VoiceSessionManager(
            speechService,
            ttsService,
            memoryService,
            aiService,
            learningService
        );
        logger.info(`Services initialized (TTS default: ${config.tts.enabled ? 'enabled' : 'disabled'}, Learning: ${config.learning.enabled ? 'enabled' : 'disabled'})`);

        // Register slash commands
        logger.info('Registering slash commands...');
        await registerCommands();
        logger.info('Slash commands registered');

        // Initialize Discord client
        logger.info('Initializing Discord client...');
        const discordClient = new DiscordClient(aiService, memoryService, learningService);
        const commandHandler = new CommandHandler(voiceSessionManager, memoryService, aiService, learningService);

        // Setup command handler
        const client = discordClient.getClient();

        // Give voice session manager access to Discord client for channel lookups
        voiceSessionManager.setDiscordClient(client);

        // Give Discord client access to voice session manager for text-triggered voice joins
        discordClient.setVoiceSessionManager(voiceSessionManager);

        client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            logger.info(`[INTERACTION] Received command: ${interaction.commandName}`);
            try {
                await commandHandler.handleCommand(interaction);
            } catch (err) {
                logger.error(`[INTERACTION] Unhandled error in command ${interaction.commandName}:`, err);
            }
        });

        // Setup voice state tracking for auto-join
        client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
            try {
                await voiceSessionManager.handleVoiceStateUpdate(oldState, newState);
            } catch (err) {
                logger.error('[VOICE_STATE] Unhandled error:', err);
            }
        });

        // Start the Dashboard API server
        const apiPort = parseInt(process.env.API_PORT || '3000');
        startApiServer(apiPort);

        // Login to Discord
        logger.info('Logging in to Discord...');
        await discordClient.login();

        // Enable auto-join for voice channels after login
        if (config.voiceChat.autoJoinEnabled) {
            logger.info('Enabling voice auto-join...');
            // Wait a bit for guilds to load
            setTimeout(() => {
                voiceSessionManager.enableAutoJoin();
            }, 5000);
        }

        // Graceful shutdown
        const shutdown = async () => {
            logger.info('Shutting down gracefully...');
            stopApiServer();
            if (consolidationService) {
                consolidationService.stopPeriodicConsolidation();
            }
            await discordClient.destroy();
            await disconnectDatabase();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Global error handlers to prevent crashes
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception (not crashing):', error);
            // Don't exit - try to keep running
        });

        process.on('unhandledRejection', (reason) => {
            logger.error('Unhandled rejection (not crashing):', reason);
            // Don't exit - try to keep running
        });

        logger.info('Bot is now running!');
    } catch (error) {
        logger.error('Fatal error during startup:', error);
        process.exit(1);
    }
}

main();
