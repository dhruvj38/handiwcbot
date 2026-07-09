import {
    Client,
    GatewayIntentBits,
    Events,
    Message,
    Interaction,
    TextChannel,
    VoiceChannel,
    GuildMember,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonInteraction,
    ModalSubmitInteraction,
} from 'discord.js';
import { VoiceSessionManager } from './voice/VoiceSessionManager';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AiService } from '../services/ai/AiService';
import { MemoryService } from '../services/memory/MemoryService';
import { RealtimeLearningService } from '../services/learning/RealtimeLearningService';
import { ChatContext } from '../types';
import { UserDisplayNameService, sanitizeOutputMessage, detectNicknameRequest } from '../services/nickname/UserDisplayNameService';
import { aiInteractionRepository } from '../services/ai/AiInteractionRepository';
import { promptEditService, SECTION_DISPLAY_NAMES } from '../services/PromptEditService';

export class DiscordClient {
    private client: Client;
    private aiService: AiService;
    private memoryService: MemoryService;
    private learningService: RealtimeLearningService | null = null;
    private displayNameService: UserDisplayNameService;
    private processingMessages: Set<string> = new Set();
    private voiceSessionManager: VoiceSessionManager | null = null;

    // Patterns for detecting voice join requests
    private readonly VOICE_JOIN_PATTERNS = [
        /\b(talk to me|speak to me|come|join|hop|get) (in|into|to|on) (voice|vc|the voice|the vc|my vc|call)\b/i,
        /\b(join|come to|hop in|get in|pull up to) (voice|vc|call|the vc|the voice)\b/i,
        /\b(talk|speak|chat) (with|to) me in (voice|vc|call)\b/i,
        /\bget (in|on) (voice|vc|call)\b/i,
        /\b(come|pull up) (to )?(voice|vc)\b/i,
        /\bjoin (my )?(voice|vc|call)\b/i,
    ];

    // Track channels where bot is "active" (was recently mentioned)
    // Maps channelId -> timestamp when activity expires
    private activeChannels: Map<string, number> = new Map();
    private readonly ACTIVE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

    // Track recent conversation partners per channel
    // Maps channelId -> { userId, lastInteraction timestamp }
    private recentConversations: Map<string, { userId: string; lastInteraction: number }> = new Map();
    private readonly CONVERSATION_TIMEOUT_MS = 60 * 1000; // 60 seconds to consider follow-up (increased from 30s)

    // Random butt-in chance - base is 2 in 25 (~8%)
    private readonly RANDOM_BUTTIN_CHANCE = 12.5; // 1 in 12.5 = 8% chance

    // Channel-specific butt-in multipliers (higher = more likely to butt in)
    private readonly CHANNEL_BUTTIN_MULTIPLIERS: Record<string, number> = {
        // Add channel IDs here for custom rates, e.g.:
        // 'general': 1.5,  // 50% more likely to butt in
        // 'serious': 0.3,  // 70% less likely
    };

    // Conversation follow tracking - extended window
    private readonly CONVERSATION_FOLLOW_WINDOW_MS = 60 * 1000; // 1 minute to follow conversation

    // Rate limiting for text chat responses
    private lastResponseTime: Map<string, number> = new Map(); // channelId -> timestamp
    private readonly MIN_RESPONSE_COOLDOWN_MS = 8000; // 8 seconds between butt-in responses
    private readonly MENTION_COOLDOWN_MS = 0; // No cooldown for direct mentions
    private readonly FOLLOWUP_COOLDOWN_MS = 2000; // 2 seconds for conversation follow-ups

    // Debounce pending messages to batch rapid messages
    private pendingMessages: Map<string, { messages: Message[]; timer: NodeJS.Timeout }> = new Map();
    private readonly DEBOUNCE_MS = 2000; // Wait 2 seconds for more messages before responding

    // Channel locks to prevent multiple simultaneous responses
    private channelResponseLocks: Set<string> = new Set();
    private pendingChannelResponses: Map<string, Message[]> = new Map();

    // Bot's name variations for direct address detection
    // Includes common mishearings/typos
    private readonly BOT_NAMES = [
        'handi', 'handiwc', 'handi wc', 'mr handi', 'mr. handi', 'mrhandi',
        'mr handi wc', 'mr. handi wc', 'mrhandiwc',
        'hey handi', 'yo handi', 'ayo handi', 'ted', 'hey ted', 'yo ted',
        // Common typos/mishearings
        'handy', 'mr handy', 'hey handy', 'hendy', 'handee'
    ];
    // Indirect references (talking ABOUT the bot)
    private readonly INDIRECT_REFS = ['the bot', 'that bot', 'this bot'];

    constructor(aiService: AiService, memoryService: MemoryService, learningService?: RealtimeLearningService) {
        this.aiService = aiService;
        this.memoryService = memoryService;
        this.learningService = learningService || null;
        this.displayNameService = new UserDisplayNameService(memoryService.getRepository());

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

        // Set the Discord client on the display name service for guild/member lookups
        this.displayNameService.setClient(this.client);
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

            // EARLY duplicate check - prevent same message from being processed multiple times
            if (this.processingMessages.has(message.id)) return;
            this.processingMessages.add(message.id);

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

            // Check for voice join request FIRST (before normal response handling)
            if ((isMentioned || isNameMention) && this.isVoiceJoinRequest(contentLower)) {
                logger.info(`Voice join request detected from ${message.author.tag}`);
                const voiceResponse = await this.handleVoiceJoinRequest(message);
                if (voiceResponse) {
                    await message.reply(voiceResponse);
                    this.activateChannel(channelId);
                    this.trackConversation(channelId, message.author.id);
                    this.lastResponseTime.set(channelId, Date.now());
                    this.processingMessages.delete(message.id);
                    return;
                }
            }

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
            } else if (this.shouldFollowConversation(channelId, message.author.id)) {
                // Conversation momentum - bot was recently in this convo
                shouldRespond = true;
                responseType = 'followup';
                this.trackConversation(channelId, message.author.id);
                logger.info(`Following conversation in ${channelId} - recent activity detected`);
            } else if (this.shouldRandomlyButtIn(channelId)) {
                // Random chaos mode - butt in unprompted
                shouldRespond = true;
                responseType = 'buttin';
                logger.info(`Random butt-in triggered on message from ${message.author.tag}`);
            }

            if (!shouldRespond) {
                this.processingMessages.delete(message.id);
                return;
            }

            // Check if channel is already being responded to (prevent multiple simultaneous responses)
            if (this.channelResponseLocks.has(channelId)) {
                const queue = this.pendingChannelResponses.get(channelId) || [];
                queue.push(message);
                this.pendingChannelResponses.set(channelId, queue);
                logger.info(`Channel ${channelId} already has a response in progress, queuing message ${message.id}`);
                this.processingMessages.delete(message.id);
                return;
            }

            // Apply rate limiting - check cooldown based on response type
            const lastResponse = this.lastResponseTime.get(channelId) || 0;
            const now = Date.now();
            let cooldown = this.MIN_RESPONSE_COOLDOWN_MS;
            if (responseType === 'mention' || responseType === 'name') {
                cooldown = this.MENTION_COOLDOWN_MS;
            } else if (responseType === 'followup') {
                cooldown = this.FOLLOWUP_COOLDOWN_MS;
            }

            if (now - lastResponse < cooldown) {
                logger.info(`Rate limited: ${cooldown - (now - lastResponse)}ms remaining before next response`);
                this.processingMessages.delete(message.id);
                return;
            }

            // For follow-ups and butt-ins, debounce to batch rapid messages
            if (responseType === 'followup' || responseType === 'buttin') {
                const pending = this.pendingMessages.get(channelId);
                if (pending) {
                    // Add to existing pending batch
                    pending.messages.push(message);
                    // Don't process yet - let the timer handle it
                    this.processingMessages.delete(message.id);
                    return;
                } else {
                    // Start a new debounce batch
                    const timer = setTimeout(() => {
                        this.processDebounced(channelId, responseType);
                    }, this.DEBOUNCE_MS);
                    this.pendingMessages.set(channelId, { messages: [message], timer });
                    this.processingMessages.delete(message.id);
                    return;
                }
            }

            // Acquire channel lock to prevent simultaneous responses
            this.channelResponseLocks.add(channelId);

            logger.info(`Responding (${responseType}) to ${message.author.tag} in ${message.guild?.name}`);

            // Fetch recent messages and memories in parallel for lower latency
            const messagesPromise = message.channel.messages.fetch({
                limit: Math.min(config.bot.maxContextMessages, 50)
            });

            // Extract user IDs from recent messages
            const userIds = [message.author.id, ...Array.from(message.mentions.users.keys())];

            // Resolve display name for the message author using nickname service
            const authorDisplayName = message.member
                ? await this.displayNameService.getDisplayNameForMember(message.member)
                : message.author.displayName || message.author.username;

            // Extract mentioned users (excluding the bot) with resolved nicknames
            const mentionedUsersRaw = Array.from(message.mentions.users.values())
                .filter(u => u.id !== this.client.user?.id);

            const mentionedUsers: { userId: string; userName: string; displayName?: string }[] = [];
            for (const u of mentionedUsersRaw) {
                const resolvedName = await this.displayNameService.getDisplayName(
                    message.guild!.id,
                    u.id,
                    message.guild!
                );
                mentionedUsers.push({
                    userId: u.id,
                    userName: u.username,
                    displayName: resolvedName,
                });
            }

            // Extract image URLs from attachments
            const imageUrls: string[] = [];
            for (const [, attachment] of message.attachments) {
                const contentType = attachment.contentType?.toLowerCase() || '';
                const url = attachment.url.toLowerCase();
                // Check if it's an image (not a gif - those are handled separately)
                if (contentType.startsWith('image/') ||
                    url.endsWith('.png') || url.endsWith('.jpg') ||
                    url.endsWith('.jpeg') || url.endsWith('.webp')) {
                    imageUrls.push(attachment.url);
                }
            }

            const hasGifInMessage = this.messageHasGif(message);

            logger.info('Fetching memories...');
            const memoriesPromise = this.memoryService.retrieveMemoriesForChat(
                message.guild!.id,
                message.content,
                userIds
            );

            const recentMessages = await messagesPromise;

            // Resolve display names for recent messages
            const recentMessagesList = Array.from(recentMessages.values()).reverse().slice(-20);
            const contextMessages: { userId: string; userName: string; content: string; timestamp: Date }[] = [];

            for (const msg of recentMessagesList) {
                // Use cached/resolved names - prefer member nickname, then resolved name
                const resolvedName = msg.member
                    ? await this.displayNameService.getDisplayNameForMember(msg.member)
                    : msg.author.displayName || msg.author.username;
                contextMessages.push({
                    userId: msg.author.id,
                    userName: resolvedName,
                    content: msg.content,
                    timestamp: msg.createdAt,
                });
            }

            // Retrieve relevant memories (already in progress above)
            const memories = await memoriesPromise;

            let instructions = '';
            if (responseType === 'indirect') {
                instructions = `They're talking ABOUT you, not TO you. Respond like you overheard them.
Be like "yo I heard that" or "talking shit?" or address what they said about you.
Keep it short and sassy.`;
            } else if (responseType === 'name') {
                instructions = `Someone called you by name. Respond naturally as if they're talking directly to you.
No need to acknowledge being called - just respond to what they said.`;
            }
            // 'mention' type uses default (no special instructions)

            // Get realtime learning context (trending slang, phrases, etc.)
            const realtimeContext = this.learningService?.getRealtimeContextForAI() || undefined;

            const context: ChatContext = {
                serverId: message.guild!.id,
                channelId: message.channel.id,
                userMessage: message.content,
                userId: message.author.id,
                userName: authorDisplayName, // Use resolved nickname instead of raw username
                recentMessages: contextMessages,
                serverMemories: memories.serverMemories,
                userProfiles: memories.userProfiles,
                sessionSummaries: memories.sessionSummaries,
                instructions,
                realtimeContext,
                mentionedUsers: mentionedUsers.length > 0 ? mentionedUsers : undefined,
                imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
                temporalSummary: memories.temporalSummary,
            };

            // Check if this is style feedback (teaching the bot)
            const feedback = this.aiService.detectStyleFeedback(message.content);
            if (feedback.isFeedback && feedback.rule) {
                logger.info(`Detected style feedback from ${message.author.tag}: ${feedback.rule}`);

                // Store as a habit for future use
                await this.memoryService.storeStyleRule(
                    message.guild!.id,
                    feedback.rule,
                    message.author.id
                ).catch((err: Error) => logger.warn('Failed to store style rule:', err));

                // Add instruction to acknowledge briefly and not argue
                context.instructions = (context.instructions || '') +
                    `\n\nIMPORTANT: The user is giving you feedback about your behavior. DO NOT argue or defend yourself. Just acknowledge briefly ("bet", "heard", "aight") and maybe apply the feedback. Keep it to ONE short sentence.`;
            }

            // Check for nickname request in message (natural language learning)
            const requestedNickname = detectNicknameRequest(message.content);
            if (requestedNickname) {
                logger.info(`Nickname request detected from ${message.author.tag}: "${requestedNickname}"`);
                await this.memoryService.updateUserNickname(
                    message.guild!.id,
                    message.author.id,
                    requestedNickname,
                    'llm_inferred'
                ).catch((err: Error) => logger.warn('Failed to store learned nickname:', err));

                // Invalidate cache so new name is used immediately
                this.displayNameService.invalidateCache(message.guild!.id, message.author.id);

                // Add instruction to acknowledge the nickname
                context.instructions = (context.instructions || '') +
                    `\n\nThe user just told you their preferred name is "${requestedNickname}". Briefly acknowledge this naturally (like "bet ${requestedNickname}" or "aight ${requestedNickname}") and use it from now on.`;
            }

            logger.info('Generating AI response...');
            // Generate response
            if ('sendTyping' in message.channel) {
                await (message.channel as TextChannel).sendTyping();
            }

            const response = await this.aiService.generateChatResponse(context);

            // Log prompt to bot-logs channel (fire and forget)
            const promptInfo = this.aiService.getLastPromptInfo();
            if (promptInfo) {
                this.logPromptToBotLogs(message.guild!.id, {
                    userName: authorDisplayName,
                    userMessage: message.content,
                    ...promptInfo,
                }).catch(err => logger.warn('Failed to log prompt to bot-logs:', err));
            }

            // Sanitize output to remove Discord tags and raw mentions
            const sanitizedResponse = sanitizeOutputMessage(response);

            const finalResponse = await this.maybeAttachGif(message, sanitizedResponse, responseType, hasGifInMessage);
            const gifAttached = finalResponse.includes('.gif') || finalResponse.includes('tenor.com') || finalResponse.includes('giphy.com');

            // Log comprehensive reply info
            logger.info(`💬 Reply generated | type=${responseType} | user=${message.author.tag} | channel=#${(message.channel as TextChannel).name || 'unknown'} | inputLen=${message.content.length} | outputLen=${response.length} | gifAttached=${gifAttached} | feedbackDetected=${feedback.isFeedback} | memoryStored=${feedback.isFeedback && !!feedback.rule} | nicknameDetected=${!!requestedNickname}`);

            // Send reply and capture bot message for interaction logging
            const sentMessages: Message[] = [];

            // For butt-ins and indirect, don't reply - just send a message (less formal)
            if (responseType === 'indirect') {
                if ('send' in message.channel) {
                    const sent = await (message.channel as TextChannel).send(finalResponse);
                    sentMessages.push(sent);
                }
            } else {
                // Direct mention/name - reply normally
                if (finalResponse.length <= 2000) {
                    const sent = await message.reply(finalResponse);
                    sentMessages.push(sent);
                } else {
                    const chunks = this.splitMessage(finalResponse, 2000);
                    for (const chunk of chunks) {
                        if ('send' in message.channel) {
                            const sent = await (message.channel as TextChannel).send(chunk);
                            sentMessages.push(sent);
                        }
                    }
                }
            }

            // Store interaction for learning and feedback
            try {
                const botMessageId = sentMessages[0]?.id;
                // Use the actual resolved model/provider from the AI service
                const provider = promptInfo?.provider || config.ai.providers.chat;
                const model = promptInfo?.model || config.ai.models.chat;

                await aiInteractionRepository.createInteraction({
                    guildId: message.guild!.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: authorDisplayName,
                    messageId: message.id,
                    botMessageId,
                    provider,
                    model,
                    type: 'chat',
                    userMessage: message.content,
                    botResponse: finalResponse,
                    metadata: {
                        responseType,
                        gifAttached,
                        feedbackDetected: feedback.isFeedback,
                        memoryStored: feedback.isFeedback && !!feedback.rule,
                        nicknameDetected: !!requestedNickname,
                    },
                });
            } catch (err) {
                logger.warn('Failed to store AI interaction for message:', err);
            }

            // Update last response time for rate limiting
            this.lastResponseTime.set(channelId, Date.now());
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
            const channelId = message.channel.id;
            this.channelResponseLocks.delete(channelId);
            const queue = this.pendingChannelResponses.get(channelId);
            const nextMessage = queue && queue.shift();
            if (queue && queue.length === 0) {
                this.pendingChannelResponses.delete(channelId);
            }
            if (nextMessage) {
                this.onMessageCreate(nextMessage).catch((err) => {
                    logger.error('Error handling queued message:', err);
                });
            }
        }
    }

    /**
     * Process debounced messages - called after DEBOUNCE_MS to batch rapid messages
     */
    private async processDebounced(channelId: string, responseType: 'followup' | 'buttin'): Promise<void> {
        const pending = this.pendingMessages.get(channelId);
        if (!pending || pending.messages.length === 0) return;

        // Clear pending
        this.pendingMessages.delete(channelId);

        // Use the last message for context (most recent)
        const lastMessage = pending.messages[pending.messages.length - 1]!;

        // Check rate limit again - use shorter cooldown for follow-ups
        const lastResponse = this.lastResponseTime.get(channelId) || 0;
        const now = Date.now();
        const cooldown = responseType === 'followup' ? this.FOLLOWUP_COOLDOWN_MS : this.MIN_RESPONSE_COOLDOWN_MS;
        if (now - lastResponse < cooldown) {
            logger.info(`Debounced batch rate limited (${cooldown - (now - lastResponse)}ms remaining), skipping`);
            return;
        }

        try {
            logger.info(`Processing debounced batch of ${pending.messages.length} messages (${responseType})`);

            // Fetch recent messages and memories in parallel for debounced batches
            const recentMessagesPromise = lastMessage.channel.messages.fetch({ limit: 5 });
            const batchedContent = pending.messages.map(m => m.content).join('\n');

            const hasGifInBatch = pending.messages.some(m => this.messageHasGif(m));

            const memoriesPromise = this.memoryService.retrieveMemoriesForChat(
                lastMessage.guild!.id,
                batchedContent,
                [lastMessage.author.id]
            );

            const recentMessages = await recentMessagesPromise;

            const contextMessages = Array.from(recentMessages.values())
                .reverse()
                .slice(-20)
                .map((msg) => ({
                    userId: msg.author.id,
                    userName: msg.author.username,
                    content: msg.content,
                    timestamp: msg.createdAt,
                }));

            const memories = await memoriesPromise;

            let instructions = '';
            if (responseType === 'buttin') {
                instructions = `You're butting into this conversation uninvited. Be chaotic. Options:
- Take a side in whatever they're discussing (be opinionated)
- Make a snarky comment about what someone said
- Call someone out playfully
- Drop a hot take
- Reference an inside joke if relevant
Keep it SHORT (1-2 sentences max). Be rude but funny, not mean.`;
            } else {
                instructions = `This is a follow-up to your previous conversation with this person.
They didn't @ you but they're clearly still talking to you. Continue the conversation naturally.
Keep it SHORT - don't ramble.`;
            }

            // Get realtime learning context for debounced messages too
            const realtimeContext = this.learningService?.getRealtimeContextForAI() || undefined;

            const context: ChatContext = {
                serverId: lastMessage.guild!.id,
                channelId: lastMessage.channel.id,
                userMessage: batchedContent,
                userId: lastMessage.author.id,
                userName: lastMessage.author.username,
                recentMessages: contextMessages,
                serverMemories: memories.serverMemories,
                userProfiles: memories.userProfiles,
                sessionSummaries: memories.sessionSummaries,
                instructions,
                realtimeContext,
                temporalSummary: memories.temporalSummary,
            };

            if ('sendTyping' in lastMessage.channel) {
                await (lastMessage.channel as TextChannel).sendTyping();
            }

            const response = await this.aiService.generateChatResponse(context);

            // Log prompt to bot-logs channel (fire and forget)
            const promptInfo = this.aiService.getLastPromptInfo();
            if (promptInfo) {
                this.logPromptToBotLogs(lastMessage.guild!.id, {
                    userName: lastMessage.author.username,
                    userMessage: batchedContent,
                    ...promptInfo,
                }).catch(err => logger.warn('Failed to log prompt to bot-logs:', err));
            }

            const finalResponse = await this.maybeAttachGif(lastMessage, response, responseType, hasGifInBatch);
            const gifAttached = finalResponse.includes('.gif') || finalResponse.includes('tenor.com') || finalResponse.includes('giphy.com');

            // Log comprehensive reply info for debounced responses
            logger.info(`💬 Reply generated (debounced) | type=${responseType} | user=${lastMessage.author.tag} | batchSize=${pending.messages.length} | inputLen=${batchedContent.length} | outputLen=${response.length} | gifAttached=${gifAttached}`);

            let sent: Message | null = null;
            if ('send' in lastMessage.channel) {
                sent = await (lastMessage.channel as TextChannel).send(finalResponse);
            }

            // Store interaction for debounced responses
            try {
                // Use the actual resolved model/provider from the AI service
                const provider = promptInfo?.provider || config.ai.providers.chat;
                const model = promptInfo?.model || config.ai.models.chat;

                await aiInteractionRepository.createInteraction({
                    guildId: lastMessage.guild!.id,
                    channelId: lastMessage.channel.id,
                    userId: lastMessage.author.id,
                    userName: lastMessage.author.username,
                    messageId: lastMessage.id,
                    botMessageId: sent?.id,
                    provider,
                    model,
                    type: 'chat',
                    userMessage: batchedContent,
                    botResponse: finalResponse,
                    metadata: {
                        responseType,
                        batchSize: pending.messages.length,
                        gifAttached,
                    },
                });
            } catch (err) {
                logger.warn('Failed to store AI interaction for debounced messages:', err);
            }

            // Update last response time
            this.lastResponseTime.set(channelId, Date.now());

            // Track conversation for follow-ups
            if (responseType === 'followup') {
                this.trackConversation(channelId, lastMessage.author.id);
            }
        } catch (error) {
            logger.error('Error processing debounced messages:', error);
        }
    }

    /**
     * Handle interaction create event (for slash commands, buttons, and modals)
     */
    private async onInteractionCreate(interaction: Interaction): Promise<void> {
        try {
            // Handle slash commands
            if (interaction.isChatInputCommand()) {
                logger.info(`Received command: ${interaction.commandName} from ${interaction.user.tag}`);
                // Command handlers are registered elsewhere
                return;
            }

            // Handle prompt edit button click
            if (interaction.isButton() && interaction.customId.startsWith('prompt_edit:')) {
                await this.handlePromptEditButton(interaction);
                return;
            }

            // Handle section selection
            if (interaction.isStringSelectMenu() && interaction.customId.startsWith('prompt_section_select:')) {
                await this.handleSectionSelect(interaction);
                return;
            }

            // Handle modal submission  
            if (interaction.isModalSubmit() && interaction.customId.startsWith('prompt_edit_modal:')) {
                await this.handlePromptEditModal(interaction);
                return;
            }
        } catch (error) {
            logger.error('Error handling interaction:', error);
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'Sorry, I encountered an error processing that!',
                    ephemeral: true,
                }).catch(() => { });
            }
        }
    }

    /**
     * Handle prompt edit button click - show section selector
     */
    private async handlePromptEditButton(interaction: ButtonInteraction): Promise<void> {
        const promptLogId = interaction.customId.split(':')[1];

        if (!promptLogId || promptLogId === 'no_id') {
            await interaction.reply({
                content: '❌ This prompt log is too old to edit (no database record).',
                ephemeral: true,
            });
            return;
        }

        // Defer reply while we fetch data
        await interaction.deferReply({ ephemeral: true });

        try {
            // Get the prompt log from database
            const promptLog = await promptEditService.getPromptLogByMessageId(promptLogId);

            // If not found by message ID, try by direct ID
            const actualPromptLog = promptLog || await (async () => {
                // The ID in custom_id could be the prompt log ID directly
                const { PrismaClient } = await import('@prisma/client');
                const prisma = new PrismaClient();
                return prisma.promptLog.findUnique({ where: { id: promptLogId } });
            })();

            if (!actualPromptLog) {
                await interaction.editReply({
                    content: '❌ Could not find the prompt log. It may have been deleted.',
                });
                return;
            }

            const sections = actualPromptLog.sections as Record<string, string>;
            const sectionKeys = Object.keys(sections);

            if (sectionKeys.length === 0) {
                await interaction.editReply({
                    content: '❌ No editable sections found in this prompt.',
                });
                return;
            }

            // Create section selector (max 25 options for Discord)
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`prompt_section_select:${actualPromptLog.id}`)
                .setPlaceholder('Select a section to edit...')
                .addOptions(
                    sectionKeys.slice(0, 25).map(key => ({
                        label: (SECTION_DISPLAY_NAMES[key] || key).substring(0, 100),
                        value: key,
                        description: `${sections[key]?.substring(0, 50) || 'Empty section'}...`.substring(0, 100),
                    }))
                );

            const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

            await interaction.editReply({
                content: '**Select a section to edit:**\n_Your edit will be applied to all future AI prompts._',
                components: [row],
            });
        } catch (error) {
            logger.error('Error handling prompt edit button:', error);
            await interaction.editReply({
                content: '❌ Failed to load prompt sections. Please try again.',
            });
        }
    }

    /**
     * Handle section selection - open modal with section text
     */
    private async handleSectionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
        const promptLogId = interaction.customId.split(':')[1]!;
        const sectionKey = interaction.values[0]!;

        try {
            const { PrismaClient } = await import('@prisma/client');
            const prisma = new PrismaClient();
            const promptLog = await prisma.promptLog.findUnique({ where: { id: promptLogId } });

            if (!promptLog) {
                await interaction.reply({
                    content: '❌ Prompt log not found.',
                    ephemeral: true,
                });
                return;
            }

            const sections = promptLog.sections as Record<string, string>;
            const sectionText = sections[sectionKey] || '';

            // Discord modal text input has 4000 char limit
            const truncatedText = sectionText.substring(0, 4000);

            // Create modal for editing
            const modal = new ModalBuilder()
                .setCustomId(`prompt_edit_modal:${promptLogId}:${sectionKey}`)
                .setTitle(`Edit: ${(SECTION_DISPLAY_NAMES[sectionKey] || sectionKey).substring(0, 40)}`);

            const textInput = new TextInputBuilder()
                .setCustomId('edited_text')
                .setLabel('Edit the section below:')
                .setStyle(TextInputStyle.Paragraph)
                .setValue(truncatedText)
                .setRequired(true)
                .setMaxLength(4000);

            const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);
            modal.addComponents(actionRow);

            await interaction.showModal(modal);
        } catch (error) {
            logger.error('Error handling section select:', error);
            await interaction.reply({
                content: '❌ Failed to open editor. Please try again.',
                ephemeral: true,
            });
        }
    }

    /**
     * Handle modal submission - save the edit
     */
    private async handlePromptEditModal(interaction: ModalSubmitInteraction): Promise<void> {
        const parts = interaction.customId.split(':');
        const promptLogId = parts[1]!;
        const sectionKey = parts[2]!;

        await interaction.deferReply({ ephemeral: true });

        try {
            const editedText = interaction.fields.getTextInputValue('edited_text');

            const { PrismaClient } = await import('@prisma/client');
            const prisma = new PrismaClient();
            const promptLog = await prisma.promptLog.findUnique({ where: { id: promptLogId } });

            if (!promptLog) {
                await interaction.editReply({
                    content: '❌ Prompt log not found.',
                });
                return;
            }

            const sections = promptLog.sections as Record<string, string>;
            const originalText = sections[sectionKey] || '';

            // Apply the edit
            const result = await promptEditService.applyEdit({
                guildId: promptLog.guildId,
                section: sectionKey,
                originalText,
                overrideText: editedText,
                createdBy: interaction.user.id,
                aiService: this.aiService,
            });

            if (result.success) {
                let message = `✅ ${result.message}`;
                if (result.learnedRule) {
                    message += `\n\n📝 **Learned Rule:** ${result.learnedRule}`;
                }
                message += '\n\n_This change will apply to all future AI prompts in this server._';

                await interaction.editReply({ content: message });
            } else {
                await interaction.editReply({
                    content: `❌ ${result.message}`,
                });
            }
        } catch (error) {
            logger.error('Error handling prompt edit modal:', error);
            await interaction.editReply({
                content: '❌ Failed to save edit. Please try again.',
            });
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
            /^(yes|no|yeah|nah|yep|nope|ok|okay|sure|thanks|thx|ty|wait|but|and|also|what about|how about|can you|could you|what if|why|actually|shi|damn|bruh|lol|lmao|fr|ong|bet)/i
        ];
        if (continuationPatterns.some(p => p.test(contentLower))) {
            return true;
        }

        // If it's a question and we're in a follow-up context, it's likely for us
        if (this.looksLikeQuestion(contentLower)) {
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

            const decision = await this.aiService.quickPrompt(message.guild!.id, prompt);
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
     * Uses base chance modified by channel-specific multipliers
     */
    private shouldRandomlyButtIn(channelId?: string): boolean {
        let multiplier = 1.0;
        if (channelId && this.CHANNEL_BUTTIN_MULTIPLIERS[channelId]) {
            multiplier = this.CHANNEL_BUTTIN_MULTIPLIERS[channelId];
        }
        const effectiveChance = (1 / this.RANDOM_BUTTIN_CHANCE) * multiplier;
        return Math.random() < effectiveChance;
    }

    /**
     * Check if we should follow an ongoing conversation
     * More aggressive than simple follow-up - looks at conversation momentum
     */
    private shouldFollowConversation(channelId: string, authorId: string): boolean {
        const conversation = this.recentConversations.get(channelId);
        if (!conversation) return false;

        const elapsed = Date.now() - conversation.lastInteraction;
        if (elapsed > this.CONVERSATION_FOLLOW_WINDOW_MS) return false;

        // If same user is still talking, higher chance to follow
        if (conversation.userId === authorId) {
            return Math.random() < 0.8; // 80% chance to follow same user (increased from 40%)
        }

        // Different user in same recent conversation - lower chance
        return Math.random() < 0.15; // 15% chance to butt in on related conversation
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

    private messageHasGif(message: Message): boolean {
        for (const [, attachment] of message.attachments) {
            const url = attachment.url;
            if (!url) continue;
            const lower = url.toLowerCase();
            if (lower.endsWith('.gif') || lower.includes('tenor.com') || lower.includes('giphy.com')) {
                return true;
            }
        }

        for (const embed of message.embeds) {
            const url = embed.url || embed.thumbnail?.url || embed.image?.url;
            if (!url) continue;
            const lower = url.toLowerCase();
            if (lower.endsWith('.gif') || lower.includes('tenor.com') || lower.includes('giphy.com')) {
                return true;
            }
        }

        return false;
    }

    private async maybeAttachGif(
        message: Message,
        response: string,
        responseType: 'mention' | 'name' | 'followup' | 'indirect' | 'buttin' | 'none',
        hasGifContext: boolean = false
    ): Promise<string> {
        try {
            if (!message.guild) return response;

            // Don't spam GIFs or exceed Discord limits
            if (!hasGifContext && response.length > 1500) return response;

            // Skip if response already has a URL (likely already includes media/link)
            if (!hasGifContext && (response.includes('http://') || response.includes('https://'))) return response;

            // Only attach GIFs for conversational responses, not "none"
            if (!hasGifContext && responseType === 'none') return response;

            // Base chance by response type - VERY LOW per Zhifs feedback
            // Gifs should be standalone reactions, not attached to every message
            let baseChance = 0.0;
            if (hasGifContext) {
                baseChance = 0.8;
            } else if (responseType === 'mention' || responseType === 'name') {
                baseChance = 0.08; // 8% - rarely attach to direct mentions
            } else if (responseType === 'followup') {
                baseChance = 0.05; // 5% - even rarer for follow-ups
            } else if (responseType === 'buttin' || responseType === 'indirect') {
                baseChance = 0.03; // 3% - almost never for butt-ins
            }

            if (baseChance <= 0 || Math.random() > baseChance) {
                return response;
            }

            const serverId = message.guild.id;
            const channelId = message.channel.id;

            const query = `${message.content}`;
            const gifMemories = await this.memoryService.searchGifMemoriesByText(serverId, query, 3);
            if (!gifMemories.length) return response;

            // Prefer GIFs that were seen in this channel
            let chosen = gifMemories[0]!;
            for (const mem of gifMemories) {
                const meta = mem.metadata as any;
                if (meta && typeof meta.channelId === 'string' && meta.channelId === channelId) {
                    chosen = mem;
                    break;
                }
            }

            const meta = chosen.metadata as any;
            const gifUrl = meta && typeof meta.gifUrl === 'string' ? meta.gifUrl : null;
            if (!gifUrl) return response;

            const gifOnlyBias = hasGifContext ? 0.85 : 0.75;
            const useGifOnly = Math.random() < gifOnlyBias;

            if (useGifOnly) {
                return gifUrl;
            }

            const appended = `${response}\n${gifUrl}`;
            if (appended.length > 2000) {
                return response;
            }

            return appended;
        } catch (error) {
            logger.warn('Failed to attach GIF to response:', error);
            return response;
        }
    }

    /**
     * Set the voice session manager (called after initialization)
     */
    setVoiceSessionManager(manager: VoiceSessionManager): void {
        this.voiceSessionManager = manager;
    }

    /**
     * Check if message is requesting the bot to join voice
     */
    private isVoiceJoinRequest(content: string): boolean {
        return this.VOICE_JOIN_PATTERNS.some(pattern => pattern.test(content));
    }

    /**
     * Handle voice join request - join user's voice channel
     */
    private async handleVoiceJoinRequest(message: Message): Promise<string | null> {
        if (!this.voiceSessionManager) {
            logger.warn('Voice join requested but no voice session manager available');
            return null;
        }

        if (!message.guild || !message.member) {
            return "can't join voice from dms lil bro";
        }

        // Get the user's voice channel
        const member = message.member as GuildMember;
        const voiceChannel = member.voice.channel as VoiceChannel | null;

        if (!voiceChannel) {
            return "u aint even in a vc rn 💀 get in one first";
        }

        // Check if already in this voice channel
        if (this.voiceSessionManager.isSessionActive(message.guild.id, voiceChannel.id)) {
            return "im already in there wit u gang";
        }

        try {
            logger.info(`Voice join request from ${message.author.tag} - joining ${voiceChannel.name}`);
            await this.voiceSessionManager.startSession(voiceChannel);
            return `aight bet im in ${voiceChannel.name} now wassup`;
        } catch (error) {
            logger.error('Failed to join voice channel:', error);
            if (error instanceof Error && error.message.includes('Speech service unavailable')) {
                return "cant join rn the speech shit is down fr";
            }
            return "somethin broke ion know why 💀";
        }
    }

    /**
     * Format and send prompt to bot-logs channel with edit button
     */
    async logPromptToBotLogs(guildId: string, context: {
        userName: string;
        userMessage: string;
        systemPrompt: string;
        userPrompt: string;
        model: string;
        provider: string;
        channelId?: string;
        messageId?: string;
    }): Promise<void> {
        const timestamp = new Date().toISOString();

        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;

            // Find the bot-logs channel
            const botLogsChannel = guild.channels.cache.find(
                ch => ch.name === 'bot-logs' && ch.isTextBased()
            ) as TextChannel | undefined;

            if (!botLogsChannel) {
                logger.debug(`No 'bot-logs' channel found in guild ${guildId}`);
                return;
            }

            // Store prompt in database first
            let promptLogId: string | undefined;
            try {
                const promptLog = await promptEditService.logPrompt({
                    guildId,
                    channelId: context.channelId || botLogsChannel.id,
                    messageId: context.messageId,
                    systemPrompt: context.systemPrompt,
                    userPrompt: context.userPrompt,
                    model: context.model,
                    provider: context.provider,
                });
                promptLogId = promptLog.id;
            } catch (dbError) {
                logger.warn('Failed to log prompt to database:', dbError);
            }

            // Create edit button
            const editButton = new ButtonBuilder()
                .setCustomId(`prompt_edit:${promptLogId || 'no_id'}`)
                .setLabel('✏️ Edit Prompt')
                .setStyle(ButtonStyle.Secondary);

            const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(editButton);

            // Header message with edit button
            const headerMessage = `**[${timestamp}]** AI Prompt Log
**User:** ${context.userName}
**Message:** ${context.userMessage.substring(0, 500)}${context.userMessage.length > 500 ? '...' : ''}
**Model:** ${context.model} (${context.provider})`;

            const headerSent = await botLogsChannel.send({
                content: headerMessage,
                components: promptLogId ? [actionRow] : [],
            });

            // Update prompt log with the message ID
            if (promptLogId) {
                await promptEditService.updateLogMessageId(promptLogId, headerSent.id).catch(
                    err => logger.warn('Failed to update log message ID:', err)
                );
            }

            // System prompt - split into chunks if needed
            const systemHeader = `**System Prompt (${context.systemPrompt.length} chars):**`;
            await botLogsChannel.send(systemHeader);

            // Split system prompt into ~1900 char chunks (leaving room for code block markers)
            const systemChunks = this.splitMessage(context.systemPrompt, 1900);
            for (const chunk of systemChunks) {
                await botLogsChannel.send(`\`\`\`\n${chunk}\n\`\`\``);
            }

            // User prompt - split into chunks if needed
            const userHeader = `**User Prompt (${context.userPrompt.length} chars):**`;
            await botLogsChannel.send(userHeader);

            const userChunks = this.splitMessage(context.userPrompt, 1900);
            for (const chunk of userChunks) {
                await botLogsChannel.send(`\`\`\`\n${chunk}\n\`\`\``);
            }
        } catch (error) {
            logger.warn('Failed to log prompt to bot-logs:', error);
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
