import { logger } from './utils/logger';
import { getPrismaClient, enablePgVector, disconnectDatabase } from './db/client';
import { AiService } from './services/ai/AiService';
import { LocalSpeechService } from './services/speech/SpeechService';
import { MemoryRepository } from './services/memory/MemoryRepository';
import { MemoryService } from './services/memory/MemoryService';
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
        const memoryRepository = new MemoryRepository();
        const memoryService = new MemoryService(aiService, memoryRepository);
        const voiceSessionManager = new VoiceSessionManager(speechService, memoryService);
        logger.info('Services initialized');

        // Register slash commands
        logger.info('Registering slash commands...');
        await registerCommands();
        logger.info('Slash commands registered');

        // Initialize Discord client
        logger.info('Initializing Discord client...');
        const discordClient = new DiscordClient(aiService, memoryService);
        const commandHandler = new CommandHandler(voiceSessionManager, memoryService);

        // Setup command handler
        const client = discordClient.getClient();
        client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            await commandHandler.handleCommand(interaction);
        });

        // Login to Discord
        logger.info('Logging in to Discord...');
        await discordClient.login();

        // Graceful shutdown
        const shutdown = async () => {
            logger.info('Shutting down gracefully...');
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
