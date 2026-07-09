import { getPrismaClient } from '../../db/client';
import { logger } from '../../utils/logger';
import {
    ServerMemoryData,
    UserProfileData,
    TranscriptChunkData,
    SessionSummaryData,
} from '../../types';

export class MemoryRepository {
    private db = getPrismaClient();

    /**
     * Create a server memory
     */
    async createServerMemory(data: {
        serverId: string;
        type: ServerMemoryData['type'];
        title: string;
        content: string;
        embedding?: number[];
        metadata?: Record<string, unknown>;
    }): Promise<ServerMemoryData> {
        try {
            await this.db.$executeRaw`
        INSERT INTO server_memories (id, "serverId", type, title, content, embedding, metadata, "createdAt", "updatedAt")
        VALUES (
          gen_random_uuid(),
          ${data.serverId},
          ${data.type},
          ${data.title},
          ${data.content},
          ${data.embedding ? `[${data.embedding.join(',')}]` : null}::vector,
          ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb,
          NOW(),
          NOW()
        )
      `;

            // Fetch the created record (excluding embedding to avoid vector deserialization error)
            const memories = await this.db.$queryRaw<ServerMemoryData[]>`
        SELECT 
          id::text,
          "serverId",
          type,
          title,
          content,
          metadata,
          "createdAt",
          "updatedAt"
        FROM server_memories 
        WHERE "serverId" = ${data.serverId} 
        ORDER BY "createdAt" DESC 
        LIMIT 1
      `;

            return memories[0]!;
        } catch (error) {
            logger.error('Failed to create server memory:', error);
            throw error;
        }
    }

    /**
     * Search server memories by similarity
     */
    async searchServerMemories(
        serverId: string,
        embedding: number[],
        limit: number = 10
    ): Promise<ServerMemoryData[]> {
        try {
            const embeddingStr = `[${embedding.join(',')}]`;
            const memories = await this.db.$queryRaw<ServerMemoryData[]>`
        SELECT 
          id::text,
          "serverId",
          type,
          title,
          content,
          metadata,
          "createdAt",
          "updatedAt",
          1 - (embedding <=> ${embeddingStr}::vector) as similarity
        FROM server_memories
        WHERE "serverId" = ${serverId} AND embedding IS NOT NULL
        ORDER BY embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `;

            return memories;
        } catch (error) {
            logger.error('Failed to search server memories:', error);
            return [];
        }
    }

    /**
     * Get server memories by type
     */
    async getServerMemoriesByType(
        serverId: string,
        type: ServerMemoryData['type'],
        limit: number = 10
    ): Promise<ServerMemoryData[]> {
        try {
            const memories = await this.db.$queryRaw<ServerMemoryData[]>`
        SELECT 
          id::text,
          "serverId",
          type,
          title,
          content,
          metadata,
          "createdAt",
          "updatedAt"
        FROM server_memories
        WHERE "serverId" = ${serverId} AND type = ${type}
        ORDER BY "createdAt" DESC
        LIMIT ${limit}
      `;

            return memories;
        } catch (error) {
            logger.error('Failed to get server memories by type:', error);
            return [];
        }
    }

    /**
     * Create or update user profile
     */
    async upsertUserProfile(data: {
        serverId: string;
        userId: string;
        displayName: string;
        summary: string;
        tags: string[];
        embedding?: number[];
        metadata?: Record<string, unknown>;
    }): Promise<UserProfileData> {
        try {
            await this.db.$executeRaw`
        INSERT INTO user_profiles (id, "serverId", "userId", "displayName", summary, tags, embedding, metadata, "lastUpdated", "createdAt")
        VALUES (
          gen_random_uuid(),
          ${data.serverId},
          ${data.userId},
          ${data.displayName},
          ${data.summary},
          ARRAY[${data.tags.join(',')}]::text[],
          ${data.embedding ? `[${data.embedding.join(',')}]` : null}::vector,
          ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT ("serverId", "userId") 
        DO UPDATE SET
          "displayName" = EXCLUDED."displayName",
          summary = EXCLUDED.summary,
          tags = EXCLUDED.tags,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          "lastUpdated" = NOW()
      `;

            const profiles = await this.db.$queryRaw<UserProfileData[]>`
        SELECT 
          id::text,
          "serverId",
          "userId",
          "displayName",
          summary,
          tags,
          metadata,
          "lastUpdated",
          "createdAt"
        FROM user_profiles
        WHERE "serverId" = ${data.serverId} AND "userId" = ${data.userId}
      `;

            return profiles[0]!;
        } catch (error) {
            logger.error('Failed to upsert user profile:', error);
            throw error;
        }
    }

    /**
     * Get user profile
     */
    async getUserProfile(serverId: string, userId: string): Promise<UserProfileData | null> {
        try {
            const profiles = await this.db.$queryRaw<UserProfileData[]>`
        SELECT 
          id::text,
          "serverId",
          "userId",
          "displayName",
          summary,
          tags,
          metadata,
          "lastUpdated",
          "createdAt"
        FROM user_profiles
        WHERE "serverId" = ${serverId} AND "userId" = ${userId}
      `;

            return profiles[0] || null;
        } catch (error) {
            logger.error('Failed to get user profile:', error);
            return null;
        }
    }

    /**
     * Search user profiles by similarity
     */
    async searchUserProfiles(
        serverId: string,
        embedding: number[],
        limit: number = 5
    ): Promise<UserProfileData[]> {
        try {
            const embeddingStr = `[${embedding.join(',')}]`;
            const profiles = await this.db.$queryRaw<UserProfileData[]>`
        SELECT 
          id::text,
          "serverId",
          "userId",
          "displayName",
          summary,
          tags,
          metadata,
          "lastUpdated",
          "createdAt",
          1 - (embedding <=> ${embeddingStr}::vector) as similarity
        FROM user_profiles
        WHERE "serverId" = ${serverId} AND embedding IS NOT NULL
        ORDER BY embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `;

            return profiles;
        } catch (error) {
            logger.error('Failed to search user profiles:', error);
            return [];
        }
    }

    /**
     * Create transcript chunk
     */
    async createTranscriptChunk(data: {
        serverId: string;
        channelId: string;
        userId: string | null;
        userName?: string | null;
        startedAt: Date;
        endedAt: Date;
        rawText: string;
        metadata?: Record<string, unknown>;
        sessionId?: string | null;
    }): Promise<TranscriptChunkData> {
        try {
            const result = await this.db.transcriptChunk.create({
                data: {
                    serverId: data.serverId,
                    channelId: data.channelId,
                    userId: data.userId,
                    userName: data.userName,
                    startedAt: data.startedAt,
                    endedAt: data.endedAt,
                    rawText: data.rawText,
                    metadata: data.metadata as any,
                    sessionId: data.sessionId,
                },
            });

            return result as TranscriptChunkData;
        } catch (error) {
            logger.error('Failed to create transcript chunk:', error);
            throw error;
        }
    }

    /**
     * Get transcript chunks for a time range
     */
    async getTranscriptChunks(
        serverId: string,
        channelId: string,
        startTime: Date,
        endTime: Date
    ): Promise<TranscriptChunkData[]> {
        try {
            const chunks = await this.db.transcriptChunk.findMany({
                where: {
                    serverId,
                    channelId,
                    startedAt: {
                        gte: startTime,
                        lte: endTime,
                    },
                },
                orderBy: { startedAt: 'asc' },
            });

            return chunks as TranscriptChunkData[];
        } catch (error) {
            logger.error('Failed to get transcript chunks:', error);
            return [];
        }
    }

    /**
     * Get transcript chunks by channel and time range (for /logs window command)
     */
    async getTranscriptsByChannel(
        serverId: string,
        channelId: string,
        startTime: Date,
        endTime: Date
    ): Promise<TranscriptChunkData[]> {
        try {
            const chunks = await this.db.transcriptChunk.findMany({
                where: {
                    serverId,
                    channelId,
                    startedAt: {
                        gte: startTime,
                        lte: endTime,
                    },
                },
                orderBy: { startedAt: 'asc' },
                take: 100, // Limit to latest 100 for performance
            });

            return chunks as TranscriptChunkData[];
        } catch (error) {
            logger.error('Failed to get transcripts by channel:', error);
            return [];
        }
    }

    /**
     * Get transcript chunks by user and time range (for /logs user command)
     */
    async getTranscriptsByUser(
        serverId: string,
        userId: string,
        startTime: Date,
        endTime: Date
    ): Promise<TranscriptChunkData[]> {
        try {
            const chunks = await this.db.transcriptChunk.findMany({
                where: {
                    serverId,
                    userId,
                    startedAt: {
                        gte: startTime,
                        lte: endTime,
                    },
                },
                orderBy: { startedAt: 'asc' },
                take: 100, // Limit to latest 100 for performance
            });

            return chunks as TranscriptChunkData[];
        } catch (error) {
            logger.error('Failed to get transcripts by user:', error);
            return [];
        }
    }

    /**
     * Create session summary
     */
    async createSessionSummary(data: {
        serverId: string;
        channelId: string;
        timeRangeStart: Date;
        timeRangeEnd: Date;
        summaryText: string;
        embedding?: number[];
        metadata?: Record<string, unknown>;
    }): Promise<SessionSummaryData> {
        try {
            await this.db.$executeRaw`
        INSERT INTO session_summaries (id, "serverId", "channelId", "timeRangeStart", "timeRangeEnd", "summaryText", embedding, metadata, "createdAt")
        VALUES (
          gen_random_uuid(),
          ${data.serverId},
          ${data.channelId},
          ${data.timeRangeStart},
          ${data.timeRangeEnd},
          ${data.summaryText},
          ${data.embedding ? `[${data.embedding.join(',')}]` : null}::vector,
          ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb,
          NOW()
        )
      `;

            const summaries = await this.db.$queryRaw<SessionSummaryData[]>`
        SELECT 
          id::text,
          "serverId",
          "channelId",
          "timeRangeStart",
          "timeRangeEnd",
          "summaryText",
          metadata,
          "createdAt"
        FROM session_summaries
        WHERE "serverId" = ${data.serverId} AND "channelId" = ${data.channelId}
        ORDER BY "createdAt" DESC LIMIT 1
      `;

            return summaries[0]!;
        } catch (error) {
            logger.error('Failed to create session summary:', error);
            throw error;
        }
    }

    /**
     * Get recent session summaries
     */
    async getRecentSessionSummaries(
        serverId: string,
        limit: number = 5
    ): Promise<SessionSummaryData[]> {
        try {
            const summaries = await this.db.$queryRaw<SessionSummaryData[]>`
        SELECT 
          id::text,
          "serverId",
          "channelId",
          "timeRangeStart",
          "timeRangeEnd",
          "summaryText",
          metadata,
          "createdAt"
        FROM session_summaries
        WHERE "serverId" = ${serverId}
        ORDER BY "createdAt" DESC
        LIMIT ${limit}
      `;

            return summaries;
        } catch (error) {
            logger.error('Failed to get recent session summaries:', error);
            return [];
        }
    }

    /**
     * Delete all memories for a server
     */
    async deleteAllServerMemories(serverId: string): Promise<number> {
        try {
            const result = await this.db.$executeRaw`
                DELETE FROM server_memories WHERE "serverId" = ${serverId}
            `;
            return Number(result);
        } catch (error) {
            logger.error('Failed to delete server memories:', error);
            throw error;
        }
    }

    /**
     * Delete all user profiles for a server
     */
    async deleteAllUserProfiles(serverId: string): Promise<number> {
        try {
            const result = await this.db.$executeRaw`
                DELETE FROM user_profiles WHERE "serverId" = ${serverId}
            `;
            return Number(result);
        } catch (error) {
            logger.error('Failed to delete user profiles:', error);
            throw error;
        }
    }

    /**
     * Delete all session summaries for a server
     */
    async deleteAllSessionSummaries(serverId: string): Promise<number> {
        try {
            const result = await this.db.$executeRaw`
                DELETE FROM session_summaries WHERE "serverId" = ${serverId}
            `;
            return Number(result);
        } catch (error) {
            logger.error('Failed to delete session summaries:', error);
            throw error;
        }
    }

    /**
     * Delete all transcript chunks for a server
     */
    async deleteAllTranscriptChunks(serverId: string): Promise<number> {
        try {
            const result = await this.db.transcriptChunk.deleteMany({
                where: { serverId },
            });
            return result.count;
        } catch (error) {
            logger.error('Failed to delete transcript chunks:', error);
            throw error;
        }
    }

    /**
     * Get all unique server IDs that have memories
     */
    async getAllServerIds(): Promise<string[]> {
        try {
            const result = await this.db.$queryRaw<{ serverId: string }[]>`
                SELECT DISTINCT "serverId" FROM server_memories
                UNION
                SELECT DISTINCT "serverId" FROM user_profiles
            `;
            return result.map(r => r.serverId);
        } catch (error) {
            logger.error('Failed to get all server IDs:', error);
            return [];
        }
    }

    /**
     * Update a server memory
     */
    async updateServerMemory(
        id: string,
        data: {
            content?: string;
            embedding?: number[];
            metadata?: Record<string, unknown>;
        }
    ): Promise<void> {
        try {
            const updates: string[] = [];
            if (data.content) updates.push(`content = '${data.content.replace(/'/g, "''")}'`);
            if (data.embedding) updates.push(`embedding = '[${data.embedding.join(',')}]'::vector`);
            if (data.metadata) updates.push(`metadata = '${JSON.stringify(data.metadata)}'::jsonb`);
            updates.push(`"updatedAt" = NOW()`);

            await this.db.$executeRawUnsafe(`
                UPDATE server_memories 
                SET ${updates.join(', ')}
                WHERE id = '${id}'
            `);
        } catch (error) {
            logger.error('Failed to update server memory:', error);
            throw error;
        }
    }

    /**
     * Delete a single server memory
     */
    async deleteServerMemory(id: string): Promise<void> {
        try {
            await this.db.$executeRaw`
                DELETE FROM server_memories WHERE id = ${id}::uuid
            `;
        } catch (error) {
            logger.error('Failed to delete server memory:', error);
            throw error;
        }
    }

    /**
     * Get all user profiles for a server
     */
    async getAllUserProfiles(serverId: string): Promise<UserProfileData[]> {
        try {
            const profiles = await this.db.$queryRaw<UserProfileData[]>`
                SELECT 
                    id::text,
                    "serverId",
                    "userId",
                    "displayName",
                    summary,
                    tags,
                    metadata,
                    "lastUpdated",
                    "createdAt"
                FROM user_profiles
                WHERE "serverId" = ${serverId}
                ORDER BY "lastUpdated" DESC
            `;
            return profiles;
        } catch (error) {
            logger.error('Failed to get all user profiles:', error);
            return [];
        }
    }

    /**
     * Delete a single user profile
     */
    async deleteUserProfile(id: string): Promise<void> {
        try {
            await this.db.$executeRaw`
                DELETE FROM user_profiles WHERE id = ${id}::uuid
            `;
        } catch (error) {
            logger.error('Failed to delete user profile:', error);
            throw error;
        }
    }
    /**
     * Update user nickname
     */
    async updateUserNickname(serverId: string, userId: string, nickname: string, source: string = 'manual'): Promise<void> {
        try {
            // Check if profile exists
            const profile = await this.getUserProfile(serverId, userId);

            if (profile) {
                await this.db.$executeRaw`
                    UPDATE user_profiles 
                    SET "displayName" = ${nickname}, "lastUpdated" = NOW()
                    WHERE "serverId" = ${serverId} AND "userId" = ${userId}
                `;
            } else {
                // Create new profile with just the nickname
                await this.upsertUserProfile({
                    serverId,
                    userId,
                    displayName: nickname,
                    summary: `User known as ${nickname}`,
                    tags: [],
                    metadata: {
                        nicknameSource: source
                    }
                });
            }
        } catch (error) {
            logger.error('Failed to update user nickname:', error);
            throw error;
        }
    }
}
