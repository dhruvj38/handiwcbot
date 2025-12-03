import {
    Client,
    GatewayIntentBits,
    Events,
    Message,
    Interaction,
    TextChannel,
    MessageReaction,
    PartialMessageReaction,
    User,
    PartialUser,
    MessageReactionEventDetails,
} from 'discord.js';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AiService } from '../services/ai/AiService';
import { MemoryService } from '../services/memory/MemoryService';
import { RealtimeLearningService } from '../services/learning/RealtimeLearningService';
import { ChatContext } from '../types';

export class DiscordClient {
    private client: Client;
    private aiService: AiService;
    private memoryService: MemoryService;
    private learningService: RealtimeLearningService | null = null;
    private processingMessages: Set<string> = new Set();
    
    // Track channels where bot is "active" (was recently mentioned)
    // Maps channelId -> timestamp when activity expires
    private activeChannels: Map<string, number> = new Map();
    private readonly ACTIVE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
    
    // Track recent conversation partners per channel
    // Maps channelId -> { userId, lastInteraction timestamp }
    private recentConversations: Map<string, { userId: string; lastInteraction: number }> = new Map();
    private readonly CONVERSATION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes to consider follow-up
    
    // Random butt-in chance (1 in X messages)
    private readonly RANDOM_BUTTIN_CHANCE = 12; // 1 in 12 messages (~8%)
    
    // Bot's name variations for direct address detection
    private readonly BOT_NAMES = [
        'handi', 'handiwc', 'mr handi', 'mr. handi', 'mrhandi', 
        'hey handi', 'yo handi', 'ted', 'hey ted', 'yo ted'
    ];
    // Indirect references (talking ABOUT the bot)
    private readonly INDIRECT_REFS = ['the bot', 'that bot', 'this bot'];
    private readonly POSITIVE_EMOJI = '🟢';
    private readonly NEGATIVE_EMOJI = '🔴';

    constructor(aiService: AiService, memoryService: MemoryService, learningService?: RealtimeLearningService) {
        this.aiService = aiService;
        this.memoryService = memoryService;
        this.learningService = learningService || null;

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessageReactions,
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
        this.client.on(Events.MessageReactionAdd, this.onMessageReactionAdd.bind(this));
    }

    /**
     * Handle client ready event
     */
    private async onReady(): Promise<void> {
        if (!this.client.user) return;
        logger.info(`Discord bot logged in as ${this.client.user.tag}`);
    }

    /**
     * Handle message create event (for mentions AND random butt-ins)
     */
    private async onMessageCreate(message: Message): Promise<void> {
        try {
            // Ignore bot messages
            if (message.author.bot) return;
            // Ignore DMs
            if (!message.guild) return;

            // ALWAYS feed message to learning service for personality building
            if (this.learningService) {
                // Fire and forget - don't await to avoid blocking response
                this.learningService.processMessage(message).catch(err => {
                    logger.warn('Learning service error:', err);
                });
            }

            const channelId = message.channel.id;
            const isMentioned = message.mentions.has(this.client.user!.id);
            const isActiveChannel = this.isChannelActive(channelId);
            const contentLower = message.content.toLowerCase();
            
            // Check for direct name address (someone calling the bot by name)
            // Use word boundary check to avoid false positives (e.g., "started" containing "ted")
            const isNameMention = this.BOT_NAMES.some(name => {
                const regex = new RegExp(`\\b${name}\\b`, 'i');
                return regex.test(contentLower);
            });
            // Check for indirect references (talking ABOUT the bot)
            const isIndirectReference = this.INDIRECT_REFS.some(ref => contentLower.includes(ref));
            // Check if this user was recently in conversation with the bot
            const isConversationFollowUp = this.isConversationFollowUp(channelId, message.author.id);
            
            // Determine if we should respond
            let shouldRespond = false;
            let responseType: 'mention' | 'name' | 'followup' | 'indirect' | 'buttin' | 'none' = 'none';
            
            if (isMentioned) {
                // Direct @mention - always respond and activate channel
                shouldRespond = true;
                responseType = 'mention';
                this.activateChannel(channelId);
                this.trackConversation(channelId, message.author.id);
                logger.info(`Direct mention from ${message.author.tag} - channel now active for 5 mins`);
            } else if (isNameMention) {
                // Someone said the bot's name - treat as direct address
                shouldRespond = true;
                responseType = 'name';
                this.activateChannel(channelId);
                this.trackConversation(channelId, message.author.id);
                logger.info(`Name mention from ${message.author.tag} - treating as direct address`);
            } else if (isConversationFollowUp) {
                // User was just talking to the bot - check if they're still talking to us
                const stillTalkingToBot = await this.isStillTalkingToBot(message, contentLower);
                if (stillTalkingToBot) {
                    shouldRespond = true;
                    responseType = 'followup';
                    this.trackConversation(channelId, message.author.id);
                    logger.info(`Follow-up message from ${message.author.tag} - continuing conversation`);
                }
            } else if (isActiveChannel && isIndirectReference) {
                // In active channel and talking ABOUT the bot
                shouldRespond = true;
                responseType = 'indirect';
                logger.info(`Indirect reference detected in active channel from ${message.author.tag}`);
            } else if (isActiveChannel && this.looksLikeQuestion(contentLower)) {
                // In active channel and asking a question - maybe respond
                if (Math.random() < 0.3) { // 30% chance to butt in on questions
                    shouldRespond = true;
                    responseType = 'buttin';
                    logger.info(`Butting into question in active channel`);
                }
            } else if (this.shouldRandomlyButtIn()) {
                // Random chaos mode - butt in unprompted
                shouldRespond = true;
                responseType = 'buttin';
                logger.info(`Random butt-in triggered on message from ${message.author.tag}`);
            }
            
            if (!shouldRespond) return;

            // Prevent duplicate processing
            if (this.processingMessages.has(message.id)) return;
            this.processingMessages.add(message.id);

            logger.info(`Responding (${responseType}) to ${message.author.tag} in ${message.guild?.name}`);

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

            logger.info('Fetching memories...');
            // Retrieve relevant memories
            const memories = await this.memoryService.retrieveMemoriesForChat(
                message.guild!.id,
                message.content,
                userIds
            );

            // Build chat context with special instructions based on response type
            let instructions = '';
            if (responseType === 'buttin') {
                instructions = `You're butting into this conversation uninvited. Be chaotic. Options:
- Take a side in whatever they're discussing (be opinionated)
- Make a snarky comment about what someone said
- Call someone out playfully
- Drop a hot take
- Reference an inside joke if relevant
Keep it SHORT (1-2 sentences max). Be rude but funny, not mean.`;
            } else if (responseType === 'indirect') {
                instructions = `They're talking ABOUT you, not TO you. Respond like you overheard them.
Be like "yo I heard that" or "talking shit?" or address what they said about you.
Keep it short and sassy.`;
            } else if (responseType === 'name') {
                instructions = `Someone called you by name. Respond naturally as if they're talking directly to you.
No need to acknowledge being called - just respond to what they said.`;
            } else if (responseType === 'followup') {
                instructions = `This is a follow-up to your previous conversation with this person.
They didn't @ you but they're clearly still talking to you. Continue the conversation naturally.`;
            }
            
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
                instructions,
            };

            logger.info('Generating AI response...');
            // Generate response
            if ('sendTyping' in message.channel) {
                await (message.channel as TextChannel).sendTyping();
            }

            const response = await this.aiService.generateChatResponse(context);
            logger.info(`Generated response (${response.length} chars)`);

            // For butt-ins and indirect, don't reply - just send a message (less formal)
            if (responseType === 'buttin' || responseType === 'indirect') {
                if ('send' in message.channel) {
                    const sent = await (message.channel as TextChannel).send(response);
                    await this.addFeedbackReactions(sent);
                }
            } else {
                // Direct mention - reply normally
                if (response.length <= 2000) {
                    const replyMessage = await message.reply(response);
                    await this.addFeedbackReactions(replyMessage);
                } else {
                    const chunks = this.splitMessage(response, 2000);
                    for (const chunk of chunks) {
                        if ('send' in message.channel) {
                            const sent = await (message.channel as TextChannel).send(chunk);
                            await this.addFeedbackReactions(sent);
                        }
                    }
                }
            }
        } catch (error) {
            logger.error('Error handling message:', error);
            try {
                await message.reply('Sorry, I encountered an error processing your message!');
            } catch (replyError) {
                logger.error('Failed to send error reply:', replyError);
            }
        } finally {
            // Clean up processing state
            this.processingMessages.delete(message.id);
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
     * Check if a channel is currently "active" (bot was mentioned recently)
     */
    private isChannelActive(channelId: string): boolean {
        const expiresAt = this.activeChannels.get(channelId);
        if (!expiresAt) return false;
        
        if (Date.now() > expiresAt) {
            this.activeChannels.delete(channelId);
            logger.info(`Channel ${channelId} is no longer active`);
            return false;
        }
        return true;
    }
    
    /**
     * Activate a channel for the active duration
     */
    private activateChannel(channelId: string): void {
        this.activeChannels.set(channelId, Date.now() + this.ACTIVE_DURATION_MS);
    }
    
    /**
     * Track that we're in conversation with a user in a channel
     */
    private trackConversation(channelId: string, userId: string): void {
        this.recentConversations.set(channelId, {
            userId,
            lastInteraction: Date.now()
        });
    }
    
    /**
     * Check if this message is a follow-up from someone we were just talking to
     */
    private isConversationFollowUp(channelId: string, userId: string): boolean {
        const convo = this.recentConversations.get(channelId);
        if (!convo) return false;
        
        // Must be same user
        if (convo.userId !== userId) return false;
        
        // Must be within timeout
        if (Date.now() - convo.lastInteraction > this.CONVERSATION_TIMEOUT_MS) {
            this.recentConversations.delete(channelId);
            return false;
        }
        
        return true;
    }
    
    /**
     * Use AI to determine if a follow-up message is still directed at the bot
     */
    private async isStillTalkingToBot(message: Message, contentLower: string): Promise<boolean> {
        // Quick checks for obvious cases
        
        // If they're clearly talking to someone else, skip
        if (message.mentions.users.size > 0) {
            return false; // They mentioned someone else
        }
        
        // Short responses are likely still to us ("yes", "no", "ok", "thanks")
        if (contentLower.length < 20) {
            return true;
        }
        
        // If it looks like a continuation (starts with common follow-up patterns)
        const continuationPatterns = [
            /^(yes|no|yeah|nah|yep|nope|ok|okay|sure|thanks|thx|ty|wait|but|and|also|what about|how about|can you|could you|what if|why|actually)/i
        ];
        if (continuationPatterns.some(p => p.test(contentLower))) {
            return true;
        }
        
        // For longer messages, fetch recent context and let AI decide
        try {
            const recentMessages = await message.channel.messages.fetch({ limit: 5 });
            const context = Array.from(recentMessages.values())
                .reverse()
                .map(m => `${m.author.bot ? 'Bot' : m.author.username}: ${m.content}`)
                .join('\n');
            
            const prompt = `Given this recent conversation:\n${context}\n\nIs the last message from ${message.author.username} ("${message.content}") likely directed at the bot, or are they now talking to someone else/the channel in general?\n\nRespond with only "yes" if talking to bot, "no" if not.`;
            
            const decision = await this.aiService.quickPrompt(prompt);
            return decision.toLowerCase().includes('yes');
        } catch (error) {
            logger.error('Error checking if still talking to bot:', error);
            // Default to yes if we can't determine
            return true;
        }
    }
    
    /**
     * Check if message looks like a question
     */
    private looksLikeQuestion(content: string): boolean {
        return content.includes('?') || 
               content.startsWith('who ') ||
               content.startsWith('what ') ||
               content.startsWith('where ') ||
               content.startsWith('when ') ||
               content.startsWith('why ') ||
               content.startsWith('how ') ||
               content.startsWith('should ') ||
               content.startsWith('can ') ||
               content.startsWith('is ') ||
               content.startsWith('are ');
    }
    
    /**
     * Decide if bot should randomly butt in
     */
    private shouldRandomlyButtIn(): boolean {
        return Math.random() < (1 / this.RANDOM_BUTTIN_CHANCE);
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

    private async addFeedbackReactions(message: Message): Promise<void> {
        try {
            await message.react(this.POSITIVE_EMOJI);
            await message.react(this.NEGATIVE_EMOJI);
        } catch (error) {
            logger.warn('Failed to add feedback reactions:', error);
        }
    }

    private async onMessageReactionAdd(
        reaction: MessageReaction | PartialMessageReaction,
        user: User | PartialUser,
        _details: MessageReactionEventDetails
    ): Promise<void> {
        try {
            if (user.bot) return;

            // Partial users may not have an ID yet
            if (!user.id) return;

            if (reaction.partial) {
                try {
                    reaction = await reaction.fetch();
                } catch (error) {
                    logger.warn('Failed to fetch partial reaction:', error);
                    return;
                }
            }

            const message = reaction.message;
            if (!message.guild) return;
            if (!message.author || !message.author.bot) return;
            const emoji = reaction.emoji.name;
            if (!emoji || (emoji !== this.POSITIVE_EMOJI && emoji !== this.NEGATIVE_EMOJI)) return;
            if (!this.learningService) return;

            const isPositive = emoji === this.POSITIVE_EMOJI;

            const voterId = user.id as string;

            await this.learningService.processFeedbackExample(
                message.guild!.id,
                message.channel.id,
                message.id,
                message.content,
                isPositive,
                voterId
            );
        } catch (error) {
            logger.warn('Error processing feedback reaction:', error);
        }
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
