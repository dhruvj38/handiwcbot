/**
 * RealtimeLearningService
 * 
 * Processes ALL messages in the server in realtime to continuously build
 * and refine the bot's personality. This includes:
 * - Learning communication patterns
 * - Tracking slang and phrases
 * - Building user interaction patterns
 * - Detecting emerging memes and inside jokes
 */

import { Message } from 'discord.js';
import { AiService } from '../ai/AiService';
import { MemoryRepository } from '../memory/MemoryRepository';
import { logger } from '../../utils/logger';
import { detectNicknameRequest } from '../nickname/UserDisplayNameService';

interface MessageBatch {
    messages: ProcessedMessage[];
    channelId: string;
    startTime: Date;
}

interface ProcessedMessage {
    authorId: string;
    authorName: string;
    content: string;
    timestamp: Date;
    hasReactions: boolean;
    reactionCount: number;
    mentionedUsers: string[];
    isReply: boolean;
    replyToId?: string;
}

interface VoiceTranscript {
    userId: string;
    userName: string;
    content: string;
    timestamp: Date;
}

interface VoiceBatch {
    transcripts: VoiceTranscript[];
    serverId: string;
    startTime: Date;
}

export class RealtimeLearningService {
    private aiService: AiService;
    private repository: MemoryRepository;

    // Batch processing buffers
    private messageBatches: Map<string, MessageBatch> = new Map(); // channelId -> batch
    private batchSize = 20; // Process every 20 messages or...
    private batchTimeoutMs = 60000; // ...every 60 seconds, whichever comes first
    private batchTimers: Map<string, NodeJS.Timeout> = new Map();

    // In-memory caches for fast pattern tracking
    private phraseFrequency: Map<string, number> = new Map();
    private userPatterns: Map<string, Set<string>> = new Map(); // userId -> patterns
    private recentSlang: Map<string, { count: number; lastSeen: Date }> = new Map();
    
    // Voice transcript batches (separate from text for dedicated VC learning)
    private voiceBatches: Map<string, VoiceBatch> = new Map(); // serverId -> batch
    private voiceBatchTimers: Map<string, NodeJS.Timeout> = new Map();
    private voiceBatchSize = 15; // Process every 15 transcripts
    private voiceBatchTimeoutMs = 45000; // 45 seconds

    // Personality state
    private lastPersonalityUpdate: Date = new Date(0);
    private personalityUpdateIntervalMs = 300000; // 5 minutes for text
    private voicePersonalityUpdateIntervalMs = 120000; // 2 minutes for voice (more frequent)
    private lastVoicePersonalityUpdate: Date = new Date(0);
    private feedbackExamples: {
        serverId: string;
        channelId: string;
        messageId: string;
        content: string;
        isPositive: boolean;
        voterId: string;
        timestamp: Date;
    }[] = [];
    private feedbackThreshold = 3; // Process after 3 reactions (lowered from 10)

    constructor(aiService: AiService, repository: MemoryRepository) {
        this.aiService = aiService;
        this.repository = repository;

        // Start periodic consolidation
        this.startPeriodicConsolidation();

        logger.info('RealtimeLearningService initialized');
    }

    /**
     * Process a message for learning - called for EVERY message in the server
     */
    async processMessage(message: Message): Promise<void> {
        // Skip bot messages and empty content
        if (message.author.bot) return;
        if (!message.content.trim()) return;
        if (!message.guild) return;

        const serverId = message.guild.id;
        const channelId = message.channel.id;
        const batchKey = `${serverId}-${channelId}`;

        // Quick pattern extraction (synchronous, fast)
        this.quickPatternExtract(message);

        // Nickname learning from general messages
        const inferredNick = detectNicknameRequest(message.content);
        if (inferredNick) {
            try {
                await this.repository.updateUserNickname(
                    serverId,
                    message.author.id,
                    inferredNick,
                    'llm_inferred',
                );
            } catch (error) {
                logger.warn(
                    `Failed to store inferred nickname "${inferredNick}" for user ${message.author.id} in ${serverId} (RealtimeLearningService):`,
                    error,
                );
            }
        }

        // Add to batch for deeper processing
        const processed: ProcessedMessage = {
            authorId: message.author.id,
            authorName: message.author.displayName || message.author.username,
            content: message.content,
            timestamp: message.createdAt,
            hasReactions: message.reactions.cache.size > 0,
            reactionCount: message.reactions.cache.reduce((acc, r) => acc + r.count, 0),
            mentionedUsers: Array.from(message.mentions.users.keys()),
            isReply: !!message.reference,
            replyToId: message.reference?.messageId,
        };

        let batch = this.messageBatches.get(batchKey);
        if (!batch) {
            batch = {
                messages: [],
                channelId,
                startTime: new Date(),
            };
            this.messageBatches.set(batchKey, batch);

            // Set timeout for batch processing
            const timer = setTimeout(() => {
                this.processBatch(serverId, batchKey);
            }, this.batchTimeoutMs);
            this.batchTimers.set(batchKey, timer);
        }

        batch.messages.push(processed);

        // Check if this is a reply to the bot - potential correction/feedback
        if (message.reference?.messageId) {
            this.checkForReplyFeedback(message, serverId).catch((err: unknown) => {
                logger.warn('Failed to check reply feedback:', err);
            });
        }

        // Process batch if full
        if (batch.messages.length >= this.batchSize) {
            this.processBatch(serverId, batchKey);
        }
    }

    /**
     * Quick synchronous pattern extraction for immediate tracking
     */
    private quickPatternExtract(message: Message): void {
        const content = message.content.toLowerCase();
        const words = content.split(/\s+/);

        // Track common slang/phrases (2-3 word combinations)
        for (let i = 0; i < words.length - 1; i++) {
            const bigram = `${words[i]} ${words[i + 1]}`;
            const count = (this.phraseFrequency.get(bigram) || 0) + 1;
            this.phraseFrequency.set(bigram, count);

            // Track trigrams for longer phrases
            if (i < words.length - 2) {
                const trigram = `${bigram} ${words[i + 2]}`;
                const triCount = (this.phraseFrequency.get(trigram) || 0) + 1;
                this.phraseFrequency.set(trigram, triCount);
            }
        }

        // Track slang indicators - comprehensive list of modern slang
        const slangPatterns = [
            // Core Gen-Z slang
            /\b(fr|ngl|lowkey|highkey|deadass|no cap|bussin|slay|bet|goated|mid|based|cringe|sus|vibe|simp|stan|yeet|oof|bruh|fam|lit|flex|salty|ghosted|shook|tea|mood|savage|periodt|cap|nocap|big cap|ratio|W|L|dub|rip|rn|tbh|nah|finna|boutta|ion|imo|imho|idk|idc|wym|wyd|hmu|lmk|smh|tf|wth|wtf|ikr|ik|nvm|jk|rn|istg|ong|ight|aight|aite|dope|sick|fire|valid|bop|slaps|hits different|main character|understood the assignment|rent free|living rent free|ate|ate that|snatched|pressed|caught in 4k|no thoughts just vibes|its giving|giving|era|core|coded|canon|real|so real|felt that|this|same|facts|tho|tru|str8|hella|mad|bare|fax|ded|dead|im weak|im sleep|naur|srs|not me|pov|stan|delulu|pick me|gaslight|gatekeep|girlboss|gaslight gatekeep girlboss|understood the assignment|do it for the plot|main character energy|red flag|green flag|ick|beige flag|giving npc|npc behavior|chronically online|touch grass|go outside)\b/gi,
            // Laugh variations
            /\b(lmao|lmfao|lol|rofl|kek|kekw|lmaoo+|loool+|haha|hahaha+|hehe|lul|kekek|sksksk|💀💀|ahahah+)\b/gi,
            // Expressions and reactions
            /💀|😭|🔥|💯|⚰️|☠️|😈|🗿|😮‍💨|🤡|🗣️|📸|🤌|💅|✨|😩|🥴|👀|🙏|😤|🥶|🤝|👁️👄👁️/g,
            // Gaming/internet slang
            /\b(gg|ez|ggez|ggwp|pog|poggers|pogchamp|copium|copege|sadge|widepeeposad|pepe|pepega|monkas|5head|4head|omegalul|kappa|trihard|jebaited|weirdchamp|modcheck|forsen|xqc|sadcat|catjam|pepejam|pepelaugh|pepehands|feelsbadman|feelsgoodman|monkaw|widepeepohappy|peeposad|hypers|clueless|aware|gigachad|chad|sigma|grindset|alpha|beta|soy|soyjak|wojak|coomer|doomer|bloomer|zoomer|boomer|malding|mald|diff|skill issue|skill diff|cope|seethe|touch grass|grass|touched grass)\b/gi,
        ];

        for (const pattern of slangPatterns) {
            const matches = content.match(pattern);
            if (matches) {
                for (const match of matches) {
                    const normalized = match.toLowerCase();
                    const existing = this.recentSlang.get(normalized) || { count: 0, lastSeen: new Date() };
                    existing.count++;
                    existing.lastSeen = new Date();
                    this.recentSlang.set(normalized, existing);
                }
            }
        }

        // Track user-specific patterns
        const userId = message.author.id;
        let userPatternSet = this.userPatterns.get(userId);
        if (!userPatternSet) {
            userPatternSet = new Set();
            this.userPatterns.set(userId, userPatternSet);
        }

        // Detect capitalization style
        const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
        if (capsRatio > 0.5 && content.length > 5) {
            userPatternSet.add('caps_heavy');
        } else if (capsRatio < 0.05 && content.length > 10) {
            userPatternSet.add('lowercase_style');
        }

        // Detect punctuation style
        if (!content.includes('.') && !content.includes('!') && !content.includes('?') && content.length > 20) {
            userPatternSet.add('no_punctuation');
        }
        if ((content.match(/!/g) || []).length > 2) {
            userPatternSet.add('exclamation_heavy');
        }

        // Detect emoji usage
        const emojiCount = (content.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) || []).length;
        if (emojiCount >= 3) {
            userPatternSet.add('emoji_heavy');
        } else if (emojiCount === 0 && content.length > 30) {
            userPatternSet.add('no_emoji');
        }

        // Detect message length patterns
        const wordCount = content.split(/\s+/).length;
        if (wordCount <= 5) {
            userPatternSet.add('short_messages');
        } else if (wordCount >= 20) {
            userPatternSet.add('long_messages');
        }

        // Track unknown potential slang (words used frequently that aren't in our known list)
        this.detectPotentialNewSlang(content, userId);
    }

    private unknownTermCounts: Map<string, { count: number; users: Set<string>; contexts: string[] }> = new Map();
    private readonly SLANG_LEARN_THRESHOLD = 5; // Need 5 uses from 3+ users

    private detectPotentialNewSlang(content: string, userId: string): void {
        const words = content.toLowerCase().split(/\s+/);
        const knownSlang = new Set([
            'fr', 'ngl', 'lowkey', 'highkey', 'deadass', 'bet', 'goated', 'mid', 'based', 'bruh',
            'bussin', 'slay', 'vibe', 'valid', 'fire', 'lit', 'sus', 'cringe', 'ratio', 'fam',
            'ong', 'istg', 'finna', 'ion', 'hmu', 'lmk', 'smh', 'ikr', 'nvm', 'rn', 'ight',
            'dope', 'sick', 'facts', 'tho', 'hella', 'fax', 'ded', 'dead', 'lmao', 'lol',
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
            'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
            'must', 'shall', 'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
            'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
            'between', 'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor',
            'so', 'yet', 'both', 'either', 'neither', 'not', 'only', 'own', 'same', 'than',
            'too', 'very', 'just', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
            'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself',
            'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
            'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
            'those', 'am', 'if', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'any',
            'some', 'no', 'none', 'more', 'most', 'other', 'such', 'here', 'there', 'now',
        ]);

        for (const word of words) {
            if (word.length < 2 || word.length > 15) continue;
            if (knownSlang.has(word)) continue;
            if (/^\d+$/.test(word)) continue;
            if (/^https?:\/\//.test(word)) continue;

            let termData = this.unknownTermCounts.get(word);
            if (!termData) {
                termData = { count: 0, users: new Set(), contexts: [] };
                this.unknownTermCounts.set(word, termData);
            }

            termData.count++;
            termData.users.add(userId);
            if (termData.contexts.length < 5) {
                termData.contexts.push(content.substring(0, 100));
            }
        }
    }

    /**
     * Process a batch of messages for deeper learning
     */
    private async processBatch(serverId: string, batchKey: string): Promise<void> {
        const batch = this.messageBatches.get(batchKey);
        if (!batch || batch.messages.length === 0) return;

        // Clear the batch and timer
        this.messageBatches.delete(batchKey);
        const timer = this.batchTimers.get(batchKey);
        if (timer) {
            clearTimeout(timer);
            this.batchTimers.delete(batchKey);
        }

        logger.info(`Processing batch of ${batch.messages.length} messages from channel ${batch.channelId}`);

        try {
            // Extract conversation patterns
            const conversationPatterns = this.extractConversationPatterns(batch.messages);

            // Find messages with high reactions (good responses to learn from)
            const popularMessages = batch.messages.filter(m => m.reactionCount >= 2);

            // Generate insights using AI (throttled)
            const now = Date.now();
            if (now - this.lastPersonalityUpdate.getTime() >= this.personalityUpdateIntervalMs) {
                await this.updatePersonalityFromBatch(serverId, batch, conversationPatterns, popularMessages);
                this.lastPersonalityUpdate = new Date();
            }

            // Store relevant memories
            if (popularMessages.length > 0) {
                await this.storePopularMessagePatterns(serverId, popularMessages);
            }

        } catch (error) {
            logger.error('Failed to process message batch:', error);
        }
    }

    /**
     * Extract conversation patterns from message batch
     */
    private extractConversationPatterns(messages: ProcessedMessage[]): Array<{
        trigger: string;
        response: string;
        responseAuthor: string;
    }> {
        const patterns: Array<{
            trigger: string;
            response: string;
            responseAuthor: string;
        }> = [];

        for (let i = 1; i < messages.length; i++) {
            const prev = messages[i - 1]!;
            const curr = messages[i]!;

            // Skip same author
            if (prev.authorId === curr.authorId) continue;

            // Check time gap (within 2 minutes is conversational)
            const timeDiff = curr.timestamp.getTime() - prev.timestamp.getTime();
            if (timeDiff > 120000) continue;

            // Good response indicators
            if (curr.hasReactions || curr.isReply) {
                patterns.push({
                    trigger: prev.content,
                    response: curr.content,
                    responseAuthor: curr.authorName,
                });
            }
        }

        return patterns;
    }

    /**
     * Update personality understanding from batch
     */
    private async updatePersonalityFromBatch(
        serverId: string,
        batch: MessageBatch,
        patterns: Array<{ trigger: string; response: string; responseAuthor: string }>,
        popularMessages: ProcessedMessage[]
    ): Promise<void> {
        // Get top slang/phrases from cache
        const topPhrases = Array.from(this.phraseFrequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30)
            .filter(([_, count]) => count >= 3);

        const topSlang = Array.from(this.recentSlang.entries())
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 20);

        // Skip AI call if not much new data
        if (topPhrases.length < 5 && topSlang.length < 3) {
            return;
        }

        try {
            // Use AI to generate personality insight
            const prompt = `Analyze these real-time patterns from a Discord server to understand the communication style:

TOP PHRASES (phrase: count):
${topPhrases.map(([p, c]) => `"${p}": ${c}`).join('\n')}

TOP SLANG/EXPRESSIONS:
${topSlang.map(([s, d]) => `"${s}": used ${d.count} times`).join('\n')}

SAMPLE CONVERSATION PATTERNS:
${patterns.slice(0, 5).map(p => `Q: "${p.trigger.substring(0, 100)}"\nA: "${p.response.substring(0, 100)}"`).join('\n\n')}

POPULAR MESSAGES (got reactions):
${popularMessages.slice(0, 5).map(m => `"${m.content.substring(0, 100)}" (${m.reactionCount} reactions)`).join('\n')}

Based on this data, describe:
1. Communication style (formal/casual/chaotic)
2. Key phrases to adopt
3. Slang to use naturally
4. Response tone to match

Keep response under 200 words. Be specific.`;

            const insight = await this.aiService.quickPrompt(serverId, prompt, 500);
            const trimmedInsight = insight.trim();

            // Skip storing low-value insights (e.g. "no")
            if (!trimmedInsight || trimmedInsight.length < 40 || /^no\.?$/i.test(trimmedInsight)) {
                logger.info('Skipping text personality update: insight too short or uninformative', {
                    length: trimmedInsight.length,
                    sample: trimmedInsight.substring(0, 50),
                });
                return;
            }

            // Store as evolving personality memory
            const embedding = await this.aiService.generateEmbedding(serverId, trimmedInsight);
            await this.repository.createServerMemory({
                serverId,
                type: 'habit',
                title: `Realtime Personality Update - ${new Date().toISOString().split('T')[0]}`,
                content: trimmedInsight,
                embedding,
                metadata: {
                    isRealtimeUpdate: true,
                    messageCount: batch.messages.length,
                    topPhrases: topPhrases.map(([p]) => p),
                    topSlang: topSlang.map(([s]) => s),
                    updatedAt: new Date().toISOString(),
                },
            });

            // Detailed logging of what was learned
            const phraseSummary = topPhrases.slice(0, 5).map(([p]) => p).join(', ');
            const slangSummary = topSlang.slice(0, 5).map(([s]) => s).join(', ');
            logger.info(`💬 MEMORY UPDATE (text) | messages=${batch.messages.length} | phrases=[${phraseSummary}] | slang=[${slangSummary}]`);
            logger.info(`📝 LEARNED: ${trimmedInsight.substring(0, 150)}${trimmedInsight.length > 150 ? '...' : ''}`);

        } catch (error) {
            logger.error('Failed to update personality from batch:', error);
        }
    }

    /**
     * Store patterns from popular messages
     */
    private async storePopularMessagePatterns(
        serverId: string,
        messages: ProcessedMessage[]
    ): Promise<void> {
        for (const msg of messages) {
            try {
                const content = `Popular message by ${msg.authorName}: "${msg.content}"`;
                const embedding = await this.aiService.generateEmbedding(serverId, content);

                await this.repository.createServerMemory({
                    serverId,
                    type: 'meme',
                    title: `Popular: ${msg.content.substring(0, 50)}...`,
                    content: content,
                    embedding,
                    metadata: {
                        authorId: msg.authorId,
                        authorName: msg.authorName,
                        reactionCount: msg.reactionCount,
                        capturedAt: new Date().toISOString(),
                    },
                });
            } catch (error) {
                logger.warn('Failed to store popular message:', error);
            }
        }
    }

    /**
     * Start periodic consolidation of learned patterns
     */
    private startPeriodicConsolidation(): void {
        // Every 30 minutes, consolidate and clean up caches
        setInterval(() => {
            this.consolidatePatterns();
        }, 30 * 60 * 1000);
    }

    /**
     * Consolidate and clean up pattern caches
     */
    private consolidatePatterns(): void {
        // Remove low-frequency phrases (noise)
        for (const [phrase, count] of this.phraseFrequency.entries()) {
            if (count < 2) {
                this.phraseFrequency.delete(phrase);
            }
        }

        // Decay old slang
        const now = Date.now();
        for (const [slang, data] of this.recentSlang.entries()) {
            const age = now - data.lastSeen.getTime();
            if (age > 24 * 60 * 60 * 1000) { // 24 hours
                this.recentSlang.delete(slang);
            }
        }

        logger.info(`Consolidated patterns: ${this.phraseFrequency.size} phrases, ${this.recentSlang.size} slang`);
    }

    /**
     * Get current realtime personality state for injection into AI context
     */
    getPersonalityState(): {
        topPhrases: string[];
        topSlang: string[];
        emergingSlang: string[];
        userCount: number;
        realtimeContext: string;
    } {
        const topPhrases = Array.from(this.phraseFrequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .filter(([_, count]) => count >= 2)
            .map(([p]) => p);

        const topSlang = Array.from(this.recentSlang.entries())
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 15)
            .map(([s]) => s);

        const emergingSlang = Array.from(this.unknownTermCounts.entries())
            .filter(([_, data]) => data.count >= this.SLANG_LEARN_THRESHOLD && data.users.size >= 3)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 10)
            .map(([term]) => term);
        
        const contextParts: string[] = [];
        
        if (topSlang.length > 0) {
            contextParts.push(`SLANG TRENDING NOW: ${topSlang.join(', ')}`);
        }
        
        if (topPhrases.length > 0) {
            contextParts.push(`PHRASES PEOPLE ARE USING: ${topPhrases.slice(0, 10).join(', ')}`);
        }

        if (emergingSlang.length > 0) {
            contextParts.push(`EMERGING TERMS (server-specific): ${emergingSlang.join(', ')}`);
        }
        
        const stylePatterns: string[] = [];
        let lowercaseUsers = 0;
        let capsUsers = 0;
        let noPunctUsers = 0;
        let emojiHeavyUsers = 0;
        let shortMsgUsers = 0;
        
        for (const [_, patterns] of this.userPatterns) {
            if (patterns.has('lowercase_style')) lowercaseUsers++;
            if (patterns.has('caps_heavy')) capsUsers++;
            if (patterns.has('no_punctuation')) noPunctUsers++;
            if (patterns.has('emoji_heavy')) emojiHeavyUsers++;
            if (patterns.has('short_messages')) shortMsgUsers++;
        }
        
        if (lowercaseUsers > capsUsers && lowercaseUsers > 2) {
            stylePatterns.push('most people type in lowercase');
        } else if (capsUsers > lowercaseUsers && capsUsers > 2) {
            stylePatterns.push('people use CAPS a lot');
        }
        if (noPunctUsers > 3) {
            stylePatterns.push('punctuation is optional');
        }
        if (emojiHeavyUsers > 3) {
            stylePatterns.push('emoji heavy server');
        }
        if (shortMsgUsers > this.userPatterns.size / 2) {
            stylePatterns.push('people keep messages short');
        }
        
        if (stylePatterns.length > 0) {
            contextParts.push(`STYLE NOTES: ${stylePatterns.join('; ')}`);
        }

        return {
            topPhrases,
            topSlang,
            emergingSlang,
            userCount: this.userPatterns.size,
            realtimeContext: contextParts.join(' | '),
        };
    }

    getUserStyleProfile(userId: string): {
        capsHeavy: boolean;
        lowercaseStyle: boolean;
        noPunctuation: boolean;
        emojiHeavy: boolean;
        shortMessages: boolean;
    } | null {
        const patterns = this.userPatterns.get(userId);
        if (!patterns) return null;

        return {
            capsHeavy: patterns.has('caps_heavy'),
            lowercaseStyle: patterns.has('lowercase_style'),
            noPunctuation: patterns.has('no_punctuation'),
            emojiHeavy: patterns.has('emoji_heavy'),
            shortMessages: patterns.has('short_messages'),
        };
    }
    
    /**
     * Get realtime learning context formatted for AI system prompt
     */
    getRealtimeContextForAI(): string | null {
        const state = this.getPersonalityState();
        if (!state.realtimeContext || state.realtimeContext.length < 10) {
            return null;
        }
        return state.realtimeContext;
    }

    async processFeedbackExample(
        serverId: string,
        channelId: string,
        messageId: string,
        content: string,
        isPositive: boolean,
        voterId: string
    ): Promise<void> {
        try {
            const feedbackType = isPositive ? '👍 POSITIVE' : '👎 NEGATIVE';
            logger.info(`📝 FEEDBACK RECEIVED: ${feedbackType} | voter=${voterId} | msg="${content.substring(0, 60)}${content.length > 60 ? '...' : ''}"`);
            
            this.feedbackExamples.push({
                serverId,
                channelId,
                messageId,
                content,
                isPositive,
                voterId,
                timestamp: new Date(),
            });

            // Process immediately after threshold reached (no time cooldown)
            const serverFeedback = this.feedbackExamples.filter(e => e.serverId === serverId);

            if (serverFeedback.length >= this.feedbackThreshold) {
                logger.info(`🔄 PROCESSING FEEDBACK: ${serverFeedback.length} reactions accumulated for server ${serverId}, updating personality...`);
                await this.updatePersonalityFromFeedback(serverId, serverFeedback);
                this.feedbackExamples = this.feedbackExamples.filter(e => e.serverId !== serverId);
            } else {
                logger.info(`📊 Feedback queued for server ${serverId}: ${serverFeedback.length}/${this.feedbackThreshold} until next update`);
            }
        } catch (error) {
            logger.error('Failed to process feedback example:', error);
        }
    }

    /**
     * Process voice transcript for personality learning - now with full batch processing!
     */
    async processVoiceTranscript(
        serverId: string,
        userId: string,
        userName: string,
        transcript: string
    ): Promise<void> {
        if (!transcript || transcript.trim().length < 3) return;
        
        const content = transcript.toLowerCase();
        const words = content.split(/\s+/);

        // Quick pattern extraction (same as text messages)
        for (let i = 0; i < words.length - 1; i++) {
            const bigram = `${words[i]} ${words[i + 1]}`;
            const count = (this.phraseFrequency.get(bigram) || 0) + 1;
            this.phraseFrequency.set(bigram, count);
            
            // Also track trigrams for longer phrases
            if (i < words.length - 2) {
                const trigram = `${bigram} ${words[i + 2]}`;
                const triCount = (this.phraseFrequency.get(trigram) || 0) + 1;
                this.phraseFrequency.set(trigram, triCount);
            }
        }

        // Nickname learning from voice transcripts
        const inferredNick = detectNicknameRequest(transcript);
        if (inferredNick) {
            try {
                await this.repository.updateUserNickname(serverId, userId, inferredNick, 'llm_inferred');
            } catch (error) {
                logger.warn(
                    `Failed to store inferred nickname "${inferredNick}" for user ${userId} in ${serverId} (voice learning):`,
                    error,
                );
            }
        }

        // Track slang from voice (expanded patterns)
        const slangPatterns = [
            /\b(fr|ngl|lowkey|highkey|deadass|no cap|bet|goated|mid|based|bruh|bussin|slay|vibe|valid|fire|lit|sus|cringe|ratio|W|L|dub|fam|ong|istg|finna|ion|hmu|lmk|smh|tf|ikr|nvm|jk|rn|ight|aight|dope|sick|facts|tho|tru|hella|mad|fax|ded|dead|im weak|naur|srs|delulu|ick|npc|touch grass|skill issue|cope|seethe|mald|diff)\b/gi,
            /\b(lmao|lmfao|lol|rofl|kek|kekw|haha|hahaha|lul|sksksk)\b/gi,
            /\b(pog|poggers|gg|ggez|ggwp|copium|sadge|gigachad|sigma|grindset|alpha)\b/gi,
        ];
        
        for (const pattern of slangPatterns) {
            const matches = content.match(pattern);
            if (matches) {
                for (const match of matches) {
                    const normalized = match.toLowerCase();
                    const existing = this.recentSlang.get(normalized) || { count: 0, lastSeen: new Date() };
                    existing.count++;
                    existing.lastSeen = new Date();
                    this.recentSlang.set(normalized, existing);
                }
            }
        }

        // Track user patterns
        let userPatternSet = this.userPatterns.get(userId);
        if (!userPatternSet) {
            userPatternSet = new Set();
            this.userPatterns.set(userId, userPatternSet);
        }
        userPatternSet.add('active_in_vc');
        
        // Detect speaking style from voice
        if (words.length > 5) {
            // Check for filler words (natural speech patterns)
            const fillerCount = (content.match(/\b(like|um|uh|you know|i mean|basically|literally|actually)\b/gi) || []).length;
            if (fillerCount > 2) {
                userPatternSet.add('uses_fillers');
            }
        }

        // Add to voice batch for deeper processing
        let batch = this.voiceBatches.get(serverId);
        if (!batch) {
            batch = {
                transcripts: [],
                serverId,
                startTime: new Date(),
            };
            this.voiceBatches.set(serverId, batch);

            // Set timeout for batch processing
            const timer = setTimeout(() => {
                this.processVoiceBatch(serverId);
            }, this.voiceBatchTimeoutMs);
            this.voiceBatchTimers.set(serverId, timer);
        }

        batch.transcripts.push({
            userId,
            userName,
            content: transcript,
            timestamp: new Date(),
        });

        // Process batch if full
        if (batch.transcripts.length >= this.voiceBatchSize) {
            this.processVoiceBatch(serverId);
        }

        logger.debug(`Processed voice transcript from ${userName} for personality learning (batch size: ${batch.transcripts.length})`);
    }
    
    /**
     * Process a batch of voice transcripts for deeper learning
     */
    private async processVoiceBatch(serverId: string): Promise<void> {
        const batch = this.voiceBatches.get(serverId);
        if (!batch || batch.transcripts.length === 0) return;

        // Clear the batch and timer
        this.voiceBatches.delete(serverId);
        const timer = this.voiceBatchTimers.get(serverId);
        if (timer) {
            clearTimeout(timer);
            this.voiceBatchTimers.delete(serverId);
        }

        logger.info(`Processing voice batch of ${batch.transcripts.length} transcripts for server ${serverId}`);

        try {
            // Extract conversation patterns from voice
            const conversationPatterns = this.extractVoiceConversationPatterns(batch.transcripts);
            
            // Get top slang/phrases from cache
            const topPhrases = Array.from(this.phraseFrequency.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 30)
                .filter(([_, count]) => count >= 2);

            const topSlang = Array.from(this.recentSlang.entries())
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 20);

            // Check if we have enough new data for AI analysis (voice uses separate, faster interval)
            const now = Date.now();
            if (now - this.lastVoicePersonalityUpdate.getTime() >= this.voicePersonalityUpdateIntervalMs) {
                if (topPhrases.length >= 3 || topSlang.length >= 2 || conversationPatterns.length >= 3) {
                    await this.updatePersonalityFromVoiceBatch(serverId, batch, conversationPatterns, topPhrases, topSlang);
                    this.lastVoicePersonalityUpdate = new Date();
                } else {
                    logger.debug(`Voice batch skipped: not enough data (phrases=${topPhrases.length}, slang=${topSlang.length}, patterns=${conversationPatterns.length})`);
                }
            } else {
                const waitTime = Math.round((this.voicePersonalityUpdateIntervalMs - (now - this.lastVoicePersonalityUpdate.getTime())) / 1000);
                logger.debug(`Voice personality update cooldown: ${waitTime}s remaining`);
            }

        } catch (error) {
            logger.error('Failed to process voice batch:', error);
        }
    }
    
    /**
     * Extract conversation patterns from voice transcripts
     */
    private extractVoiceConversationPatterns(transcripts: VoiceTranscript[]): Array<{
        speaker: string;
        content: string;
        nextSpeaker?: string;
        nextContent?: string;
    }> {
        const patterns: Array<{
            speaker: string;
            content: string;
            nextSpeaker?: string;
            nextContent?: string;
        }> = [];

        for (let i = 0; i < transcripts.length - 1; i++) {
            const current = transcripts[i]!;
            const next = transcripts[i + 1]!;

            // Skip if same speaker
            if (current.userId === next.userId) continue;

            // Check time gap (within 30 seconds is conversational in VC)
            const timeDiff = next.timestamp.getTime() - current.timestamp.getTime();
            if (timeDiff > 30000) continue;

            patterns.push({
                speaker: current.userName,
                content: current.content,
                nextSpeaker: next.userName,
                nextContent: next.content,
            });
        }

        return patterns;
    }
    
    /**
     * Update personality from voice batch analysis
     */
    private async updatePersonalityFromVoiceBatch(
        serverId: string,
        batch: VoiceBatch,
        patterns: Array<{ speaker: string; content: string; nextSpeaker?: string; nextContent?: string }>,
        topPhrases: [string, number][],
        topSlang: [string, { count: number; lastSeen: Date }][]
    ): Promise<void> {
        try {
            const sampleTranscripts = batch.transcripts.slice(0, 20).map(t => 
                `${t.userName}: "${t.content.substring(0, 100)}"`
            ).join('\n');
            
            const prompt = `Analyze these VOICE CHAT patterns from a Discord server to understand how people SPEAK (not type):

VOICE TRANSCRIPTS:
${sampleTranscripts}

CONVERSATION PATTERNS (back-and-forth):
${patterns.slice(0, 8).map(p => `${p.speaker}: "${p.content}" → ${p.nextSpeaker}: "${p.nextContent}"`).join('\n')}

TOP SPOKEN PHRASES:
${topPhrases.map(([p, c]) => `"${p}": ${c}x`).join(', ')}

SPOKEN SLANG DETECTED:
${topSlang.map(([s, d]) => `"${s}": ${d.count}x`).join(', ')}

Based on VOICE chat patterns, describe:
1. How people talk in this server (casual/hype/chill/chaotic)
2. Common spoken phrases to adopt
3. Slang that's actually SPOKEN (not just typed)
4. Energy level and tone

Keep response under 200 words. Focus on SPOKEN patterns.`;

            const insight = await this.aiService.quickPrompt(serverId, prompt, 500);
            const trimmedInsight = insight.trim();

            // Skip storing low-value insights (e.g. "no")
            if (!trimmedInsight || trimmedInsight.length < 40 || /^no\.?$/i.test(trimmedInsight)) {
                logger.info('Skipping voice personality update: insight too short or uninformative', {
                    length: trimmedInsight.length,
                    sample: trimmedInsight.substring(0, 50),
                });
                return;
            }

            // Store as voice-specific personality memory
            const embedding = await this.aiService.generateEmbedding(serverId, trimmedInsight);
            await this.repository.createServerMemory({
                serverId,
                type: 'habit',
                title: `Voice Chat Style Update - ${new Date().toISOString().split('T')[0]}`,
                content: `[FROM VOICE CHAT] ${trimmedInsight}`,
                embedding,
                metadata: {
                    isRealtimeUpdate: true,
                    isVoiceUpdate: true,
                    transcriptCount: batch.transcripts.length,
                    topPhrases: topPhrases.map(([p]) => p),
                    topSlang: topSlang.map(([s]) => s),
                    updatedAt: new Date().toISOString(),
                },
            });

            // Detailed logging of what was learned
            const phraseSummary = topPhrases.slice(0, 5).map(([p]) => p).join(', ');
            const slangSummary = topSlang.slice(0, 5).map(([s]) => s).join(', ');
            logger.info(`🎙️ MEMORY UPDATE (voice) | transcripts=${batch.transcripts.length} | phrases=[${phraseSummary}] | slang=[${slangSummary}]`);
            logger.info(`📝 LEARNED: ${trimmedInsight.substring(0, 150)}${trimmedInsight.length > 150 ? '...' : ''}`);

        } catch (error) {
            logger.error('Failed to update personality from voice batch:', error);
        }
    }

    private async updatePersonalityFromFeedback(
        serverId: string,
        examples: {
            serverId: string;
            channelId: string;
            messageId: string;
            content: string;
            isPositive: boolean;
            voterId: string;
            timestamp: Date;
        }[]
    ): Promise<void> {
        const positives = examples.filter(e => e.isPositive);
        const negatives = examples.filter(e => !e.isPositive);

        if (positives.length === 0 && negatives.length === 0) {
            return;
        }

        try {
            const positiveSamples = positives
                .slice(0, 20)
                .map(e => `GOOD: "${e.content.substring(0, 200)}"`)
                .join('\n');

            const negativeSamples = negatives
                .slice(0, 20)
                .map(e => `BAD: "${e.content.substring(0, 200)}"`)
                .join('\n');

            const prompt = `Users reacted to these bot messages with green (good) and red (bad) circles.

Green = good responses:
${positiveSamples || '(none yet)'}

Red = bad responses:
${negativeSamples || '(none yet)'}

From this feedback, extract concrete guidelines to adjust the bot's personality and style.

Output 5-10 bullet rules starting with "Do..." or "Avoid..." that describe how the bot should talk more like the good responses and less like the bad ones.`;

            const insight = await this.aiService.quickPrompt(serverId, prompt, 500);
            const trimmedInsight = insight.trim();

            // Skip storing low-value insights (e.g. "no")
            if (!trimmedInsight || trimmedInsight.length < 40 || /^no\.?$/i.test(trimmedInsight)) {
                logger.info('Skipping feedback personality update: insight too short or uninformative', {
                    length: trimmedInsight.length,
                    sample: trimmedInsight.substring(0, 50),
                });
                return;
            }

            const embedding = await this.aiService.generateEmbedding(serverId, trimmedInsight);

            await this.repository.createServerMemory({
                serverId,
                type: 'habit',
                title: `Feedback Personality Update - ${new Date().toISOString().split('T')[0]}`,
                content: trimmedInsight,
                embedding,
                metadata: {
                    isRealtimeUpdate: true,
                    isFeedbackUpdate: true,
                    positiveCount: positives.length,
                    negativeCount: negatives.length,
                    updatedAt: new Date().toISOString(),
                },
            });

            // Detailed logging of what was learned
            logger.info(`🎯 MEMORY UPDATE (feedback) | positive=${positives.length} | negative=${negatives.length}`);
            logger.info(`📝 LEARNED: ${trimmedInsight.substring(0, 200)}${trimmedInsight.length > 200 ? '...' : ''}`);
        } catch (error) {
            logger.error('Failed to update personality from feedback:', error);
        }
    }

    /**
     * Check if a message is a reply to the bot and contains corrective feedback
     */
    private async checkForReplyFeedback(message: Message, serverId: string): Promise<void> {
        try {
            // Safety check
            if (!message.reference?.messageId) return;

            // Fetch the referenced message
            const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);

            // Only process if the referenced message is from the bot
            if (!referencedMsg.author.bot) return;

            const replyContent = message.content.toLowerCase();

            // Detect correction indicators in the reply
            const correctionIndicators = [
                /why did you/i,
                /don't say/i,
                /don't use/i,
                /never say/i,
                /never use/i,
                /that('s| is) (weird|cringe|wrong|bad|incorrect|not right)/i,
                /doesn't make sense/i,
                /stop saying/i,
                /stop using/i,
                /you should(n't| not)/i,
                /what's wrong with you/i,
                /why would you/i,
                /that's not how/i,
            ];

            const hasCorrection = correctionIndicators.some(pattern => pattern.test(replyContent));

            if (hasCorrection) {
                logger.info(`Detected potential correction in reply from ${message.author.tag}`);
                await this.processCorrection(serverId, referencedMsg.content, message.content, message.author.username);
            }
        } catch (error) {
            logger.warn('Failed to check reply feedback:', error);
        }
    }

    /**
     * Process a correction and create a learning rule
     */
    private async processCorrection(
        serverId: string,
        botMessage: string,
        userCorrection: string,
        userName: string
    ): Promise<void> {
        try {
            const prompt = `A user is correcting the bot's response. Analyze this exchange and extract a specific rule for the bot to follow.

Bot said: "${botMessage.substring(0, 300)}"
User replied: "${userCorrection.substring(0, 300)}"

Extract a clear, actionable rule that the bot should follow to avoid this mistake. Format as a single "Do..." or "Avoid..." statement. Be specific about what was wrong and how to fix it.

Example outputs:
- "Avoid using the word 'lol' - it comes across as cringe in this server"
- "Don't use formal language like 'certainly' - always keep it casual"
- "Never use that emoji - it's not appropriate here"

Your rule (one sentence):`;

            const rule = await this.aiService.quickPrompt(serverId, prompt);

            if (!rule || rule.length < 10) {
                logger.warn('Failed to extract meaningful correction rule');
                return;
            }

            // Store as a correction habit
            const embedding = await this.aiService.generateEmbedding(serverId, rule);
            await this.repository.createServerMemory({
                serverId,
                type: 'habit',
                title: `CORRECTION from ${userName} - ${new Date().toISOString().split('T')[0]}`,
                content: `CORRECTION: ${rule}`,
                embedding,
                metadata: {
                    isRealtimeUpdate: true,
                    isCorrection: true,
                    correctedBy: userName,
                    botMessage: botMessage.substring(0, 200),
                    userFeedback: userCorrection.substring(0, 200),
                    correctedAt: new Date().toISOString(),
                },
            });

            logger.info(`Processed correction feedback: "${rule}"`);
        } catch (error) {
            logger.error('Failed to process correction:', error);
        }
    }
}
