/**
 * LAYER 5: User Profile Builder (AI-Powered)
 * Build detailed profiles for each active user using Gemini-3-Pro-Preview
 * Extracts EXACT typing style, speech patterns, and personality
 */

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { config } from '../../config';
import { modelRouter } from '../ai/ModelRouter';
import { logger } from '../../utils/logger';
import { sleep } from '../../utils/helpers';
import { RawMessage, SessionSummary, ServerBible, ProgressCallback } from './types';

// Safety settings to allow processing of casual Discord conversations
const PERMISSIVE_SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
];

export class UserProfileBuilder {
    private client: GoogleGenAI;

    // Rate limiting to avoid 429s
    private readonly PARALLEL_LIMIT = 3; // Moderate parallelism
    private readonly DELAY_BETWEEN_BATCHES_MS = 2000; // 2s between batches
    private readonly MAX_RETRIES = 3; // Reduced retries since we have fallback
    private readonly BASE_RETRY_DELAY_MS = 3000;

    // Progress tracking
    private processedCount = 0;
    private aiSuccessCount = 0;
    private fallbackCount = 0;
    private totalUsers = 0;

    constructor() {
        this.client = new GoogleGenAI({ apiKey: config.ai.apiKey });
        // this.proModel is now resolved dynamically per guild
    }

    async build(
        guildId: string,
        messages: RawMessage[],
        members: { id: string; displayName: string; username: string; roles: string[] }[],
        _summaries: SessionSummary[],
        onProgress?: ProgressCallback
    ): Promise<ServerBible['userProfiles']> {
        const updateStatus = async (msg: string) => {
            logger.info(msg);
            if (onProgress) await onProgress(msg);
        };

        // Group messages by user
        const messagesByUser: Record<string, RawMessage[]> = {};
        for (const msg of messages) {
            if (!messagesByUser[msg.authorId]) {
                messagesByUser[msg.authorId] = [];
            }
            messagesByUser[msg.authorId]!.push(msg);
        }

        // Get top users by message count (top 30 for AI analysis)
        const topUsers = Object.entries(messagesByUser)
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 30);

        // Reset progress tracking
        this.processedCount = 0;
        this.aiSuccessCount = 0;
        this.fallbackCount = 0;
        this.totalUsers = topUsers.length;

        await updateStatus(this.formatProgress());

        // Resolve model dynamically for this guild
        const resolved = await modelRouter.resolve(guildId, 'analysis');
        const proModel = resolved.model;

        logger.info(`🔬 [Analysis] Building user profiles using model: ${proModel}`);

        const profiles: ServerBible['userProfiles'] = [];

        // Process users in parallel batches
        for (let i = 0; i < topUsers.length; i += this.PARALLEL_LIMIT) {
            const batch = topUsers.slice(i, i + this.PARALLEL_LIMIT);

            const batchPromises = batch.map(async ([userId, userMsgs]) => {
                const member = members.find(m => m.id === userId);
                if (!member) return null;

                let result: ServerBible['userProfiles'][0];
                if (userMsgs.length >= 50) {
                    result = await this.aiAnalyzeUserWithRetry(member, userMsgs, proModel);
                } else {
                    result = this.quickAnalyzeUser(member, userMsgs);
                    this.fallbackCount++;
                }
                this.processedCount++;
                return result;
            });

            const batchResults = await Promise.all(batchPromises);
            for (const result of batchResults) {
                if (result) profiles.push(result);
            }

            // Update progress after each batch
            await updateStatus(this.formatProgress());

            // Delay between batches to avoid rate limits
            if (i + this.PARALLEL_LIMIT < topUsers.length) {
                await sleep(this.DELAY_BETWEEN_BATCHES_MS);
            }
        }

        // Add remaining users with quick analysis
        const remainingUsers = Object.entries(messagesByUser)
            .sort((a, b) => b[1].length - a[1].length)
            .slice(30, 50);

        for (const [userId, userMsgs] of remainingUsers) {
            const member = members.find(m => m.id === userId);
            if (!member) continue;
            profiles.push(this.quickAnalyzeUser(member, userMsgs));
        }

        return profiles;
    }

    /**
     * Format live progress display for Discord
     */
    private formatProgress(): string {
        const percent = this.totalUsers > 0
            ? Math.round((this.processedCount / this.totalUsers) * 100)
            : 0;
        const barLength = 20;
        const filled = Math.round(barLength * percent / 100);
        const progressBar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

        return [
            `👥 **LAYER 5/6: User Profiles**`,
            ``,
            `\`${progressBar}\` **${percent}%**`,
            ``,
            `📊 Progress: **${this.processedCount}** / **${this.totalUsers}** users`,
            `✅ AI Analysis: **${this.aiSuccessCount}**`,
            `📋 Quick Fallback: **${this.fallbackCount}**`,
        ].join('\n');
    }

    /**
     * AI analyze with retry and graceful fallback to quick analysis
     */
    private async aiAnalyzeUserWithRetry(
        member: { id: string; displayName: string; username: string; roles: string[] },
        messages: RawMessage[],
        model: string
    ): Promise<ServerBible['userProfiles'][0]> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
            try {
                const result = await this.aiAnalyzeUser(member, messages, model);
                this.aiSuccessCount++;
                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const errAny = error as any;

                const is429 = errAny?.status === 429 || errAny?.code === 429 ||
                    /RESOURCE_EXHAUSTED|429|rate/i.test(lastError.message);

                if (is429) {
                    const delay = this.BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
                    await sleep(delay);
                } else if (/JSON|parse|position|escaped|Expected/i.test(lastError.message)) {
                    await sleep(500);
                } else {
                    await sleep(1000);
                }
            }
        }

        // Graceful fallback to quick analysis instead of crashing
        logger.warn(`AI analysis failed for ${member.displayName}, using quick fallback: ${lastError?.message?.substring(0, 80)}`);
        this.fallbackCount++;
        return this.quickAnalyzeUser(member, messages);
    }

    /**
     * Deep AI analysis of a user's typing style and personality
     */
    private async aiAnalyzeUser(
        member: { id: string; displayName: string; username: string; roles: string[] },
        messages: RawMessage[],
        model: string
    ): Promise<ServerBible['userProfiles'][0]> {
        // Sample diverse messages for analysis
        const sampleMessages = this.selectDiverseSample(messages, 80);
        const messageText = sampleMessages.map(m => m.content).join('\n');

        // Pre-compute basic stats for context
        const stats = this.computeTypingStats(messages);

        const prompt = `You are a linguistics expert analyzing a Discord user's EXACT writing style to create a perfect mimic guide.

USER: ${member.displayName} (@${member.username})
ROLES: ${member.roles.join(', ') || 'none'}
MESSAGE COUNT: ${messages.length}

QUANTIFIED STATS (pre-computed):
- Lowercase messages: ${stats.lowercaseRatio}%
- Messages with punctuation: ${stats.punctuationRatio}%
- Avg message length: ${stats.avgWords} words
- Uses emojis: ${stats.emojiRatio}% of messages
- Top emojis: ${stats.topEmojis.join(' ')}

SAMPLE MESSAGES FROM THIS USER:
${messageText}

Analyze their EXACT style and output JSON:
{
    "personality": "2-3 word personality summary (like 'chill shitposter' or 'hype energy' or 'dry humor')",
    "typingStyle": {
        "caps": "how they use caps: never/rare/for_emphasis/frequent",
        "punctuation": "none/minimal/selective (like only ? not .)/proper",
        "grammar": "intentionally bad/casual/proper",
        "abbreviations": ["list", "of", "abbreviations", "they", "use", "like", "u", "ur", "rn", "ngl"]
    },
    "speechPatterns": [
        "specific patterns like 'starts sentences with bro'",
        "or 'ends messages with lmao'",
        "or 'uses ... instead of periods'",
        "be very specific to THIS user"
    ],
    "catchphrases": ["exact phrases they repeat often"],
    "sentenceStarters": ["words they start messages with"],
    "sentenceEnders": ["words/emojis they end messages with"],
    "howTheyExpress": {
        "agreement": ["how they say yes/agree like 'bet', 'fr', 'facts'"],
        "disagreement": ["how they say no/disagree"],
        "excitement": ["how they show hype"],
        "humor": ["how they react to funny things"]
    },
    "quirks": ["unique behaviors like 'double texts', 'keysmashes', 'random caps for emphasis'"],
    "interests": ["topics they talk about most"],
    "howToMimicThem": "One paragraph instruction on how to perfectly copy this person's typing style"
}`;

        const response = await this.client.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                systemInstruction: 'You are a linguistics expert analyzing Discord user writing styles. The content may contain informal language, slang, or profanity - this is normal for Discord. Always respond with valid JSON.',
                maxOutputTokens: 2000,
                temperature: 0.3,
                responseMimeType: 'application/json',
                safetySettings: PERMISSIVE_SAFETY_SETTINGS,
            },
        });

        // Check for empty or blocked response
        const rawText = response.text;
        if (!rawText || rawText.trim().length === 0) {
            const candidates = (response as any).candidates || [];
            const blockReason = candidates[0]?.finishReason || 'unknown';
            throw new Error(`Empty AI response for user ${member.displayName} - blockReason: ${blockReason}`);
        }
        const result = this.safeJsonParse(rawText);

        return {
            userId: member.id,
            displayName: member.displayName,
            personality: result.personality || 'casual',
            speechPatterns: [
                ...(result.speechPatterns || []),
                ...(result.typingStyle?.abbreviations?.map((a: string) => `uses "${a}"`) || []),
            ].slice(0, 15),
            interests: result.interests || [],
            quirks: result.quirks || [],
            howToInteract: result.howToMimicThem || `Match their ${result.personality || 'casual'} energy`,
            relationshipToOthers: [],
            catchphrases: result.catchphrases || [],
            sentenceStarters: result.sentenceStarters || [],
            sentenceEnders: result.sentenceEnders || [],
            howTheyExpress: result.howTheyExpress || {},
            exampleMessages: sampleMessages.slice(0, 10).map(m => m.content),
        } as ServerBible['userProfiles'][0];
    }

    /**
     * Robust JSON parsing with multiple repair strategies
     */
    private safeJsonParse(text: string): any {
        // Clean the text first
        let cleaned = text.trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

        // Try direct parse first
        try {
            return JSON.parse(cleaned);
        } catch { /* continue */ }

        // Try to extract JSON object from text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch { /* continue */ }
        }

        // Fix common issues
        let repaired = cleaned;
        repaired = repaired.replace(/,\s*([}\]])/g, '$1');

        // Fix missing closing brackets for truncated responses
        const openBraces = (repaired.match(/\{/g) || []).length;
        const closeBraces = (repaired.match(/\}/g) || []).length;
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/\]/g) || []).length;

        repaired = repaired.replace(/,\s*"[^"]*$/g, '');
        repaired = repaired.replace(/:\s*"[^"]*$/g, ': ""');
        repaired = repaired.replace(/:\s*\[[^\]]*$/g, ': []');
        repaired = repaired.replace(/,\s*$/g, '');

        repaired += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
        repaired += '}'.repeat(Math.max(0, openBraces - closeBraces));

        try {
            return JSON.parse(repaired);
        } catch { /* continue */ }

        // Extract individual fields as last resort
        const result: any = {};
        const personalityMatch = repaired.match(/"personality"\s*:\s*"([^"]*)"/i);
        if (personalityMatch) result.personality = personalityMatch[1];

        const mimicMatch = repaired.match(/"howToMimicThem"\s*:\s*"([^"]*)"/i);
        if (mimicMatch) result.howToMimicThem = mimicMatch[1];

        if (result.personality) {
            return result;
        }

        throw new Error(`JSON parse failed after all strategies: ${text.substring(0, 80)}...`);
    }

    /**
     * Quick local analysis for less active users
     */
    private quickAnalyzeUser(
        member: { id: string; displayName: string; username: string; roles: string[] },
        messages: RawMessage[]
    ): ServerBible['userProfiles'][0] {
        const stats = this.computeTypingStats(messages);

        const speechPatterns: string[] = [];
        if (stats.lowercaseRatio > 80) speechPatterns.push('types in all lowercase');
        if (stats.lowercaseRatio < 20) speechPatterns.push('uses proper capitalization');
        if (stats.punctuationRatio < 30) speechPatterns.push('skips punctuation');
        if (stats.avgWords < 5) speechPatterns.push('sends short messages');
        if (stats.avgWords > 20) speechPatterns.push('writes longer messages');
        if (stats.emojiRatio > 50) speechPatterns.push('heavy emoji user');

        // Extract common phrases
        const phrases = this.extractCommonPhrases(messages);
        speechPatterns.push(...phrases.map(p => `says "${p}"`));

        return {
            userId: member.id,
            displayName: member.displayName,
            personality: this.guessPersonality(messages),
            speechPatterns: speechPatterns.slice(0, 10),
            interests: this.detectInterests(messages),
            quirks: this.detectQuirks(messages, stats),
            howToInteract: `Active user with ${messages.length} messages`,
            relationshipToOthers: [],
        };
    }

    /**
     * Select a diverse sample of messages (not just random)
     */
    private selectDiverseSample(messages: RawMessage[], count: number): RawMessage[] {
        const sample: RawMessage[] = [];

        // Get messages of different lengths
        const short = messages.filter(m => m.content.length < 30);
        const medium = messages.filter(m => m.content.length >= 30 && m.content.length < 100);
        const long = messages.filter(m => m.content.length >= 100);

        // Get messages with reactions (these are usually more representative)
        const withReactions = messages.filter(m => m.reactions.length > 0);

        // Mix them proportionally
        const addRandom = (arr: RawMessage[], n: number) => {
            const shuffled = [...arr].sort(() => Math.random() - 0.5);
            sample.push(...shuffled.slice(0, n));
        };

        addRandom(withReactions, Math.min(20, withReactions.length));
        addRandom(short, Math.min(20, short.length));
        addRandom(medium, Math.min(25, medium.length));
        addRandom(long, Math.min(15, long.length));

        // Fill remaining with random
        if (sample.length < count) {
            const remaining = messages.filter(m => !sample.includes(m));
            addRandom(remaining, count - sample.length);
        }

        return sample.slice(0, count);
    }

    /**
     * Compute quantified typing statistics
     */
    private computeTypingStats(messages: RawMessage[]): {
        lowercaseRatio: number;
        punctuationRatio: number;
        avgWords: number;
        emojiRatio: number;
        topEmojis: string[];
    } {
        const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;

        let lowercaseCount = 0;
        let punctuationCount = 0;
        let totalWords = 0;
        let emojiCount = 0;
        const emojiCounts: Record<string, number> = {};

        for (const msg of messages) {
            const content = msg.content;

            // Check if mostly lowercase
            if (content === content.toLowerCase()) lowercaseCount++;

            // Check for ending punctuation
            if (/[.!?]$/.test(content.trim())) punctuationCount++;

            // Word count
            totalWords += content.split(/\s+/).filter(w => w.length > 0).length;

            // Emoji analysis
            const emojis = content.match(emojiPattern) || [];
            if (emojis.length > 0) emojiCount++;
            for (const e of emojis) {
                emojiCounts[e] = (emojiCounts[e] || 0) + 1;
            }
        }

        const topEmojis = Object.entries(emojiCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([e]) => e);

        return {
            lowercaseRatio: Math.round((lowercaseCount / messages.length) * 100),
            punctuationRatio: Math.round((punctuationCount / messages.length) * 100),
            avgWords: Math.round(totalWords / messages.length),
            emojiRatio: Math.round((emojiCount / messages.length) * 100),
            topEmojis,
        };
    }

    /**
     * Extract common 2-3 word phrases
     */
    private extractCommonPhrases(messages: RawMessage[]): string[] {
        const phraseCount: Record<string, number> = {};

        for (const msg of messages) {
            const words = msg.content.toLowerCase().split(/\s+/);
            // 2-word phrases
            for (let i = 0; i < words.length - 1; i++) {
                const phrase = `${words[i]} ${words[i + 1]}`;
                if (phrase.length > 4) {
                    phraseCount[phrase] = (phraseCount[phrase] || 0) + 1;
                }
            }
        }

        return Object.entries(phraseCount)
            .filter(([_, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([phrase]) => phrase);
    }

    /**
     * Quick personality guess from message patterns
     */
    private guessPersonality(messages: RawMessage[]): string {
        const allContent = messages.map(m => m.content).join(' ').toLowerCase();
        const traits: string[] = [];

        if (/lmao|💀|dead|lol/.test(allContent)) traits.push('humorous');
        if (/fr|ong|no cap|facts/.test(allContent)) traits.push('real');
        if (/!{2,}|LETS|POG|YOOO/.test(messages.map(m => m.content).join(' '))) traits.push('hype');
        if (messages.filter(m => m.content.length < 20).length / messages.length > 0.7) traits.push('terse');

        return traits.length > 0 ? traits.slice(0, 2).join(' ') : 'casual';
    }

    private detectInterests(messages: RawMessage[]): string[] {
        const topicIndicators: Record<string, RegExp> = {
            gaming: /game|play|stream|twitch|steam|xbox|playstation|nintendo|fps|mmo|rpg|gg|queue|ranked/i,
            music: /song|album|artist|spotify|playlist|listen|band|concert|music/i,
            anime: /anime|manga|waifu|weeb|sub|dub|season|episode/i,
            sports: /sports|football|basketball|soccer|nfl|nba|team|player/i,
            tech: /code|programming|computer|tech|software|developer|github/i,
            movies: /movie|film|watch|netflix|show|series/i,
            food: /food|eat|hungry|restaurant|cook|recipe/i,
            memes: /meme|shitpost|copypasta|based|cringe|ratio/i,
        };

        const scores: Record<string, number> = {};
        for (const msg of messages) {
            for (const [topic, pattern] of Object.entries(topicIndicators)) {
                if (pattern.test(msg.content)) {
                    scores[topic] = (scores[topic] || 0) + 1;
                }
            }
        }

        return Object.entries(scores)
            .filter(([_, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([topic]) => topic);
    }

    private detectQuirks(messages: RawMessage[], stats: ReturnType<typeof this.computeTypingStats>): string[] {
        const quirks: string[] = [];

        if (stats.emojiRatio > 60) quirks.push('emoji spammer');
        if (stats.emojiRatio < 5) quirks.push('no emoji andy');
        if (stats.avgWords > 25) quirks.push('writes essays');
        if (stats.avgWords < 4) quirks.push('one word responses');

        // Check for keysmashing
        const keysmashes = messages.filter(m => /[asdf]{4,}|[hjkl]{4,}/i.test(m.content)).length;
        if (keysmashes > 3) quirks.push('keysmashes when excited');

        // Check for double texting
        let doubleTexts = 0;
        for (let i = 1; i < messages.length; i++) {
            if (messages[i]!.timestamp.getTime() - messages[i - 1]!.timestamp.getTime() < 5000) {
                doubleTexts++;
            }
        }
        if (doubleTexts / messages.length > 0.2) quirks.push('double texter');

        return quirks;
    }
}
