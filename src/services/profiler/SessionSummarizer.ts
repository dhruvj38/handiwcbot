/**
 * LAYER 2: Session Mini-Summaries
 * Generate summaries for each conversation chunk
 */

import { GoogleGenAI } from '@google/genai';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { sleep } from '../../utils/helpers';
import { ConversationChunk, SessionSummary, ProgressCallback } from './types';

export class SessionSummarizer {
    private client: GoogleGenAI;
    private fastModel: string;

    // Rate limiting
    private readonly PARALLEL_LIMIT = 3; // Low parallelism to avoid 429s
    private readonly DELAY_BETWEEN_BATCHES_MS = 2000; // 2s between batches
    private readonly MAX_RETRIES = 5;
    private readonly BASE_RETRY_DELAY_MS = 5000; // Start with 5s backoff

    constructor() {
        this.client = new GoogleGenAI({ apiKey: config.ai.apiKey });
        this.fastModel = config.ai.models.chat;
    }

    async generateSummaries(
        chunks: ConversationChunk[],
        updateStatus: ProgressCallback
    ): Promise<SessionSummary[]> {
        const summaries: SessionSummary[] = [];
        const BATCH_SIZE = 50; // Increased batch size for parallel processing
        
        await updateStatus(`  📝 Processing ${chunks.length} chunks with parallel AI...`);
        
        let processed = 0;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const batchSummaries = await this.processBatch(batch);
            summaries.push(...batchSummaries);
            processed += batch.length;
            
            if (processed % 100 === 0 || processed === chunks.length) {
                await updateStatus(`  📝 Summarized ${processed}/${chunks.length} chunks...`);
            }
        }

        return summaries;
    }

    private async processBatch(chunks: ConversationChunk[]): Promise<SessionSummary[]> {
        const summaries: SessionSummary[] = [];
        const MAX_AI_SUMMARIES = 300;
        
        // Separate interesting and non-interesting chunks
        const interestingChunks: ConversationChunk[] = [];
        const otherChunks: ConversationChunk[] = [];
        
        for (const chunk of chunks) {
            const isInteresting = chunk.messageCount > 10 || 
                chunk.vibeType === 'drama' || 
                chunk.vibeType === 'hype' ||
                chunk.vibeType === 'shitpost' ||
                chunk.vibeType === 'gaming' ||
                chunk.slangDensity > 0.1;
            
            if (isInteresting && interestingChunks.length < MAX_AI_SUMMARIES) {
                interestingChunks.push(chunk);
            } else {
                otherChunks.push(chunk);
            }
        }
        
        // Process non-interesting chunks locally (instant)
        for (const chunk of otherChunks) {
            summaries.push(this.localSummarize(chunk));
        }
        
        // Process interesting chunks with AI - LOW parallelism + delays to avoid 429
        for (let i = 0; i < interestingChunks.length; i += this.PARALLEL_LIMIT) {
            const batch = interestingChunks.slice(i, i + this.PARALLEL_LIMIT);
            
            const batchPromises = batch.map(async (chunk) => {
                return await this.aiSummarizeWithRetry(chunk);
            });
            
            const batchResults = await Promise.all(batchPromises);
            summaries.push(...batchResults);
            
            // Delay between batches to avoid rate limits
            if (i + this.PARALLEL_LIMIT < interestingChunks.length) {
                await sleep(this.DELAY_BETWEEN_BATCHES_MS);
            }
        }

        return summaries;
    }

    /**
     * AI summarize with retry and exponential backoff - NO FALLBACK
     */
    private async aiSummarizeWithRetry(chunk: ConversationChunk): Promise<SessionSummary> {
        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
            try {
                return await this.aiSummarize(chunk);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const errAny = error as any;
                
                // Check if it's a rate limit error
                const is429 = errAny?.status === 429 || errAny?.code === 429 ||
                    /RESOURCE_EXHAUSTED|429|rate/i.test(lastError.message);
                
                if (is429) {
                    // Exponential backoff: 5s, 10s, 20s, 40s, 80s
                    const delay = this.BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
                    logger.info(`Rate limited on chunk ${chunk.id}, waiting ${delay/1000}s (attempt ${attempt + 1}/${this.MAX_RETRIES})`);
                    await sleep(delay);
                } else if (this.isJsonError(lastError)) {
                    // JSON parse error - retry with slight delay
                    logger.info(`JSON parse error on chunk ${chunk.id}, retrying (attempt ${attempt + 1}/${this.MAX_RETRIES})`);
                    await sleep(1000);
                } else {
                    // Unknown error - still retry with backoff
                    const delay = this.BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
                    logger.info(`Error on chunk ${chunk.id}: ${lastError.message}, retrying in ${delay/1000}s`);
                    await sleep(delay);
                }
            }
        }
        
        // After all retries exhausted, throw to fail loudly
        throw new Error(`Failed to summarize chunk ${chunk.id} after ${this.MAX_RETRIES} attempts: ${lastError?.message}`);
    }
    
    private isJsonError(error: Error): boolean {
        return /JSON|parse|position|escaped|Expected/i.test(error.message);
    }

    private async aiSummarize(chunk: ConversationChunk): Promise<SessionSummary> {
        const messages = chunk.messages
            .slice(0, 50)
            .map(m => `[${m.authorName}]: ${m.content}`)
            .join('\n');

        const prompt = `Analyze this Discord conversation. Extract:
1. A 1-2 sentence summary
2. 3-5 exact quotes that are iconic/representative
3. Slang or unique phrases used
4. Emotional pattern
5. Any new lore/memes that emerged
6. What each participant contributed

Conversation:
${messages}

Output JSON:
{
  "summary": "what happened",
  "keyQuotes": ["exact quote 1", "exact quote 2"],
  "keySlang": ["slang1", "slang2"],
  "emotionalPattern": "how emotions flowed",
  "loreGenerated": ["any new memes/lore"],
  "participants": {"user": "what they did"},
  "vibeScore": {"humor": 0-10, "chaos": 0-10, "wholesome": 0-10, "toxicity": 0-10}
}`;

        const response = await this.client.models.generateContent({
            model: this.fastModel,
            contents: prompt,
            config: {
                maxOutputTokens: 1000,
                temperature: 0.3,
                responseMimeType: 'application/json',
            },
        });

        const rawText = response.text || '{}';
        const result = this.safeJsonParse(rawText);
        
        return {
            chunkId: chunk.id,
            summary: result.summary || '',
            keyQuotes: result.keyQuotes || [],
            keySlang: result.keySlang || [],
            emotionalPattern: result.emotionalPattern || '',
            loreGenerated: result.loreGenerated || [],
            participants: result.participants || {},
            vibeScore: result.vibeScore || { humor: 5, chaos: 5, wholesome: 5, toxicity: 0 },
        };
    }
    
    /**
     * Parse JSON with repair for common AI mistakes
     */
    private safeJsonParse(text: string): any {
        try {
            return JSON.parse(text);
        } catch {
            // Try to repair common issues
            let repaired = text;
            
            // Fix unescaped newlines in strings
            repaired = repaired.replace(/(["'])([^"']*?)\n([^"']*?)\1/g, '$1$2\\n$3$1');
            
            // Fix trailing commas
            repaired = repaired.replace(/,\s*([}\]])/g, '$1');
            
            // Fix unescaped quotes inside strings (naive)
            repaired = repaired.replace(/: "([^"]*?)"([^,}\]\n])/g, ': "$1\\"$2');
            
            try {
                return JSON.parse(repaired);
            } catch {
                // If still failing, throw to trigger retry
                throw new Error(`JSON parse failed even after repair: ${text.substring(0, 100)}...`);
            }
        }
    }

    private localSummarize(chunk: ConversationChunk): SessionSummary {
        const keyQuotes = chunk.messages
            .filter(m => m.content.length > 10 && m.content.length < 200)
            .sort((a, b) => b.reactions.length - a.reactions.length)
            .slice(0, 5)
            .map(m => m.content);

        const participants: Record<string, string> = {};
        for (const p of chunk.participants) {
            const msgCount = chunk.messages.filter(m => m.authorName === p).length;
            participants[p] = `${msgCount} messages`;
        }

        return {
            chunkId: chunk.id,
            summary: `${chunk.participants.length} people chatted in #${chunk.channelName} (${chunk.vibeType} vibe)`,
            keyQuotes,
            keySlang: [],
            emotionalPattern: chunk.vibeType,
            loreGenerated: [],
            participants,
            vibeScore: {
                humor: chunk.vibeType === 'shitpost' ? 8 : 5,
                chaos: chunk.vibeType === 'drama' ? 8 : 4,
                wholesome: chunk.vibeType === 'chill' ? 7 : 5,
                toxicity: chunk.vibeType === 'drama' ? 5 : 1,
            },
        };
    }
}
