/**
 * MemoryConsolidationService
 * 
 * Manages continuous memories to build a coherent persona:
 * - Consolidates similar memories
 * - Removes stale/irrelevant memories
 * - Maintains memory hierarchy (short-term -> long-term)
 * - Ensures memories don't conflict
 */

import { AiService } from '../ai/AiService';
import { MemoryRepository } from '../memory/MemoryRepository';
import { logger } from '../../utils/logger';
import { ServerMemoryData, UserProfileData } from '../../types';

interface MemoryCluster {
    memories: ServerMemoryData[];
    theme: string;
    importance: number;
}

export class MemoryConsolidationService {
    private aiService: AiService;
    private repository: MemoryRepository;
    
    // Consolidation settings
    private consolidationIntervalMs = 60 * 60 * 1000; // Every hour
    private maxMemoriesPerType = 100;
    private memoryDecayDays = 30;
    
    // Running state
    private isConsolidating = false;
    private consolidationTimer: NodeJS.Timeout | null = null;

    constructor(aiService: AiService, repository: MemoryRepository) {
        this.aiService = aiService;
        this.repository = repository;
        
        logger.info('MemoryConsolidationService initialized');
    }

    /**
     * Start the periodic consolidation process
     */
    startPeriodicConsolidation(): void {
        if (this.consolidationTimer) {
            clearInterval(this.consolidationTimer);
        }

        this.consolidationTimer = setInterval(() => {
            this.runConsolidation().catch(err => {
                logger.error('Periodic consolidation failed:', err);
            });
        }, this.consolidationIntervalMs);

        logger.info(`Memory consolidation scheduled every ${this.consolidationIntervalMs / 60000} minutes`);
    }

    /**
     * Stop periodic consolidation
     */
    stopPeriodicConsolidation(): void {
        if (this.consolidationTimer) {
            clearInterval(this.consolidationTimer);
            this.consolidationTimer = null;
        }
    }

    /**
     * Run full consolidation for all servers
     */
    async runConsolidation(): Promise<void> {
        if (this.isConsolidating) {
            logger.warn('Consolidation already in progress, skipping');
            return;
        }

        this.isConsolidating = true;
        logger.info('Starting memory consolidation...');

        try {
            // Get all server IDs with memories
            const serverIds = await this.repository.getAllServerIds();
            
            for (const serverId of serverIds) {
                await this.consolidateServerMemories(serverId);
            }

            logger.info(`Memory consolidation completed for ${serverIds.length} servers`);
        } catch (error) {
            logger.error('Memory consolidation failed:', error);
        } finally {
            this.isConsolidating = false;
        }
    }

    /**
     * Consolidate memories for a specific server
     */
    async consolidateServerMemories(serverId: string): Promise<{
        merged: number;
        pruned: number;
        promoted: number;
    }> {
        logger.info(`Consolidating memories for server ${serverId}`);

        const stats = { merged: 0, pruned: 0, promoted: 0 };

        try {
            // 1. Merge similar memories
            stats.merged = await this.mergeSimilarMemories(serverId);

            // 2. Prune stale/low-value memories
            stats.pruned = await this.pruneStaleMemories(serverId);

            // 3. Promote important realtime updates to permanent memories
            stats.promoted = await this.promoteRealtimeMemories(serverId);

            // 4. Consolidate user insights
            await this.consolidateUserProfiles(serverId);

            logger.info(`Server ${serverId} consolidation: ${stats.merged} merged, ${stats.pruned} pruned, ${stats.promoted} promoted`);
        } catch (error) {
            logger.error(`Failed to consolidate server ${serverId}:`, error);
        }

        return stats;
    }

    /**
     * Merge similar memories using embedding similarity
     */
    private async mergeSimilarMemories(serverId: string): Promise<number> {
        const types: ServerMemoryData['type'][] = ['event', 'meme', 'habit', 'rule'];
        let totalMerged = 0;

        for (const type of types) {
            try {
                const memories = await this.repository.getServerMemoriesByType(serverId, type, 200);
                
                if (memories.length < 2) continue;

                // Find clusters of similar memories
                const clusters = await this.clusterSimilarMemories(memories);

                for (const cluster of clusters) {
                    if (cluster.memories.length < 2) continue;

                    // Merge the cluster into a single memory
                    const merged = await this.mergeMemoryCluster(serverId, cluster);
                    if (merged) {
                        totalMerged += cluster.memories.length - 1;
                    }
                }
            } catch (error) {
                logger.warn(`Failed to merge ${type} memories:`, error);
            }
        }

        return totalMerged;
    }

    /**
     * Cluster similar memories based on embedding similarity
     */
    private async clusterSimilarMemories(memories: ServerMemoryData[]): Promise<MemoryCluster[]> {
        const clusters: MemoryCluster[] = [];
        const assigned = new Set<string>();

        for (const memory of memories) {
            if (assigned.has(memory.id)) continue;

            // Find similar memories
            const similar = memories.filter(m => {
                if (m.id === memory.id || assigned.has(m.id)) return false;
                
                // Check title similarity (simple heuristic)
                const titleSimilarity = this.calculateTitleSimilarity(memory.title, m.title);
                return titleSimilarity > 0.6;
            });

            if (similar.length > 0) {
                const cluster: MemoryCluster = {
                    memories: [memory, ...similar],
                    theme: memory.title,
                    importance: 1, // Default importance
                };

                clusters.push(cluster);
                assigned.add(memory.id);
                similar.forEach(s => assigned.add(s.id));
            }
        }

        return clusters;
    }

    /**
     * Calculate title similarity (Jaccard index)
     */
    private calculateTitleSimilarity(title1: string, title2: string): number {
        const words1 = new Set(title1.toLowerCase().split(/\s+/));
        const words2 = new Set(title2.toLowerCase().split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }

    /**
     * Merge a cluster of memories into one
     */
    private async mergeMemoryCluster(serverId: string, cluster: MemoryCluster): Promise<boolean> {
        try {
            // Combine content
            const combinedContent = cluster.memories
                .map(m => m.content)
                .join('\n\n---\n\n');

            // Use AI to create consolidated summary
            const prompt = `Consolidate these related memories into a single, coherent memory:

${combinedContent}

Create a concise summary that captures all important information. Keep the same style/tone as the original content. Maximum 200 words.`;

            const consolidatedContent = await this.aiService.quickPrompt(serverId, prompt, 500);
            const embedding = await this.aiService.generateEmbedding(serverId, consolidatedContent);

            // Keep the oldest memory and update it
            const oldestMemory = cluster.memories.reduce((oldest, m) => 
                m.createdAt < oldest.createdAt ? m : oldest
            );

            // Update the oldest with consolidated content
            await this.repository.updateServerMemory(oldestMemory.id, {
                content: consolidatedContent,
                embedding,
                metadata: {
                    ...oldestMemory.metadata,
                    consolidatedFrom: cluster.memories.map(m => m.id),
                    consolidatedAt: new Date().toISOString(),
                },
            });

            // Delete the other memories in the cluster
            for (const memory of cluster.memories) {
                if (memory.id !== oldestMemory.id) {
                    await this.repository.deleteServerMemory(memory.id);
                }
            }

            return true;
        } catch (error) {
            logger.warn('Failed to merge memory cluster:', error);
            return false;
        }
    }

    /**
     * Prune stale or low-value memories
     */
    private async pruneStaleMemories(serverId: string): Promise<number> {
        let pruned = 0;

        try {
            // Get memories with metadata
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.memoryDecayDays);

            // Find old realtime updates that weren't promoted
            const allMemories = await this.repository.getServerMemoriesByType(serverId, 'habit', 500);
            
            for (const memory of allMemories) {
                const isRealtimeUpdate = memory.metadata?.isRealtimeUpdate === true;
                const createdAt = new Date(memory.createdAt);
                
                // Prune old realtime updates
                if (isRealtimeUpdate && createdAt < cutoffDate) {
                    await this.repository.deleteServerMemory(memory.id);
                    pruned++;
                }
            }

            // Enforce max memories per type
            const types: ServerMemoryData['type'][] = ['event', 'meme', 'plan'];
            for (const type of types) {
                const memories = await this.repository.getServerMemoriesByType(serverId, type, 500);
                
                if (memories.length > this.maxMemoriesPerType) {
                    // Sort by importance and creation date, prune oldest/least important
                    const sorted = memories.sort((a, b) => {
                        // Sort by creation date (newer first, then prune oldest)
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    });

                    const toPrune = sorted.slice(this.maxMemoriesPerType);
                    for (const memory of toPrune) {
                        await this.repository.deleteServerMemory(memory.id);
                        pruned++;
                    }
                }
            }
        } catch (error) {
            logger.warn('Failed to prune stale memories:', error);
        }

        return pruned;
    }

    /**
     * Promote important realtime personality updates to permanent memories
     */
    private async promoteRealtimeMemories(serverId: string): Promise<number> {
        let promoted = 0;

        try {
            // Get recent realtime updates
            const realtimeMemories = await this.repository.getServerMemoriesByType(serverId, 'habit', 100);
            const realtimeUpdates = realtimeMemories.filter(m => m.metadata?.isRealtimeUpdate === true);

            if (realtimeUpdates.length < 5) return 0;

            // Use AI to extract key personality traits from realtime updates
            const realtimeContent = realtimeUpdates
                .slice(0, 10)
                .map(m => m.content)
                .join('\n\n');

            const prompt = `From these recent personality observations, extract the CORE personality traits that should be remembered long-term:

${realtimeContent}

Output a list of 3-5 key personality traits/patterns that are consistent and important. Be specific and actionable (e.g., "Uses 'fr' and 'ngl' frequently" not "Uses slang").`;

            const keyTraits = await this.aiService.quickPrompt(serverId, prompt, 300);
            
            // Store as permanent personality memory
            const embedding = await this.aiService.generateEmbedding(serverId, keyTraits);
            await this.repository.createServerMemory({
                serverId,
                type: 'habit',
                title: 'Core Personality Traits',
                content: keyTraits,
                embedding,
                metadata: {
                    isPermanent: true,
                    promotedFrom: realtimeUpdates.slice(0, 10).map(m => m.id),
                    promotedAt: new Date().toISOString(),
                },
            });

            promoted = 1;
        } catch (error) {
            logger.warn('Failed to promote realtime memories:', error);
        }

        return promoted;
    }

    /**
     * Consolidate user profiles by removing duplicates and updating stale info
     */
    private async consolidateUserProfiles(serverId: string): Promise<void> {
        try {
            const profiles = await this.repository.getAllUserProfiles(serverId);
            
            // Group by userId
            const byUser = new Map<string, UserProfileData[]>();
            for (const profile of profiles) {
                const existing = byUser.get(profile.userId) || [];
                existing.push(profile);
                byUser.set(profile.userId, existing);
            }

            // Merge duplicates
            for (const [userId, userProfiles] of byUser) {
                if (userProfiles.length < 2) continue;

                // Keep the most recent, merge content
                const sorted = userProfiles.sort((a: UserProfileData, b: UserProfileData) => 
                    new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
                );

                const primary = sorted[0]!;
                const others = sorted.slice(1);

                // Combine tags from all profiles
                const allTags = new Set<string>();
                for (const p of userProfiles) {
                    p.tags.forEach((t: string) => allTags.add(t));
                }

                // Update primary with combined tags
                await this.repository.upsertUserProfile({
                    serverId,
                    userId,
                    displayName: primary.displayName,
                    summary: primary.summary,
                    tags: Array.from(allTags),
                    metadata: {
                        ...(primary.metadata as Record<string, unknown> || {}),
                        consolidatedAt: new Date().toISOString(),
                    },
                });

                // Delete duplicates
                for (const other of others) {
                    if (other.id !== primary.id) {
                        await this.repository.deleteUserProfile(other.id);
                    }
                }
            }
        } catch (error) {
            logger.warn('Failed to consolidate user profiles:', error);
        }
    }

    /**
     * Get memory health stats for a server
     */
    async getMemoryHealth(serverId: string): Promise<{
        totalMemories: number;
        byType: Record<string, number>;
        realtimeUpdates: number;
        permanentMemories: number;
        userProfiles: number;
        lastConsolidation: Date | null;
    }> {
        try {
            const types: ServerMemoryData['type'][] = ['event', 'meme', 'habit', 'rule', 'plan'];
            const byType: Record<string, number> = {};
            let totalMemories = 0;
            let realtimeUpdates = 0;
            let permanentMemories = 0;

            for (const type of types) {
                const memories = await this.repository.getServerMemoriesByType(serverId, type, 500);
                byType[type] = memories.length;
                totalMemories += memories.length;

                for (const m of memories) {
                    if (m.metadata?.isRealtimeUpdate) realtimeUpdates++;
                    if (m.metadata?.isPermanent) permanentMemories++;
                }
            }

            const profiles = await this.repository.getAllUserProfiles(serverId);

            return {
                totalMemories,
                byType,
                realtimeUpdates,
                permanentMemories,
                userProfiles: profiles.length,
                lastConsolidation: null, // Could track this if needed
            };
        } catch (error) {
            logger.error('Failed to get memory health:', error);
            return {
                totalMemories: 0,
                byType: {},
                realtimeUpdates: 0,
                permanentMemories: 0,
                userProfiles: 0,
                lastConsolidation: null,
            };
        }
    }
}
