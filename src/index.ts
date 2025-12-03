import { logger } from './utils/logger';
import { getPrismaClient, enablePgVector, disconnectDatabase } from './db/client';
import { AiService } from './services/ai/AiService';
import { LocalSpeechService } from './services/speech/SpeechService';
import { TtsService } from './services/speech/TtsService';
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

async function main() {
    try {
        logger.info('Starting Discord Memory Bot...');

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
        logger.info(`Services initialized (TTS: ${config.tts.enabled ? 'enabled' : 'disabled'}, Learning: ${config.learning.enabled ? 'enabled' : 'disabled'})`);

        // Register slash commands
        logger.info('Registering slash commands...');
        await registerCommands();
        logger.info('Slash commands registered');

        // Initialize Discord client
        logger.info('Initializing Discord client...');
        const discordClient = new DiscordClient(aiService, memoryService, learningService);
        const commandHandler = new CommandHandler(voiceSessionManager, memoryService);

        // Setup command handler
        const client = discordClient.getClient();
        
        // Give voice session manager access to Discord client for channel lookups
        voiceSessionManager.setDiscordClient(client);
        
        client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            await commandHandler.handleCommand(interaction);
        });

        // Setup voice state tracking for auto-join
        client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
            await voiceSessionManager.handleVoiceStateUpdate(oldState, newState);
        });

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
            if (consolidationService) {
                consolidationService.stopPeriodicConsolidation();
            }
            await discordClient.destroy();
            await disconnectDatabase();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        logger.info('Bot is now running!');
    } catch (error) {
        logger.error('Fatal error during startup:', error);
        process.exit(1);
    }
}

main();
