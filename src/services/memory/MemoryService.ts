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
import { ServerBible } from '../profiler/types';

export class MemoryService {
    private aiService: AiService;
    private repository: MemoryRepository;

    constructor(aiService: AiService, repository: MemoryRepository) {
        this.aiService = aiService;
        this.repository = repository;
    }

    /**
     * Get the underlying repository (used by UserDisplayNameService)
     */
    getRepository(): MemoryRepository {
        return this.repository;
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
            // Check if userMessage is empty or just whitespace
            const trimmedMessage = userMessage?.trim();

            // Search server memories by similarity (only if we have text to embed)
            let serverMemories: ServerMemoryData[] = [];
            if (trimmedMessage && trimmedMessage.length > 0) {
                const embedding = await this.aiService.generateEmbedding(serverId, trimmedMessage);
                serverMemories = await this.repository.searchServerMemories(
                    serverId,
                    embedding,
                    config.bot.memoryRetrievalLimit
                );
            }

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

            // Get recent personality habits (always include these)
            const recentHabits = await this.repository.getServerMemoriesByType(serverId, 'habit', 5);

            // Combine memories, deduplicating by ID
            const allMemories = [...serverMemories];
            for (const habit of recentHabits) {
                if (!allMemories.some(m => m.id === habit.id)) {
                    allMemories.push(habit);
                }
            }

            return {
                serverMemories: allMemories,
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
            const summary = await this.aiService.summarizeTranscripts(serverId, chunks);

            // Create session summary
            const timeRangeStart = chunks[0]!.startedAt;
            const timeRangeEnd = chunks[chunks.length - 1]!.endedAt;

            const summaryEmbedding = await this.aiService.generateEmbedding(serverId, summary.highLevelSummary);

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
                const embedding = await this.aiService.generateEmbedding(serverId, memory.content);
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
            const embedding = await this.aiService.generateEmbedding(serverId, updated.summary);

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
        userName?: string | null;
        startedAt: Date;
        endedAt: Date;
        rawText: string;
        metadata?: Record<string, unknown>;
        sessionId?: string | null;
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
            const embedding = await this.aiService.generateEmbedding(serverId, query);
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

    /**
     * Build server profile from comprehensive server data
     */
    async buildServerProfile(data: {
        serverId: string;
        serverName: string;
        serverDescription: string | null;
        channels: Array<{ id: string; name: string; type: string; topic?: string | null }>;
        roles: Array<{ id: string; name: string; color: number; memberCount: number; permissions: string[] }>;
        members: Array<{ id: string; displayName: string; username: string; roles: string[]; isBot: boolean; joinedAt: Date | null }>;
        messages: Array<{ channelId: string; channelName: string; authorId: string; authorName: string; content: string; timestamp: Date }>;
    }): Promise<{
        serverProfile: { summary: string; topics: string[]; culture: string; activeHours: string; keyMembers: string[] };
        communicationStyle: { slang: string[]; commonPhrases: string[]; emojiStyle: string; messageLength: string; tone: string; capitalization: string; punctuation: string; exampleMessages: string[] };
        userProfilesCreated: number;
        memoriesCreated: number;
    }> {
        try {
            logger.info(`Building server profile for ${data.serverName} (${data.serverId})`);
            logger.info(`Data: ${data.channels.length} channels, ${data.roles.length} roles, ${data.members.length} members, ${data.messages.length} messages`);
            logger.info(`Message count for analysis: ${data.messages.length} (targeting 100k+ for comprehensive profiling)`);

            // Use AI to analyze the server data
            const analysis = await this.aiService.analyzeServerData(data.serverId, {
                serverName: data.serverName,
                serverDescription: data.serverDescription,
                channels: data.channels,
                roles: data.roles,
                members: data.members,
                messages: data.messages,
            });

            // Store server profile as a special memory
            const serverProfileContent = `
Server: ${data.serverName}
Summary: ${analysis.serverProfile.summary}
Topics: ${analysis.serverProfile.topics.join(', ')}
Culture: ${analysis.serverProfile.culture}
Active Hours: ${analysis.serverProfile.activeHours}
Key Members: ${analysis.serverProfile.keyMembers.join(', ')}

Channels: ${data.channels.map(c => `#${c.name}`).join(', ')}
Roles: ${data.roles.filter(r => r.name !== '@everyone').map(r => r.name).join(', ')}
`.trim();

            const serverEmbed = await this.aiService.generateEmbedding(data.serverId, serverProfileContent);
            await this.repository.createServerMemory({
                serverId: data.serverId,
                type: 'habit',
                title: `Server Profile: ${data.serverName}`,
                content: serverProfileContent,
                embedding: serverEmbed,
                metadata: {
                    isServerProfile: true,
                    topics: analysis.serverProfile.topics,
                    culture: analysis.serverProfile.culture,
                    activeHours: analysis.serverProfile.activeHours,
                    keyMembers: analysis.serverProfile.keyMembers,
                    // CRITICAL: Store ALL data for response generation
                    communicationStyle: analysis.communicationStyle,
                    operatingManual: analysis.operatingManual || {},
                    masterPrompt: analysis.masterPrompt || '',
                    insideJokes: analysis.insideJokes || [],
                    thingsToAvoid: analysis.thingsToAvoid || [],
                    wayToFitIn: analysis.wayToFitIn || '',
                    channelCount: data.channels.length,
                    roleCount: data.roles.length,
                    memberCount: data.members.length,
                    profiledAt: new Date().toISOString(),
                },
            });

            // Store user profiles
            let userProfilesCreated = 0;
            for (const userProfile of analysis.userProfiles) {
                try {
                    const member = data.members.find(m => m.id === userProfile.userId);
                    const summaryWithDetails = `${userProfile.summary}\n\nPersonality: ${userProfile.personality}\nInterests: ${userProfile.interests.join(', ')}\nActivity Level: ${userProfile.activityLevel}`;

                    const embedding = await this.aiService.generateEmbedding(data.serverId, summaryWithDetails);
                    await this.repository.upsertUserProfile({
                        serverId: data.serverId,
                        userId: userProfile.userId,
                        displayName: userProfile.displayName || member?.displayName || 'Unknown',
                        summary: summaryWithDetails,
                        tags: userProfile.tags,
                        embedding,
                        metadata: {
                            personality: userProfile.personality,
                            interests: userProfile.interests,
                            activityLevel: userProfile.activityLevel,
                            roles: member?.roles || [],
                            profiledAt: new Date().toISOString(),
                        },
                    });
                    userProfilesCreated++;
                } catch (error) {
                    logger.error(`Failed to create profile for user ${userProfile.userId}:`, error);
                }
            }

            // Store extracted memories
            let memoriesCreated = 0;
            for (const memory of analysis.memories) {
                try {
                    const embedding = await this.aiService.generateEmbedding(data.serverId, memory.content);
                    await this.repository.createServerMemory({
                        serverId: data.serverId,
                        type: memory.type,
                        title: memory.title,
                        content: memory.content,
                        embedding,
                        metadata: {
                            extractedFromProfile: true,
                            profiledAt: new Date().toISOString(),
                        },
                    });
                    memoriesCreated++;
                } catch (error) {
                    logger.error(`Failed to create memory ${memory.title}:`, error);
                }
            }

            logger.info(`Server profile built: ${userProfilesCreated} user profiles, ${memoriesCreated} memories`);

            return {
                serverProfile: analysis.serverProfile,
                communicationStyle: analysis.communicationStyle,
                userProfilesCreated,
                memoriesCreated,
            };
        } catch (error) {
            logger.error('Failed to build server profile:', error);
            throw error;
        }
    }

    /**
     * Store the Server Bible from the 6-layer profiler
     */
    async storeServerBible(serverId: string, bible: ServerBible): Promise<void> {
        try {
            logger.info(`Storing Server Bible for ${serverId}: ${bible.metadata.messageCount} messages, ${bible.metadata.chunkCount} chunks`);

            // Build comprehensive content for the server profile
            const serverProfileContent = `
# SERVER BIBLE FOR ${bible.coreIdentity.summary}

## CORE IDENTITY
${bible.coreIdentity.personality.join(', ')}
Archetypes: ${bible.coreIdentity.archetypes.join(', ')}

## STYLE RULES
- Capitalization: ${bible.styleRules.capitalization}
- Punctuation: ${bible.styleRules.punctuation}
- Emoji: ${bible.styleRules.emojiUsage.frequency} (favorites: ${bible.styleRules.emojiUsage.favorites.slice(0, 5).join('')})
- Message length: ~${bible.styleRules.messageLength.typical} words (${bible.styleRules.messageLength.style})
- Slang density: ${Math.round(bible.styleRules.slangDensity * 100)}%
- Swearing: ${bible.styleRules.swearingLevel}
- CAPS usage: ${bible.styleRules.capsUsage}

## SLANG DICTIONARY
${Object.entries(bible.vocabulary.slangDictionary).slice(0, 50).map(([k, v]) => `- "${k}" = ${v}`).join('\n')}

## GREETINGS
${bible.vocabulary.greetings.slice(0, 10).join(', ')}

## AFFIRMATIVES
${bible.vocabulary.affirmatives.slice(0, 10).join(', ')}
`.trim();

            // Store as server profile memory
            const serverEmbed = await this.aiService.generateEmbedding(serverId, serverProfileContent.substring(0, 2000));
            await this.repository.createServerMemory({
                serverId,
                type: 'habit',
                title: `Server Bible`,
                content: serverProfileContent,
                embedding: serverEmbed,
                metadata: {
                    isServerProfile: true,
                    isServerBible: true,
                    masterPrompt: bible.masterPrompt,
                    styleRules: bible.styleRules,
                    vocabulary: bible.vocabulary,
                    responsePatterns: bible.responsePatterns,
                    antiPatterns: bible.antiPatterns,
                    examplePatterns: bible.exampleLibrary.patterns.slice(0, 50),
                    loreCount: bible.lore.majorEvents.length + bible.lore.memes.length,
                    userProfileCount: bible.userProfiles.length,
                    messageCount: bible.metadata.messageCount,
                    chunkCount: bible.metadata.chunkCount,
                    generatedAt: bible.metadata.generatedAt.toISOString(),
                },
            });

            // Store user profiles
            for (const userProfile of bible.userProfiles) {
                try {
                    const summaryWithDetails = `${userProfile.personality}\n\nSpeech patterns: ${userProfile.speechPatterns.join(', ')}\nInterests: ${userProfile.interests.join(', ')}\nQuirks: ${userProfile.quirks.join(', ')}\nHow to interact: ${userProfile.howToInteract}`;

                    const embedding = await this.aiService.generateEmbedding(serverId, summaryWithDetails.substring(0, 1000));
                    await this.repository.upsertUserProfile({
                        serverId,
                        userId: userProfile.userId,
                        displayName: userProfile.displayName,
                        summary: summaryWithDetails,
                        tags: userProfile.interests,
                        embedding,
                        metadata: {
                            personality: userProfile.personality,
                            speechPatterns: userProfile.speechPatterns,
                            quirks: userProfile.quirks,
                            howToInteract: userProfile.howToInteract,
                            profiledAt: new Date().toISOString(),
                        },
                    });
                } catch (error) {
                    logger.warn(`Failed to store user profile for ${userProfile.displayName}:`, error);
                }
            }

            // Store major lore events
            for (const lore of bible.lore.majorEvents.slice(0, 20)) {
                try {
                    const embedding = await this.aiService.generateEmbedding(serverId, lore.description);
                    await this.repository.createServerMemory({
                        serverId,
                        type: 'event',
                        title: lore.title,
                        content: `${lore.description}\n\nParticipants: ${lore.participants.join(', ')}\nExamples: ${lore.examples.slice(0, 3).join(' | ')}`,
                        embedding,
                        metadata: {
                            memePotential: lore.memePotential,
                            participants: lore.participants,
                        },
                    });
                } catch (error) {
                    logger.warn(`Failed to store lore "${lore.title}":`, error);
                }
            }

            // Store memes
            for (const meme of bible.lore.memes.slice(0, 20)) {
                try {
                    const embedding = await this.aiService.generateEmbedding(serverId, meme.description);
                    await this.repository.createServerMemory({
                        serverId,
                        type: 'meme',
                        title: meme.title,
                        content: `${meme.description}\n\nExamples: ${meme.examples.slice(0, 3).join(' | ')}`,
                        embedding,
                        metadata: {
                            memePotential: meme.memePotential,
                        },
                    });
                } catch (error) {
                    logger.warn(`Failed to store meme "${meme.title}":`, error);
                }
            }

            logger.info(`Server Bible stored successfully for ${serverId}`);
        } catch (error) {
            logger.error('Failed to store Server Bible:', error);
            throw error;
        }
    }

    /**
     * Store a GIF memory from gif_train command
     */
    async storeGifMemory(serverId: string, data: {
        title: string;
        gifUrl: string;
        description: string;
        usageCount: number;
        channelId: string;
    }): Promise<void> {
        try {
            const content = `${data.description}\n\nGIF URL: ${data.gifUrl}`;
            const embedding = await this.aiService.generateEmbedding(serverId, content);

            await this.repository.createServerMemory({
                serverId,
                type: 'meme', // GIFs are stored as 'meme' type
                title: data.title,
                content,
                embedding,
                metadata: {
                    isGif: true,
                    gifUrl: data.gifUrl,
                    usageCount: data.usageCount,
                    channelId: data.channelId,
                    trainedAt: new Date().toISOString(),
                },
            });

            logger.info(`Stored GIF memory: ${data.title} (${data.usageCount} uses)`);
        } catch (error) {
            logger.error('Failed to store GIF memory:', error);
            throw error;
        }
    }

    /**
     * Search GIF memories by text similarity
     */
    async searchGifMemoriesByText(serverId: string, query: string, limit: number = 5): Promise<ServerMemoryData[]> {
        try {
            if (!query || query.trim().length === 0) {
                return [];
            }

            const embedding = await this.aiService.generateEmbedding(serverId, query);
            const memories = await this.repository.searchServerMemories(serverId, embedding, limit * 3);

            // Filter to only GIF memories
            const gifMemories = memories.filter(m => {
                const meta = m.metadata as Record<string, unknown> | null;
                return meta?.isGif === true && meta?.gifUrl;
            });

            return gifMemories.slice(0, limit);
        } catch (error) {
            logger.error('Failed to search GIF memories:', error);
            return [];
        }
    }

    /**
     * Clear ALL memories for a server (destructive!)
     */
    async clearAllMemories(serverId: string): Promise<{
        serverMemories: number;
        userProfiles: number;
        sessionSummaries: number;
        transcriptChunks: number;
    }> {
        try {
            logger.warn(`CLEARING ALL MEMORIES for server ${serverId}`);

            const serverMemories = await this.repository.deleteAllServerMemories(serverId);
            const userProfiles = await this.repository.deleteAllUserProfiles(serverId);
            const sessionSummaries = await this.repository.deleteAllSessionSummaries(serverId);
            const transcriptChunks = await this.repository.deleteAllTranscriptChunks(serverId);

            logger.info(`Cleared: ${serverMemories} memories, ${userProfiles} profiles, ${sessionSummaries} summaries, ${transcriptChunks} transcripts`);

            return {
                serverMemories,
                userProfiles,
                sessionSummaries,
                transcriptChunks,
            };
        } catch (error) {
            logger.error('Failed to clear memories:', error);
            throw error;
        }
    }
    /**
     * Store a style rule
     */
    async storeStyleRule(serverId: string, rule: string): Promise<void> {
        try {
            const embedding = await this.aiService.generateEmbedding(serverId, rule);
            await this.repository.createServerMemory({
                serverId,
                type: 'rule',
                title: 'Style Rule',
                content: rule,
                embedding,
                metadata: {
                    isStyleRule: true,
                    createdAt: new Date().toISOString(),
                },
            });
            logger.info(`Stored style rule for server ${serverId}`);
        } catch (error) {
            logger.error('Failed to store style rule:', error);
            throw error;
        }
    }

    /**
     * Update user nickname
     */
    async updateUserNickname(serverId: string, userId: string, nickname: string, source: string = 'manual'): Promise<void> {
        return this.repository.updateUserNickname(serverId, userId, nickname, source);
    }

    /**
     * Get user nickname
     */
    async getUserNickname(serverId: string, userId: string): Promise<string | null> {
        const profile = await this.repository.getUserProfile(serverId, userId);
        return profile?.displayName || null;
    }
}
