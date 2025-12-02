import { GoogleGenAI } from '@google/genai';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { retryWithBackoff } from '../../utils/helpers';
import {
    ChatContext,
    SessionSummaryDraft,
    UserProfileData,
    ServerMemoryData,
    TranscriptChunkData,
} from '../../types';

export class AiService {
    private client: GoogleGenAI;

    constructor() {
        this.client = new GoogleGenAI({
            apiKey: config.ai.apiKey,
        });

        logger.info('AiService initialized with config:', {
            model: config.ai.models.chat,
            embeddingModel: config.ai.models.embeddings,
        });
    }

    /**
     * Generate a chat response based on context
     */
    async generateChatResponse(context: ChatContext): Promise<string> {
        try {
            const systemPrompt = this.buildSystemPrompt(context);
            const userPrompt = this.buildUserPrompt(context);

            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.generateContent({
                        model: config.ai.models.chat,
                        contents: userPrompt,
                        config: {
                            systemInstruction: systemPrompt,
                            maxOutputTokens: config.ai.maxTokens,
                            temperature: config.ai.temperature,
                        },
                    });

                    const content = response.text;
                    if (!content) {
                        throw new Error('No content in AI response');
                    }

                    return content;
                },
                { maxRetries: 3 },
                'generateChatResponse'
            );

            return result;

        } catch (error) {
            logger.error('Failed to generate chat response:', error);
            return "I'm having trouble processing that right now. Please try again later!";
        }
    }

    /**
     * Summarize transcript chunks into a session summary
     */
    async summarizeTranscripts(chunks: TranscriptChunkData[]): Promise<SessionSummaryDraft> {
        try {
            const transcriptText = chunks
                .map((chunk) => {
                    const timestamp = chunk.startedAt.toISOString();
                    const userId = chunk.userId || 'Unknown';
                    return `[${timestamp}] User ${userId}: ${chunk.rawText}`;
                })
                .join('\n');

            const prompt = `Analyze the following voice chat transcripts and extract structured information:

${transcriptText}

Please provide:
1. A high-level summary (2-3 sentences)
2. Key events discussed (bullet points)
3. Plans or decisions made (bullet points)
4. Memes, jokes, or recurring references (bullet points)
5. User insights (for each active participant, note personality traits, preferences, or behaviors)

Format your response as JSON with these exact keys:
{
  "highLevelSummary": "...",
  "events": ["...", "..."],
  "plans": ["...", "..."],
  "memes": ["...", "..."],
  "userInsights": {
    "userId1": "insight about user 1",
    "userId2": "insight about user 2"
  }
}`;

            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.generateContent({
                        model: config.ai.models.chat,
                        contents: prompt,
                        config: {
                            systemInstruction: 'You are a helpful assistant that analyzes voice chat transcripts and extracts structured information. Always respond with valid JSON.',
                            maxOutputTokens: 1500,
                            temperature: 0.3,
                            responseMimeType: 'application/json',
                        },
                    });

                    const content = response.text;
                    if (!content) {
                        throw new Error('No content in AI response');
                    }

                    return JSON.parse(content) as SessionSummaryDraft;
                },
                { maxRetries: 3 },
                'summarizeTranscripts'
            );

            return result;
        } catch (error) {
            logger.error('Failed to summarize transcripts:', error);
            // Return empty summary on failure
            return {
                highLevelSummary: 'Failed to generate summary',
                events: [],
                plans: [],
                memes: [],
                userInsights: {},
            };
        }
    }

    /**
     * Update user profile based on new session summary
     */
    async updateUserProfileFromSummary(
        profile: UserProfileData,
        summary: SessionSummaryDraft
    ): Promise<{ summary: string; tags: string[] }> {
        try {
            const userInsight = summary.userInsights[profile.userId];
            if (!userInsight) {
                // No new insights for this user
                return { summary: profile.summary, tags: profile.tags };
            }

            const prompt = `Current user profile:
Name: ${profile.displayName}
Summary: ${profile.summary}
Tags: ${profile.tags.join(', ')}

New insight from recent conversation:
${userInsight}

Update the user profile summary and tags to incorporate this new information. Keep the summary concise (2-3 sentences). Tags should be single words or short phrases.

Respond with JSON:
{
  "summary": "updated summary",
  "tags": ["tag1", "tag2", "tag3"]
}`;

            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.generateContent({
                        model: config.ai.models.chat,
                        contents: prompt,
                        config: {
                            systemInstruction: 'You are a helpful assistant that maintains user profiles. Always respond with valid JSON.',
                            maxOutputTokens: 500,
                            temperature: 0.3,
                            responseMimeType: 'application/json',
                        },
                    });

                    const content = response.text;
                    if (!content) {
                        throw new Error('No content in AI response');
                    }

                    return JSON.parse(content) as { summary: string; tags: string[] };
                },
                { maxRetries: 3 },
                'updateUserProfile'
            );

            return result;
        } catch (error) {
            logger.error('Failed to update user profile:', error);
            return { summary: profile.summary, tags: profile.tags };
        }
    }

    /**
     * Generate server memory entries from session summary
     */
    async generateServerMemories(
        _serverId: string,
        summary: SessionSummaryDraft
    ): Promise<Array<{ type: ServerMemoryData['type']; title: string; content: string }>> {
        const memories: Array<{ type: ServerMemoryData['type']; title: string; content: string }> = [];

        // Create memories for events
        for (const event of summary.events) {
            memories.push({
                type: 'event',
                title: event.substring(0, 100),
                content: event,
            });
        }

        // Create memories for plans
        for (const plan of summary.plans) {
            memories.push({
                type: 'plan',
                title: plan.substring(0, 100),
                content: plan,
            });
        }

        // Create memories for memes
        for (const meme of summary.memes) {
            memories.push({
                type: 'meme',
                title: meme.substring(0, 100),
                content: meme,
            });
        }

        return memories;
    }

    /**
     * Generate embeddings for text
     */
    async generateEmbedding(text: string): Promise<number[]> {
        try {
            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.embedContent({
                        model: config.ai.models.embeddings,
                        contents: text,
                    });

                    return response.embeddings?.[0]?.values;
                },
                { maxRetries: 3 },
                'generateEmbedding'
            );

            if (!result) {
                throw new Error('No embedding in response');
            }

            return result;
        } catch (error) {
            logger.error('Failed to generate embedding:', error);
            throw error;
        }
    }

    /**
     * Build system prompt for chat
     */
    private buildSystemPrompt(context: ChatContext): string {
        const parts: string[] = [
            `You are a friendly Discord bot with a ${config.bot.personality} personality.`,
            `You are chatting in server: ${context.serverId}, channel: ${context.channelId}.`,
        ];

        if (context.serverMemories.length > 0) {
            parts.push('\n## Server Context');
            parts.push('Here are some things you know about this server:');
            for (const memory of context.serverMemories) {
                parts.push(`- [${memory.type}] ${memory.title}: ${memory.content}`);
            }
        }

        if (context.userProfiles.length > 0) {
            parts.push('\n## User Profiles');
            parts.push('Here are profiles of users in this conversation:');
            for (const profile of context.userProfiles) {
                parts.push(`- ${profile.displayName} (${profile.userId}): ${profile.summary}`);
                if (profile.tags.length > 0) {
                    parts.push(`  Tags: ${profile.tags.join(', ')}`);
                }
            }
        }

        if (context.sessionSummaries.length > 0) {
            parts.push('\n## Recent Voice Chat Summaries');
            for (const summary of context.sessionSummaries) {
                parts.push(`- ${summary.summaryText}`);
            }
        }

        if (context.instructions) {
            parts.push('\n## Additional Instructions');
            parts.push(context.instructions);
        }

        parts.push('\nRespond naturally and conversationally. Keep responses concise (under 2000 characters).');

        return parts.join('\n');
    }

    /**
     * Build user prompt for chat
     */
    private buildUserPrompt(context: ChatContext): string {
        const parts: string[] = [];

        if (context.recentMessages.length > 0) {
            parts.push('Recent conversation:');
            for (const msg of context.recentMessages) {
                parts.push(`${msg.userName}: ${msg.content}`);
            }
            parts.push('');
        }

        parts.push(`${context.userName}: ${context.userMessage}`);

        return parts.join('\n');
    }
}
