import {
    Client,
    GatewayIntentBits,
    Events,
    Message,
    Interaction,
    TextChannel,
} from 'discord.js';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AiService } from '../services/ai/AiService';
import { MemoryService } from '../services/memory/MemoryService';
import { ChatContext } from '../types';

export class DiscordClient {
    private client: Client;
    private aiService: AiService;
    private memoryService: MemoryService;

    constructor(aiService: AiService, memoryService: MemoryService) {
        this.aiService = aiService;
        this.memoryService = memoryService;

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMembers,
            ],
        });

        this.setupEventHandlers();
    }

    /**
     * Setup Discord event handlers
     */
    private setupEventHandlers(): void {
        this.client.on(Events.ClientReady, this.onReady.bind(this));
        this.client.on(Events.MessageCreate, this.onMessageCreate.bind(this));
        this.client.on(Events.InteractionCreate, this.onInteractionCreate.bind(this));
    }

    /**
     * Handle client ready event
     */
    private async onReady(): Promise<void> {
        if (!this.client.user) return;
        logger.info(`Discord bot logged in as ${this.client.user.tag}`);
    }

    /**
     * Handle message create event (for mentions)
     */
    private async onMessageCreate(message: Message): Promise<void> {
        try {
            logger.info(`Message received: "${message.content.substring(0, 50)}" from ${message.author.tag}`);

            // Ignore bot messages
            if (message.author.bot) {
                logger.debug('Ignoring bot message');
                return;
            }

            // Check if bot is mentioned
            logger.info(`Bot user ID: ${this.client.user!.id}, Mentions: ${Array.from(message.mentions.users.keys()).join(', ')}`);
            if (!message.mentions.has(this.client.user!.id)) {
                logger.debug('Bot not mentioned in message');
                return;
            }

            logger.info(`Received mention from ${message.author.tag} in ${message.guild?.name}`);

            // Fetch recent messages for context
            const recentMessages = await message.channel.messages.fetch({
                limit: Math.min(config.bot.maxContextMessages, 50)
            });

            const contextMessages = Array.from(recentMessages.values())
                .reverse()
                .slice(-20) // Use last 20 messages
                .map((msg) => ({
                    userId: msg.author.id,
                    userName: msg.author.username,
                    content: msg.content,
                    timestamp: msg.createdAt,
                }));

            // Extract user IDs from recent messages
            const userIds = [message.author.id, ...Array.from(message.mentions.users.keys())];

            // Retrieve relevant memories
            const memories = await this.memoryService.retrieveMemoriesForChat(
                message.guild!.id,
                message.content,
                userIds
            );

            // Build chat context
            const context: ChatContext = {
                serverId: message.guild!.id,
                channelId: message.channel.id,
                userMessage: message.content,
                userId: message.author.id,
                userName: message.author.username,
                recentMessages: contextMessages,
                serverMemories: memories.serverMemories,
                userProfiles: memories.userProfiles,
                sessionSummaries: memories.sessionSummaries,
            };

            // Generate response
            if ('sendTyping' in message.channel) {
                await (message.channel as TextChannel).sendTyping();
            }

            const response = await this.aiService.generateChatResponse(context);

            // Split response if too long (Discord limit is 2000 characters)
            if (response.length <= 2000) {
                await message.reply(response);
            } else {
                const chunks = this.splitMessage(response, 2000);
                for (const chunk of chunks) {
                    if ('send' in message.channel) {
                        await (message.channel as TextChannel).send(chunk);
                    }
                }
            }
        } catch (error) {
            logger.error('Error handling message:', error);
            await message.reply('Sorry, I encountered an error processing your message!');
        }
    }

    /**
     * Handle interaction create event (for slash commands)
     */
    private async onInteractionCreate(interaction: Interaction): Promise<void> {
        if (!interaction.isChatInputCommand()) return;

        try {
            logger.info(`Received command: ${interaction.commandName} from ${interaction.user.tag}`);

            // Command handlers are registered elsewhere
            // This is just a placeholder for the interaction handler
        } catch (error) {
            logger.error('Error handling interaction:', error);
            if (interaction.isRepliable()) {
                await interaction.reply({
                    content: 'Sorry, I encountered an error processing your command!',
                    ephemeral: true,
                });
            }
        }
    }

    /**
     * Split message into chunks
     */
    private splitMessage(text: string, maxLength: number): string[] {
        const chunks: string[] = [];
        let currentChunk = '';

        const lines = text.split('\n');
        for (const line of lines) {
            if (currentChunk.length + line.length + 1 > maxLength) {
                if (currentChunk) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                }

                // If a single line is too long, split it by words
                if (line.length > maxLength) {
                    const words = line.split(' ');
                    for (const word of words) {
                        if (currentChunk.length + word.length + 1 > maxLength) {
                            chunks.push(currentChunk);
                            currentChunk = word;
                        } else {
                            currentChunk += (currentChunk ? ' ' : '') + word;
                        }
                    }
                } else {
                    currentChunk = line;
                }
            } else {
                currentChunk += (currentChunk ? '\n' : '') + line;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    /**
     * Login to Discord
     */
    async login(): Promise<void> {
        await this.client.login(config.discord.token);
    }

    /**
     * Get the Discord client instance
     */
    getClient(): Client {
        return this.client;
    }

    /**
     * Destroy the client
     */
    async destroy(): Promise<void> {
        await this.client.destroy();
    }
}
