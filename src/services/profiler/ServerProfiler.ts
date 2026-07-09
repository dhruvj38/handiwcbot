/**
 * ServerProfiler - 6-Layer Server Culture Analysis System
 * 
 * Implements a comprehensive pipeline for analyzing 100k+ messages
 * and building a complete "Server Bible" for perfect server mimicry.
 * 
 * LAYER 1: Raw Logs → Conversation Chunks
 * LAYER 2: Per-Session Mini Summaries  
 * LAYER 3: Global Culture Maps
 * LAYER 4: Example Library (Pattern Bank)
 * LAYER 5: User Profiles
 * LAYER 6: Compile Server Bible + Master Prompt
 */

import { logger } from '../../utils/logger';
import { RawMessage, ServerBible, ProgressCallback, SlangEntry, LoreEntry } from './types';
import { ChunkProcessor } from './ChunkProcessor';
import { SessionSummarizer } from './SessionSummarizer';
import { CultureMapper } from './CultureMapper';
import { PatternBankBuilder } from './PatternBankBuilder';
import { UserProfileBuilder } from './UserProfileBuilder';
import { BibleCompiler } from './BibleCompiler';
import { ClassifiedChannel } from './ChannelClassifier';

export class ServerProfiler {
    private chunkProcessor: ChunkProcessor;
    private sessionSummarizer: SessionSummarizer;
    private cultureMapper: CultureMapper;
    private patternBankBuilder: PatternBankBuilder;
    private userProfileBuilder: UserProfileBuilder;
    private bibleCompiler: BibleCompiler;

    constructor() {
        this.chunkProcessor = new ChunkProcessor();
        this.sessionSummarizer = new SessionSummarizer();
        this.cultureMapper = new CultureMapper();
        this.patternBankBuilder = new PatternBankBuilder();
        this.userProfileBuilder = new UserProfileBuilder();
        this.bibleCompiler = new BibleCompiler();
    }

    /**
     * Main entry point - processes ALL messages through the 6-layer pipeline
     */
    async profileServer(
        guildId: string,
        serverName: string,
        serverDescription: string | null,
        messages: RawMessage[],
        members: { id: string; displayName: string; username: string; roles: string[] }[],
        channels: ClassifiedChannel[],
        roles: { id: string; name: string; memberCount: number }[],
        onProgress?: ProgressCallback
    ): Promise<ServerBible> {
        const startTime = Date.now();
        logger.info(`Starting 6-layer server profiling for ${serverName} with ${messages.length} messages`);

        const updateStatus = async (msg: string) => {
            logger.info(msg);
            if (onProgress) await onProgress(msg);
        };

        // ═══════════════════════════════════════════════════════════════
        // LAYER 1: Break into conversation chunks
        // ═══════════════════════════════════════════════════════════════
        await updateStatus(`# 🔄 LAYER 1/6: Chunking ${messages.length.toLocaleString()} messages...`);
        const chunks = this.chunkProcessor.chunkConversations(messages);
        await updateStatus(`✅ Created ${chunks.length.toLocaleString()} conversation chunks`);

        // ═══════════════════════════════════════════════════════════════
        // LAYER 2: Generate mini-summaries for each chunk
        // ═══════════════════════════════════════════════════════════════
        await updateStatus(`# 🔄 LAYER 2/6: Generating session summaries...`);
        const sessionSummaries = await this.sessionSummarizer.generateSummaries(guildId, chunks, updateStatus);
        await updateStatus(`✅ Generated ${sessionSummaries.length} session summaries`);

        // ═══════════════════════════════════════════════════════════════
        // LAYERS 3-5: Build culture maps, pattern bank, and user profiles
        // ═══════════════════════════════════════════════════════════════
        await updateStatus(`# 🔄 LAYERS 3-5/6: Building culture maps, pattern bank, and user profiles...`);

        const cultureMapPromise = this.cultureMapper.buildCultureMaps(guildId, sessionSummaries, messages, members);
        const patternBankPromise = Promise.resolve(this.patternBankBuilder.build(messages));
        const userProfilesPromise = this.userProfileBuilder.build(guildId, messages, members, sessionSummaries, updateStatus);

        const [cultureMap, patternBank, userProfiles] = await Promise.all([
            cultureMapPromise,
            patternBankPromise,
            userProfilesPromise,
        ]);

        await updateStatus(`✅ Culture maps: ${cultureMap.slangMap.length} slang, ${cultureMap.loreMap.length} lore`);
        await updateStatus(`✅ Pattern bank: ${patternBank.patterns.length} patterns`);
        await updateStatus(`✅ Built ${userProfiles.length} detailed user profiles`);

        // ═══════════════════════════════════════════════════════════════
        // LAYER 6: Compile the Server Bible with master prompt
        // ═══════════════════════════════════════════════════════════════
        await updateStatus(`# 🔄 LAYER 6/6: Compiling Server Bible...`);
        const bible = await this.bibleCompiler.compile(
            guildId,
            serverName,
            serverDescription,
            messages,
            chunks,
            sessionSummaries,
            cultureMap,
            patternBank,
            userProfiles,
            channels,
            roles
        );

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        await updateStatus(`# ✅ COMPLETE! Processed ${messages.length.toLocaleString()} messages in ${elapsed}s`);

        return bible;
    }

    async updateBibleIncremental(
        guildId: string,
        existingBible: ServerBible,
        newMessages: RawMessage[],
        members: { id: string; displayName: string; username: string; roles: string[] }[],
        onProgress?: ProgressCallback
    ): Promise<ServerBible> {
        if (newMessages.length === 0) {
            return existingBible;
        }

        const startTime = Date.now();
        logger.info(`Starting incremental Bible update with ${newMessages.length} new messages`);

        const updateStatus = async (msg: string) => {
            logger.info(msg);
            if (onProgress) await onProgress(msg);
        };

        await updateStatus(`# 🔄 INCREMENTAL UPDATE: Processing ${newMessages.length} new messages...`);

        const newChunks = this.chunkProcessor.chunkConversations(newMessages);
        await updateStatus(`✅ Created ${newChunks.length} new conversation chunks`);

        const newSummaries = await this.sessionSummarizer.generateSummaries(guildId, newChunks, updateStatus);
        await updateStatus(`✅ Generated ${newSummaries.length} new session summaries`);

        const newCultureMap = await this.cultureMapper.buildCultureMaps(guildId, newSummaries, newMessages, members);

        const mergedSlang = this.mergeSlangMaps(existingBible.vocabulary?.slangDictionary || {}, newCultureMap.slangMap);
        const mergedLore = this.mergeLoreEntries(existingBible.lore?.majorEvents || [], newCultureMap.loreMap);

        const newPatterns = this.patternBankBuilder.build(newMessages);
        const mergedPatterns = [
            ...(existingBible.exampleLibrary?.patterns || []),
            ...newPatterns.patterns.slice(0, 10),
        ].slice(0, 30);

        const updatedBible: ServerBible = {
            ...existingBible,
            vocabulary: {
                ...existingBible.vocabulary,
                slangDictionary: mergedSlang,
            },
            lore: {
                ...existingBible.lore,
                majorEvents: mergedLore,
            },
            exampleLibrary: {
                ...existingBible.exampleLibrary,
                patterns: mergedPatterns,
            },
            metadata: {
                ...existingBible.metadata,
                messageCount: existingBible.metadata.messageCount + newMessages.length,
                chunkCount: existingBible.metadata.chunkCount + newChunks.length,
                dateRange: this.extendDateRange(existingBible.metadata.dateRange, newMessages),
                lastIncrementalUpdate: new Date().toISOString(),
                incrementalMessageCount: (existingBible.metadata?.incrementalMessageCount || 0) + newMessages.length,
            },
        };

        if (newCultureMap.loreMap.length > 0) {
            const newLoreEntries = newCultureMap.loreMap.slice(0, 5).map(l => `- ${l.title}: ${l.description}`).join('\n');

            if (updatedBible.masterPrompt && newLoreEntries) {
                const loreInsertPoint = updatedBible.masterPrompt.indexOf('## KEY LORE');
                if (loreInsertPoint > -1) {
                    const endOfLoreSection = updatedBible.masterPrompt.indexOf('##', loreInsertPoint + 10);
                    if (endOfLoreSection > -1) {
                        updatedBible.masterPrompt =
                            updatedBible.masterPrompt.slice(0, endOfLoreSection) +
                            `\n### RECENT EVENTS\n${newLoreEntries}\n\n` +
                            updatedBible.masterPrompt.slice(endOfLoreSection);
                    }
                }
            }
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        await updateStatus(`# ✅ INCREMENTAL UPDATE COMPLETE in ${elapsed}s`);

        return updatedBible;
    }

    private mergeSlangMaps(
        existing: Record<string, string>,
        newSlang: SlangEntry[]
    ): Record<string, string> {
        const merged = { ...existing };
        for (const entry of newSlang) {
            if (!merged[entry.term] || entry.frequency > 5) {
                merged[entry.term] = entry.meaning;
            }
        }
        return merged;
    }

    private mergeLoreEntries(
        existing: LoreEntry[],
        newLore: LoreEntry[]
    ): LoreEntry[] {
        const merged = [...existing];
        for (const entry of newLore.slice(0, 10)) {
            if (!merged.some(e => e.title === entry.title)) {
                merged.push(entry);
            }
        }
        return merged.slice(-50);
    }

    private extendDateRange(
        existing: { start: Date; end: Date },
        newMessages: RawMessage[],
    ): { start: Date; end: Date } {
        let start = existing.start;
        let end = existing.end;

        for (const msg of newMessages) {
            const t = msg.timestamp.getTime();
            if (t < start.getTime()) {
                start = new Date(t);
            }
            if (t > end.getTime()) {
                end = new Date(t);
            }
        }

        return { start, end };
    }
}

export * from './types';
