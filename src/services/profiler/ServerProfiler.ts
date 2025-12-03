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
import { RawMessage, ServerBible, ProgressCallback } from './types';
import { ChunkProcessor } from './ChunkProcessor';
import { SessionSummarizer } from './SessionSummarizer';
import { CultureMapper } from './CultureMapper';
import { PatternBankBuilder } from './PatternBankBuilder';
import { UserProfileBuilder } from './UserProfileBuilder';
import { BibleCompiler } from './BibleCompiler';

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
        serverName: string,
        serverDescription: string | null,
        messages: RawMessage[],
        members: { id: string; displayName: string; username: string; roles: string[] }[],
        channels: { id: string; name: string; type: string; topic?: string | null }[],
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
        const sessionSummaries = await this.sessionSummarizer.generateSummaries(chunks, updateStatus);
        await updateStatus(`✅ Generated ${sessionSummaries.length} session summaries`);

        // ═══════════════════════════════════════════════════════════════
        // LAYER 3: Build global culture maps
        // ═══════════════════════════════════════════════════════════════
        await updateStatus(`# 🔄 LAYER 3/6: Building culture maps...`);
        const cultureMap = await this.cultureMapper.buildCultureMaps(sessionSummaries, messages, members);
        await updateStatus(`✅ Culture maps: ${cultureMap.slangMap.length} slang, ${cultureMap.loreMap.length} lore`);

        // ═══════════════════════════════════════════════════════════════
        // LAYER 4: Build pattern bank (example library)
        // ═══════════════════════════════════════════════════════════════
        await updateStatus(`# 🔄 LAYER 4/6: Building pattern bank...`);
        const patternBank = this.patternBankBuilder.build(messages);
        await updateStatus(`✅ Pattern bank: ${patternBank.patterns.length} patterns`);

        // ═══════════════════════════════════════════════════════════════
        // LAYER 5: Build user profiles (AI-powered with gemini-3-pro-preview)
        // ═══════════════════════════════════════════════════════════════
        await updateStatus(`# 🔄 LAYER 5/6: Building user profiles with AI...`);
        const userProfiles = await this.userProfileBuilder.build(messages, members, sessionSummaries, updateStatus);
        await updateStatus(`✅ Built ${(await userProfiles).length} detailed user profiles`);

        // ═══════════════════════════════════════════════════════════════
        // LAYER 6: Compile the Server Bible with master prompt
        // ═══════════════════════════════════════════════════════════════
        await updateStatus(`# 🔄 LAYER 6/6: Compiling Server Bible...`);
        const bible = await this.bibleCompiler.compile(
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
}

// Re-export types
export * from './types';
