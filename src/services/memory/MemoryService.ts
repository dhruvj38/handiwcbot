import { AiService } from '../ai/AiService';
import { MemoryRepository } from './MemoryRepository';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import {
    ServerMemoryData,
    UserProfileData,
    SessionSummaryData,
    TranscriptChunkData,
    SessionSummaryDraft,
} from '../../types';

export class MemoryService {
    private aiService: AiService;
    private repository: MemoryRepository;

    constructor(aiService: AiService, repository: MemoryRepository) {
        this.aiService = aiService;
        this.repository = repository;
    }

    /**
     * Retrieve relevant memories for a chat context
     */
    async retrieveMemoriesForChat(
        serverId: string,
        userMessage: string,
        userIds: string[]
    ): Promise<{
        serverMemories: ServerMemoryData[];
        userProfiles: UserProfileData[];
        sessionSummaries: SessionSummaryData[];
    }> {
        try {
            // Generate embedding for the user message
            const embedding = await this.aiService.generateEmbedding(userMessage);

            // Search server memories by similarity
            const serverMemories = await this.repository.searchServerMemories(
                serverId,
                embedding,
                config.bot.memoryRetrievalLimit
            );

            // Get user profiles for mentioned users
            const userProfiles: UserProfileData[] = [];
            for (const userId of userIds) {
                const profile = await this.repository.getUserProfile(serverId, userId);
                if (profile) {
                    userProfiles.push(profile);
                }
            }

            // Get recent session summaries
            const sessionSummaries = await this.repository.getRecentSessionSummaries(serverId, 3);

            return {
                serverMemories,
                userProfiles,
                sessionSummaries,
            };
        } catch (error) {
            logger.error('Failed to retrieve memories for chat:', error);
            return {
                serverMemories: [],
                userProfiles: [],
                sessionSummaries: [],
            };
        }
    }

    /**
     * Process transcript chunks and update memories
     */
    async processTranscripts(
        serverId: string,
        channelId: string,
        chunks: TranscriptChunkData[]
    ): Promise<void> {
        try {
            if (chunks.length === 0) {
                logger.warn('No transcript chunks to process');
                return;
            }

            logger.info(`Processing ${chunks.length} transcript chunks for server ${serverId}`);

            // Generate summary from transcripts
            const summary = await this.aiService.summarizeTranscripts(chunks);

            // Create session summary
            const timeRangeStart = chunks[0]!.startedAt;
            const timeRangeEnd = chunks[chunks.length - 1]!.endedAt;

            const summaryEmbedding = await this.aiService.generateEmbedding(summary.highLevelSummary);

            await this.repository.createSessionSummary({
                serverId,
                channelId,
                timeRangeStart,
                timeRangeEnd,
                summaryText: summary.highLevelSummary,
                embedding: summaryEmbedding,
                metadata: {
                    events: summary.events,
                    plans: summary.plans,
                    memes: summary.memes,
                    userInsights: summary.userInsights,
                },
            });

            // Generate and store server memories
            const memories = await this.aiService.generateServerMemories(serverId, summary);

            for (const memory of memories) {
                const embedding = await this.aiService.generateEmbedding(memory.content);
                await this.repository.createServerMemory({
                    serverId,
                    type: memory.type,
                    title: memory.title,
                    content: memory.content,
                    embedding,
                });
            }

            // Update user profiles
            const uniqueUserIds = [...new Set(chunks.map((c) => c.userId).filter((id): id is string => id !== null))];

            for (const userId of uniqueUserIds) {
                await this.updateUserProfile(serverId, userId, summary);
            }

            logger.info(`Successfully processed transcripts and updated memories`);
        } catch (error) {
            logger.error('Failed to process transcripts:', error);
        }
    }

    /**
     * Update user profile from session summary
     */
    private async updateUserProfile(
        serverId: string,
        userId: string,
        summary: SessionSummaryDraft
    ): Promise<void> {
        try {
            // Get existing profile or create default
            let profile = await this.repository.getUserProfile(serverId, userId);

            if (!profile) {
                // Create initial profile
                profile = {
                    id: '',
                    serverId,
                    userId,
                    displayName: `User ${userId}`,
                    summary: 'New user, no profile yet.',
                    tags: [],
                    lastUpdated: new Date(),
                    createdAt: new Date(),
                };
            }

            // Update profile using AI
            const updated = await this.aiService.updateUserProfileFromSummary(profile, summary);

            // Generate embedding for updated summary
            const embedding = await this.aiService.generateEmbedding(updated.summary);

            // Save updated profile
            await this.repository.upsertUserProfile({
                serverId,
                userId,
                displayName: profile.displayName,
                summary: updated.summary,
                tags: updated.tags,
                embedding,
            });

            logger.info(`Updated user profile for ${userId}`);
        } catch (error) {
            logger.error(`Failed to update user profile for ${userId}:`, error);
        }
    }

    /**
     * Store a transcript chunk
     */
    async storeTranscriptChunk(data: {
        serverId: string;
        channelId: string;
        userId: string | null;
        startedAt: Date;
        endedAt: Date;
        rawText: string;
        metadata?: Record<string, unknown>;
    }): Promise<TranscriptChunkData> {
        return this.repository.createTranscriptChunk(data);
    }

    /**
     * Get transcript chunks for processing
     */
    async getTranscriptChunksForProcessing(
        serverId: string,
        channelId: string,
        since: Date
    ): Promise<TranscriptChunkData[]> {
        const now = new Date();
        return this.repository.getTranscriptChunks(serverId, channelId, since, now);
    }

    /**
     * Search memories
     */
    async searchMemories(serverId: string, query: string): Promise<ServerMemoryData[]> {
        try {
            const embedding = await this.aiService.generateEmbedding(query);
            return this.repository.searchServerMemories(serverId, embedding, 10);
        } catch (error) {
            logger.error('Failed to search memories:', error);
            return [];
        }
    }

    /**
     * Get server memory summary
     */
    async getServerSummary(serverId: string): Promise<{
        memoryCount: Record<string, number>;
        recentMemories: ServerMemoryData[];
        userCount: number;
    }> {
        try {
            const memoryTypes: ServerMemoryData['type'][] = ['event', 'meme', 'plan', 'rule', 'habit'];
            const memoryCount: Record<string, number> = {};

            for (const type of memoryTypes) {
                const memories = await this.repository.getServerMemoriesByType(serverId, type, 100);
                memoryCount[type] = memories.length;
            }

            const recentMemories = await this.repository.searchServerMemories(serverId, [], 5);

            return {
                memoryCount,
                recentMemories,
                userCount: 0, // TODO: Implement user count query
            };
        } catch (error) {
            logger.error('Failed to get server summary:', error);
            return {
                memoryCount: {},
                recentMemories: [],
                userCount: 0,
            };
        }
    }

    /**
     * Get transcripts by channel
     */
    async getTranscriptsByChannel(
        serverId: string,
        channelId: string,
        fromDate: Date,
        toDate: Date
    ): Promise<TranscriptChunkData[]> {
        return this.repository.getTranscriptChunks(serverId, channelId, fromDate, toDate);
    }

    /**
     * Get transcripts by user
     */
    async getTranscriptsByUser(
        serverId: string,
        userId: string,
        fromDate: Date,
        toDate: Date
    ): Promise<TranscriptChunkData[]> {
        return this.repository.getTranscriptsByUser(serverId, userId, fromDate, toDate);
    }
}
