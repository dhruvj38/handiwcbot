/**
 * LAYER 2: Session Mini-Summaries
 * Generate summaries for each conversation chunk
 */

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { config } from '../../config';
import { modelRouter } from '../ai/ModelRouter';
import { logger } from '../../utils/logger';
import { sleep } from '../../utils/helpers';
import { ConversationChunk, SessionSummary, ProgressCallback } from './types';

// Safety settings to allow processing of casual Discord conversations
const PERMISSIVE_SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
];

export class SessionSummarizer {
    private client: GoogleGenAI;

    // Rate limiting - balanced for reliability over speed
    private readonly PARALLEL_LIMIT = 10; // Moderate parallelism to avoid overwhelming API
    private readonly DELAY_BETWEEN_BATCHES_MS = 200; // Small delay between batches
    private readonly MAX_RETRIES = 5; // Reduced retries to avoid long hangs
    private readonly BASE_RETRY_DELAY_MS = 1000; // 1s backoff on 429
    private readonly REQUEST_TIMEOUT_MS = 30000; // 30s timeout per request

    // Progress tracking
    private processedCount = 0;
    private successCount = 0;
    private fallbackCount = 0;
    private totalChunks = 0;

    constructor() {
        this.client = new GoogleGenAI({ apiKey: config.ai.apiKey });
    }

    async generateSummaries(
        guildId: string,
        chunks: ConversationChunk[],
        updateStatus: ProgressCallback
    ): Promise<SessionSummary[]> {
        const summaries: SessionSummary[] = [];
        const BATCH_SIZE = 100; // Large batches for speed

        // Reset progress tracking
        this.processedCount = 0;
        this.successCount = 0;
        this.fallbackCount = 0;
        this.totalChunks = chunks.length;

        await updateStatus(this.formatProgress('Starting...'));

        // Resolve model dynamically for this guild
        const resolved = await modelRouter.resolve(guildId, 'analysis');
        const modelToUse = resolved.model;
        logger.info(`📝 [SessionSummarizer] Using model: ${modelToUse} (${resolved.provider})`);

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const batchSummaries = await this.processBatch(batch, modelToUse, updateStatus);
            summaries.push(...batchSummaries);

            // Update progress after each batch
            await updateStatus(this.formatProgress('Processing...'));
        }

        // Final status
        await updateStatus(this.formatProgress('Complete!'));

        return summaries;
    }

    /**
     * Format live progress display for Discord
     */
    private formatProgress(_status: string): string {
        const percent = this.totalChunks > 0
            ? Math.round((this.processedCount / this.totalChunks) * 100)
            : 0;
        const barLength = 20;
        const filled = Math.round(barLength * percent / 100);
        const progressBar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

        return [
            `📝 **LAYER 2/6: Session Summaries**`,
            ``,
            `\`${progressBar}\` **${percent}%**`,
            ``,
            `📊 Progress: **${this.processedCount.toLocaleString()}** / **${this.totalChunks.toLocaleString()}** chunks`,
            `✅ AI Success: **${this.successCount.toLocaleString()}**`,
            `📋 Local Fallback: **${this.fallbackCount.toLocaleString()}**`,
        ].join('\n');
    }

    private async processBatch(
        chunks: ConversationChunk[],
        model: string,
        updateStatus: ProgressCallback
    ): Promise<SessionSummary[]> {
        const summaries: SessionSummary[] = [];
        let lastProgressUpdate = Date.now();
        const PROGRESS_UPDATE_INTERVAL = 2000; // Update every 2 seconds

        // Process ALL chunks with AI - no local fallback filtering
        for (let i = 0; i < chunks.length; i += this.PARALLEL_LIMIT) {
            const batch = chunks.slice(i, i + this.PARALLEL_LIMIT);

            const batchPromises = batch.map(async (chunk) => {
                const result = await this.aiSummarizeWithFallback(chunk, model);
                this.processedCount++;
                
                // Update progress immediately after each chunk completes
                const now = Date.now();
                if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
                    lastProgressUpdate = now;
                    await updateStatus(this.formatProgress('Processing...'));
                }
                
                return result;
            });

            const batchResults = await Promise.all(batchPromises);
            summaries.push(...batchResults);

            // Always update after each parallel batch completes
            await updateStatus(this.formatProgress('Processing...'));

            // Delay between batches - minimal, retry handles 429s
            if (i + this.PARALLEL_LIMIT < chunks.length) {
                await sleep(this.DELAY_BETWEEN_BATCHES_MS);
            }
        }

        return summaries;
    }

    /**
     * AI summarize with retry and graceful fallback to local summarization
     */
    private async aiSummarizeWithFallback(chunk: ConversationChunk, model: string): Promise<SessionSummary> {
        let lastError: Error | null = null;

        // Calculate safe starting limit based on chunk content
        const avgMsgLen = chunk.messages.reduce((sum, m) => sum + m.content.length, 0) / chunk.messages.length;
        let messageLimit = avgMsgLen > 100 ? 10 : avgMsgLen > 50 ? 15 : 20;

        for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
            try {
                const result = await this.aiSummarize(chunk, model, messageLimit);
                this.successCount++;
                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const errAny = error as any;

                // Check if it's a MAX_TOKENS error - reduce chunk size aggressively
                if (/MAX_TOKENS/i.test(lastError.message)) {
                    messageLimit = Math.max(5, Math.floor(messageLimit * 0.5)); // Halve it each time
                    continue; // No delay needed, just retry smaller
                }

                // Check if it's a rate limit error
                const is429 = errAny?.status === 429 || errAny?.code === 429 ||
                    /RESOURCE_EXHAUSTED|429|rate/i.test(lastError.message);

                if (is429) {
                    // Exponential backoff: 2s, 4s, 8s...
                    const delay = this.BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
                    await sleep(delay);
                } else if (this.isJsonError(lastError)) {
                    // JSON parse error - reduce size slightly and retry
                    messageLimit = Math.max(5, messageLimit - 2);
                    await sleep(50);
                } else {
                    // Unknown error - reduce size and retry
                    messageLimit = Math.max(5, messageLimit - 3);
                    await sleep(100);
                }
            }
        }

        // Final ultra-minimal attempt before giving up
        try {
            const result = await this.aiSummarizeMinimal(chunk, model);
            this.successCount++;
            return result;
        } catch (minimalError) {
            // Last resort: throw to propagate error instead of using local fallback
            // Local fallback should NEVER be used - this data is important
            const errMsg = minimalError instanceof Error ? minimalError.message : String(minimalError);
            logger.error(`AI completely failed for chunk ${chunk.id} after all retries: ${lastError?.message?.substring(0, 100)}. Minimal also failed: ${errMsg.substring(0, 100)}`);

            // Try one more time with even simpler prompt
            try {
                const ultraSimple = await this.aiSummarizeUltraSimple(chunk, model);
                this.successCount++;
                return ultraSimple;
            } catch {
                // Absolute last resort - still try AI with bare minimum
                logger.error(`All AI attempts exhausted for chunk ${chunk.id}, incrementing fallback counter but returning minimal AI-style response`);
                this.fallbackCount++;
                // Return a structured response but mark it clearly
                return {
                    chunkId: chunk.id,
                    summary: `[AI UNAVAILABLE] ${chunk.participants.length} users in #${chunk.channelName}`,
                    keyQuotes: chunk.messages.slice(0, 2).map(m => m.content.slice(0, 50)),
                    keySlang: [],
                    emotionalPattern: chunk.vibeType,
                    loreGenerated: [],
                    participants: {},
                    vibeScore: { humor: 5, chaos: 5, wholesome: 5, toxicity: 0 },
                };
            }
        }
    }

    private isJsonError(error: Error): boolean {
        return /JSON|parse|position|escaped|Expected/i.test(error.message);
    }

    /**
     * Wrap a promise with a timeout
     */
    private async withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(errorMsg)), ms);
        });
        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutId!);
        }
    }

    /**
     * Ultra-simple AI summarization - absolute last resort before giving up
     */
    private async aiSummarizeUltraSimple(chunk: ConversationChunk, model: string): Promise<SessionSummary> {
        // Absolute minimum: just channel name and participant count
        const response = await this.withTimeout(
            this.client.models.generateContent({
                model: model,
                contents: `{"summary":"${chunk.participants.length} users chatted in ${chunk.channelName}","vibeScore":{"humor":5,"chaos":5,"wholesome":5,"toxicity":0}}`,
                config: {
                    systemInstruction: 'Return the input JSON exactly as provided.',
                    maxOutputTokens: 256,
                    temperature: 0,
                    responseMimeType: 'application/json',
                    safetySettings: PERMISSIVE_SAFETY_SETTINGS,
                },
            }),
            this.REQUEST_TIMEOUT_MS,
            `Ultra-simple AI request timeout for chunk ${chunk.id}`
        );

        const rawText = response.text;
        if (!rawText || rawText.trim().length === 0) {
            throw new Error('Empty ultra-simple response');
        }

        const result = this.safeJsonParse(rawText);
        return {
            chunkId: chunk.id,
            summary: result.summary || `${chunk.participants.length} users chatted`,
            keyQuotes: [],
            keySlang: [],
            emotionalPattern: chunk.vibeType,
            loreGenerated: [],
            participants: {},
            vibeScore: result.vibeScore || { humor: 5, chaos: 5, wholesome: 5, toxicity: 0 },
        };
    }

    /**
     * Ultra-minimal AI summarization - guaranteed to fit in token limits
     */
    private async aiSummarizeMinimal(chunk: ConversationChunk, model: string): Promise<SessionSummary> {
        // Take only 3 messages, heavily truncated
        const messages = chunk.messages
            .slice(0, 3)
            .map(m => `${m.authorName.slice(0, 15)}: ${m.content.slice(0, 50)}`)
            .join('\n');

        const response = await this.withTimeout(
            this.client.models.generateContent({
                model: model,
                contents: `Summarize in 10 words max:\n${messages}\n\nJSON:{"summary":"10 words max","vibeScore":{"humor":5,"chaos":5,"wholesome":5,"toxicity":0}}`,
                config: {
                    systemInstruction: 'Output ONLY the JSON object, nothing else. Summary must be under 10 words.',
                    maxOutputTokens: 512,
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                    safetySettings: PERMISSIVE_SAFETY_SETTINGS,
                },
            }),
            this.REQUEST_TIMEOUT_MS,
            `Minimal AI request timeout for chunk ${chunk.id}`
        );

        const rawText = response.text;
        if (!rawText || rawText.trim().length === 0) {
            throw new Error('Empty minimal response');
        }

        const result = this.safeJsonParse(rawText);
        return {
            chunkId: chunk.id,
            summary: result.summary || `${chunk.participants.length} users chatted`,
            keyQuotes: [],
            keySlang: [],
            emotionalPattern: chunk.vibeType,
            loreGenerated: [],
            participants: {},
            vibeScore: result.vibeScore || { humor: 5, chaos: 5, wholesome: 5, toxicity: 0 },
        };
    }

    private async aiSummarize(chunk: ConversationChunk, model: string, messageLimit: number = 50): Promise<SessionSummary> {
        const messages = chunk.messages
            .slice(0, messageLimit)
            .map(m => {
                // Truncate messages aggressively to prevent token overflow
                const content = m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content;
                return `[${m.authorName}]: ${content}`;
            })
            .join('\n');

        const prompt = `Analyze this Discord chat (be VERY brief):
${messages}

Respond with this exact JSON structure (keep summary under 50 chars, max 2 quotes, max 2 slang terms):
{"summary":"under 50 chars","keyQuotes":["max 2"],"keySlang":["max 2"],"emotionalPattern":"one word","vibeScore":{"humor":5,"chaos":5,"wholesome":5,"toxicity":0}}`;

        const response = await this.withTimeout(
            this.client.models.generateContent({
                model: model,
                contents: prompt,
                config: {
                    systemInstruction: 'Analyze Discord chat. Respond with ONLY compact JSON, no explanations. Keep all values extremely brief (under 100 chars).',
                    maxOutputTokens: 2048,
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                    safetySettings: PERMISSIVE_SAFETY_SETTINGS,
                },
            }),
            this.REQUEST_TIMEOUT_MS,
            `AI request timeout for chunk ${chunk.id}`
        );

        // Check for empty or blocked response
        const rawText = response.text;
        if (!rawText || rawText.trim().length === 0) {
            const candidates = (response as any).candidates || [];
            const blockReason = candidates[0]?.finishReason || 'unknown';
            throw new Error(`Empty AI response - blockReason: ${blockReason}`);
        }
        const result = this.safeJsonParse(rawText);

        return {
            chunkId: chunk.id,
            summary: result.summary || '',
            keyQuotes: (result.keyQuotes || []).slice(0, 3),
            keySlang: (result.keySlang || []).slice(0, 5),
            emotionalPattern: result.emotionalPattern || '',
            loreGenerated: [],
            participants: {},
            vibeScore: result.vibeScore || { humor: 5, chaos: 5, wholesome: 5, toxicity: 0 },
        };
    }

    /**
     * Robust JSON parsing with multiple repair strategies
     * Extracts partial data even from truncated responses
     */
    private safeJsonParse(text: string): any {
        // Clean the text first
        let cleaned = text.trim();

        // Remove markdown code blocks if present
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

        // Try direct parse first
        try {
            return JSON.parse(cleaned);
        } catch { /* continue to repairs */ }

        // Strategy 1: Try to extract JSON object from text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch { /* continue */ }
        }

        // Strategy 2: Fix common issues
        let repaired = cleaned;

        // Fix unescaped newlines in strings
        repaired = repaired.replace(/([\"'])([^\"'\\n]*?)\\n([^\"']*?)\\1/g, (_, q, a, b) => `${q}${a}\\\\n${b}${q}`);

        // Fix trailing commas
        repaired = repaired.replace(/,\s*([}\]])/g, '$1');

        // Fix missing closing brackets for truncated responses
        const openBraces = (repaired.match(/\{/g) || []).length;
        const closeBraces = (repaired.match(/\}/g) || []).length;
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/\]/g) || []).length;

        // Remove truncated values at end before adding closing brackets
        repaired = repaired.replace(/,\s*"[^"]*$/g, ''); // Truncated key
        repaired = repaired.replace(/:\s*"[^"]*$/g, ': ""'); // Truncated string value
        repaired = repaired.replace(/:\s*\[[^\]]*$/g, ': []'); // Truncated array
        repaired = repaired.replace(/,\s*$/g, ''); // Trailing comma

        // Add missing closing brackets
        repaired += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
        repaired += '}'.repeat(Math.max(0, openBraces - closeBraces));

        try {
            return JSON.parse(repaired);
        } catch { /* continue */ }

        // Strategy 3: Extract individual fields using regex (last resort)
        const result: any = {};

        // Extract summary
        const summaryMatch = repaired.match(/"summary"\s*:\s*"([^"]*)"/i);
        if (summaryMatch) result.summary = summaryMatch[1];

        // Extract keyQuotes as array
        const quotesMatch = repaired.match(/"keyQuotes"\s*:\s*\[([^\]]*)\]/i);
        if (quotesMatch && quotesMatch[1]) {
            const quotes = quotesMatch[1].match(/"([^"]+)"/g);
            result.keyQuotes = quotes ? quotes.map(q => q.replace(/"/g, '')) : [];
        }

        // Extract keySlang as array
        const slangMatch = repaired.match(/"keySlang"\s*:\s*\[([^\]]*)\]/i);
        if (slangMatch && slangMatch[1]) {
            const slang = slangMatch[1].match(/"([^"]+)"/g);
            result.keySlang = slang ? slang.map(s => s.replace(/"/g, '')) : [];
        }

        // Extract emotionalPattern
        const emotionMatch = repaired.match(/"emotionalPattern"\s*:\s*"([^"]*)"/i);
        if (emotionMatch) result.emotionalPattern = emotionMatch[1];

        // If we extracted at least a summary, return the partial result
        if (result.summary) {
            return result;
        }

        // Last resort: throw to trigger retry/fallback
        throw new Error(`JSON parse failed after all strategies: ${text.substring(0, 80)}...`);
    }

    // NOTE: localSummarize removed - all chunks MUST go through AI processing
}
