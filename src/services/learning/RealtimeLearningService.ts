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
    
    // Personality state
    private lastPersonalityUpdate: Date = new Date(0);
    private personalityUpdateIntervalMs = 300000; // 5 minutes
    private feedbackExamples: {
        serverId: string;
        channelId: string;
        messageId: string;
        content: string;
        isPositive: boolean;
        voterId: string;
        timestamp: Date;
    }[] = [];
    private lastFeedbackUpdate: Date = new Date(0);
    private feedbackUpdateIntervalMs = 300000;
    
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

        // Track slang indicators
        const slangPatterns = [
            /\b(fr|ngl|lowkey|highkey|deadass|no cap|bussin|slay|bet|goated|mid|based|cringe|sus|vibe|simp|stan|yeet|oof|bruh)\b/gi,
            /\b(lmao|lmfao|lol|rofl|kek|kekw)\b/gi,
            /💀|😭|🔥|💯|⚰️|☠️|😈|🗿/g,
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

            const insight = await this.aiService.quickPrompt(prompt);

            // Store as evolving personality memory
            const embedding = await this.aiService.generateEmbedding(insight);
            await this.repository.createServerMemory({
                serverId,
                type: 'habit',
                title: `Realtime Personality Update - ${new Date().toISOString().split('T')[0]}`,
                content: insight,
                embedding,
                metadata: {
                    isRealtimeUpdate: true,
                    messageCount: batch.messages.length,
                    topPhrases: topPhrases.map(([p]) => p),
                    topSlang: topSlang.map(([s]) => s),
                    updatedAt: new Date().toISOString(),
                },
            });

            logger.info('Updated personality from realtime learning');

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
                const embedding = await this.aiService.generateEmbedding(content);
                
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
     * Get current personality state summary
     */
    getPersonalityState(): {
        topPhrases: string[];
        topSlang: string[];
        userCount: number;
    } {
        const topPhrases = Array.from(this.phraseFrequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([p]) => p);

        const topSlang = Array.from(this.recentSlang.entries())
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 10)
            .map(([s]) => s);

        return {
            topPhrases,
            topSlang,
            userCount: this.userPatterns.size,
        };
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
            this.feedbackExamples.push({
                serverId,
                channelId,
                messageId,
                content,
                isPositive,
                voterId,
                timestamp: new Date(),
            });

            const now = Date.now();
            if (
                this.feedbackExamples.length >= 10 &&
                now - this.lastFeedbackUpdate.getTime() >= this.feedbackUpdateIntervalMs
            ) {
                await this.updatePersonalityFromFeedback(serverId);
                this.lastFeedbackUpdate = new Date();
                this.feedbackExamples = [];
            }
        } catch (error) {
            logger.error('Failed to process feedback example:', error);
        }
    }

    /**
     * Process voice transcript for personality learning
     */
    async processVoiceTranscript(
        _serverId: string,
        userId: string,
        userName: string,
        transcript: string
    ): Promise<void> {
        // Create a pseudo-message for consistent processing
        const content = transcript.toLowerCase();
        const words = content.split(/\s+/);

        // Track patterns same as text
        for (let i = 0; i < words.length - 1; i++) {
            const bigram = `${words[i]} ${words[i + 1]}`;
            const count = (this.phraseFrequency.get(bigram) || 0) + 1;
            this.phraseFrequency.set(bigram, count);
        }

        // Track slang from voice
        const slangPatterns = /\b(fr|ngl|lowkey|deadass|no cap|bet|goated|mid|based|bruh|lmao|lol)\b/gi;
        const matches = content.match(slangPatterns);
        if (matches) {
            for (const match of matches) {
                const normalized = match.toLowerCase();
                const existing = this.recentSlang.get(normalized) || { count: 0, lastSeen: new Date() };
                existing.count++;
                existing.lastSeen = new Date();
                this.recentSlang.set(normalized, existing);
            }
        }

        // Track user patterns
        let userPatternSet = this.userPatterns.get(userId);
        if (!userPatternSet) {
            userPatternSet = new Set();
            this.userPatterns.set(userId, userPatternSet);
        }
        userPatternSet.add('active_in_vc');

        logger.debug(`Processed voice transcript from ${userName} for personality learning`);
    }

    private async updatePersonalityFromFeedback(serverId: string): Promise<void> {
        const positives = this.feedbackExamples.filter(e => e.isPositive);
        const negatives = this.feedbackExamples.filter(e => !e.isPositive);

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

            const insight = await this.aiService.quickPrompt(prompt);
            const embedding = await this.aiService.generateEmbedding(insight);

            await this.repository.createServerMemory({
                serverId,
                type: 'habit',
                title: `Feedback Personality Update - ${new Date().toISOString().split('T')[0]}`,
                content: insight,
                embedding,
                metadata: {
                    isRealtimeUpdate: true,
                    isFeedbackUpdate: true,
                    positiveCount: positives.length,
                    negativeCount: negatives.length,
                    updatedAt: new Date().toISOString(),
                },
            });

            logger.info('Updated personality from explicit feedback reactions');
        } catch (error) {
            logger.error('Failed to update personality from feedback:', error);
        }
    }
}
