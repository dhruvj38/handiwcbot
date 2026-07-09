import { PrismaClient, PromptLog, PromptOverride } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Section markers used to identify and parse prompt sections
 */
const SECTION_MARKERS: Record<string, { start: string; end?: string }> = {
    critical_rules: { start: '# CRITICAL RULES', end: '# CORE IDENTITY' },
    core_identity: { start: '# CORE IDENTITY', end: '## BASE TONE RULES' },
    tone_rules: { start: '## BASE TONE RULES', end: '## PREFERRED SLANG' },
    preferred_slang: { start: '## PREFERRED SLANG', end: '## EXPRESSIONS' },
    expressions: { start: '## EXPRESSIONS', end: '## FORBIDDEN PHRASES' },
    forbidden_phrases: { start: '## FORBIDDEN PHRASES', end: '## RESPONSE GUIDELINES' },
    response_guidelines: { start: '## RESPONSE GUIDELINES', end: '# INSTRUCTION: BLEND' },
    server_profile: { start: '# SERVER LEARNED PROFILE', end: '# SPEAKING STYLE RULES' },
    speaking_style: { start: '# SPEAKING STYLE RULES', end: '## USER PROFILES' },
    user_profiles: { start: '## USER PROFILES', end: '## RECENT CONTEXT' },
    recent_context: { start: '## RECENT CONTEXT' },
};

/**
 * Human-readable section names for display in UI
 */
export const SECTION_DISPLAY_NAMES: Record<string, string> = {
    critical_rules: '⚠️ Critical Rules',
    core_identity: '🤖 Core Identity',
    tone_rules: '🎭 Tone Rules',
    preferred_slang: '💬 Preferred Slang',
    expressions: '😤 Expressions',
    forbidden_phrases: '🚫 Forbidden Phrases',
    response_guidelines: '📏 Response Guidelines',
    server_profile: '🏠 Server Profile',
    speaking_style: '🗣️ Speaking Style',
    user_profiles: '👥 User Profiles',
    recent_context: '📝 Recent Context',
};

export interface ParsedSections {
    [key: string]: string;
}

export interface PromptEditResult {
    success: boolean;
    message: string;
    learnedRule?: string;
}

/**
 * Service for managing editable prompts and overrides
 */
export class PromptEditService {
    /**
     * Parse a system prompt into labeled sections
     */
    parseSectionsFromPrompt(prompt: string): ParsedSections {
        const sections: ParsedSections = {};
        const sectionKeys = Object.keys(SECTION_MARKERS);

        for (let i = 0; i < sectionKeys.length; i++) {
            const key = sectionKeys[i]!;
            const marker = SECTION_MARKERS[key]!;
            const nextKey = sectionKeys[i + 1];
            const nextMarker = nextKey ? SECTION_MARKERS[nextKey] : undefined;

            const startIdx = prompt.indexOf(marker.start);
            if (startIdx === -1) continue;

            // Find end: prefer explicit end marker, otherwise use next section's start
            let endIdx = prompt.length;
            if (marker.end) {
                const explicitEnd = prompt.indexOf(marker.end, startIdx + marker.start.length);
                if (explicitEnd !== -1) endIdx = explicitEnd;
            } else if (nextMarker) {
                const nextStart = prompt.indexOf(nextMarker.start, startIdx + marker.start.length);
                if (nextStart !== -1) endIdx = nextStart;
            }

            const sectionText = prompt.substring(startIdx, endIdx).trim();
            if (sectionText.length > 0) {
                sections[key] = sectionText;
            }
        }

        // If we couldn't parse sections, try a simpler approach - split by "# " headers
        if (Object.keys(sections).length === 0) {
            logger.debug('Falling back to simple header-based section parsing');
            const headerPattern = /^(#{1,2}\s+.+)$/gm;
            let match;
            const headers: { header: string; index: number }[] = [];

            while ((match = headerPattern.exec(prompt)) !== null) {
                headers.push({ header: match[1]!, index: match.index });
            }

            for (let i = 0; i < headers.length; i++) {
                const current = headers[i]!;
                const next = headers[i + 1];
                const endIdx = next ? next.index : prompt.length;
                const sectionText = prompt.substring(current.index, endIdx).trim();

                // Generate a key from the header text
                const key = current.header
                    .replace(/^#{1,2}\s+/, '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '_')
                    .substring(0, 30);

                sections[key] = sectionText;
            }
        }

        return sections;
    }

    /**
     * Log a prompt to the database for future reference
     */
    async logPrompt(params: {
        guildId: string;
        channelId: string;
        messageId?: string;
        logMessageId?: string;
        systemPrompt: string;
        userPrompt: string;
        model: string;
        provider: string;
    }): Promise<PromptLog> {
        const sections = this.parseSectionsFromPrompt(params.systemPrompt);

        return prisma.promptLog.create({
            data: {
                guildId: params.guildId,
                channelId: params.channelId,
                messageId: params.messageId,
                logMessageId: params.logMessageId,
                systemPrompt: params.systemPrompt,
                userPrompt: params.userPrompt,
                model: params.model,
                provider: params.provider,
                sections: sections,
            },
        });
    }

    /**
     * Update the log message ID after sending to bot-logs
     */
    async updateLogMessageId(promptLogId: string, logMessageId: string): Promise<void> {
        await prisma.promptLog.update({
            where: { id: promptLogId },
            data: { logMessageId },
        });
    }

    /**
     * Get a prompt log by its log message ID
     */
    async getPromptLogByMessageId(logMessageId: string): Promise<PromptLog | null> {
        return prisma.promptLog.findFirst({
            where: { logMessageId },
        });
    }

    /**
     * Get all active overrides for a guild
     */
    async getActiveOverrides(guildId: string): Promise<PromptOverride[]> {
        return prisma.promptOverride.findMany({
            where: { guildId, isActive: true },
            orderBy: { updatedAt: 'desc' },
        });
    }

    /**
     * Get active override for a specific section
     */
    async getSectionOverride(guildId: string, section: string): Promise<PromptOverride | null> {
        return prisma.promptOverride.findFirst({
            where: { guildId, section, isActive: true },
            orderBy: { updatedAt: 'desc' },
        });
    }

    /**
     * Apply an edit to a prompt section
     * @param aiService - The AI service instance for analyzing the edit
     */
    async applyEdit(params: {
        guildId: string;
        section: string;
        originalText: string;
        overrideText: string;
        createdBy: string;
        aiService?: { analyzePromptEdit: (original: string, edited: string) => Promise<string> };
    }): Promise<PromptEditResult> {
        try {
            // Deactivate any existing override for this section
            await prisma.promptOverride.updateMany({
                where: { guildId: params.guildId, section: params.section, isActive: true },
                data: { isActive: false },
            });

            // Analyze the edit with AI to generate a learned rule
            let learnedRule: string | undefined;
            if (params.aiService) {
                try {
                    learnedRule = await params.aiService.analyzePromptEdit(
                        params.originalText,
                        params.overrideText
                    );
                    logger.info(`AI generated learned rule from edit: ${learnedRule?.substring(0, 100)}...`);
                } catch (error) {
                    logger.warn('Failed to generate learned rule from edit:', error);
                }
            }

            // Create new override
            await prisma.promptOverride.create({
                data: {
                    guildId: params.guildId,
                    section: params.section,
                    originalText: params.originalText,
                    overrideText: params.overrideText,
                    learnedRule,
                    createdBy: params.createdBy,
                    isActive: true,
                },
            });

            return {
                success: true,
                message: `Section "${SECTION_DISPLAY_NAMES[params.section] || params.section}" updated successfully!`,
                learnedRule,
            };
        } catch (error) {
            logger.error('Failed to apply prompt edit:', error);
            return {
                success: false,
                message: `Failed to save edit: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
        }
    }

    /**
     * Apply all active overrides to a prompt
     * Returns the modified prompt with overrides applied
     */
    applyOverridesToPrompt(prompt: string, overrides: PromptOverride[]): string {
        let modifiedPrompt = prompt;

        for (const override of overrides) {
            // Find the original section in the prompt
            const originalSection = override.originalText;

            // Try direct replacement first
            if (modifiedPrompt.includes(originalSection)) {
                modifiedPrompt = modifiedPrompt.replace(originalSection, override.overrideText);
                logger.debug(`Applied override for section: ${override.section}`);
            } else {
                // If exact match fails, try to find by section markers
                const marker = SECTION_MARKERS[override.section];
                if (marker) {
                    const startIdx = modifiedPrompt.indexOf(marker.start);
                    if (startIdx !== -1) {
                        // Find end of section
                        let endIdx = modifiedPrompt.length;
                        if (marker.end) {
                            const explicitEnd = modifiedPrompt.indexOf(marker.end, startIdx + marker.start.length);
                            if (explicitEnd !== -1) endIdx = explicitEnd;
                        }

                        // Replace the section
                        modifiedPrompt =
                            modifiedPrompt.substring(0, startIdx) +
                            override.overrideText +
                            modifiedPrompt.substring(endIdx);

                        logger.debug(`Applied override for section (marker-based): ${override.section}`);
                    }
                }
            }
        }

        // Add learned rules section if any overrides have learned rules
        const learnedRules = overrides
            .filter(o => o.learnedRule)
            .map(o => `- ${o.learnedRule}`);

        if (learnedRules.length > 0) {
            modifiedPrompt += `\n\n## LEARNED STYLE RULES\nThese rules were learned from manual corrections:\n${learnedRules.join('\n')}`;
        }

        return modifiedPrompt;
    }

    /**
     * Deactivate an override
     */
    async deactivateOverride(overrideId: string): Promise<void> {
        await prisma.promptOverride.update({
            where: { id: overrideId },
            data: { isActive: false },
        });
    }

    /**
     * Get all overrides for a guild (including inactive)
     */
    async getAllOverrides(guildId: string): Promise<PromptOverride[]> {
        return prisma.promptOverride.findMany({
            where: { guildId },
            orderBy: { updatedAt: 'desc' },
        });
    }

    /**
     * Clean up old prompt logs (keep last 100 per guild)
     */
    async cleanupOldLogs(guildId: string, keepCount: number = 100): Promise<number> {
        const logs = await prisma.promptLog.findMany({
            where: { guildId },
            orderBy: { createdAt: 'desc' },
            skip: keepCount,
            select: { id: true },
        });

        if (logs.length === 0) return 0;

        const result = await prisma.promptLog.deleteMany({
            where: { id: { in: logs.map(l => l.id) } },
        });

        return result.count;
    }
}

// Export singleton instance
export const promptEditService = new PromptEditService();
