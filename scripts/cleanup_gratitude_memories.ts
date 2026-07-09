import { getPrismaClient, disconnectDatabase } from '../src/db/client';
import { logger } from '../src/utils/logger';

const prisma = getPrismaClient();

const GRATITUDE_REGEX = /\b(thank( you)?|thanks|appreciat(?:e|ed|es)?)\b/i;

function containsGratitude(text: string | null | undefined): boolean {
    if (!text) return false;
    return GRATITUDE_REGEX.test(text);
}

function removeGratitudeSentences(text: string): string {
    if (!text) return text;
    const sentences = text.split(/(?<=[.!?])\s+/);
    const filtered = sentences.filter((s) => s.trim().length > 0 && !GRATITUDE_REGEX.test(s));
    return filtered.join(' ');
}

async function cleanSessionSummaries(): Promise<{ scanned: number; cleaned: number }> {
    const summaries = await prisma.sessionSummary.findMany();
    let scanned = 0;
    let cleaned = 0;

    for (const summary of summaries) {
        const metaText = summary.metadata ? JSON.stringify(summary.metadata) : '';
        const combinedText = `${summary.summaryText || ''} ${metaText}`;
        if (!containsGratitude(combinedText)) {
            continue;
        }

        scanned++;

        const transcriptsCount = await prisma.transcriptChunk.count({
            where: {
                serverId: summary.serverId,
                channelId: summary.channelId,
                startedAt: { gte: summary.timeRangeStart },
                endedAt: { lte: summary.timeRangeEnd },
                OR: [
                    { rawText: { contains: 'thank', mode: 'insensitive' } },
                    { rawText: { contains: 'appreciat', mode: 'insensitive' } },
                ],
            },
        });

        if (transcriptsCount > 0) {
            continue;
        }

        let newSummaryText = removeGratitudeSentences(summary.summaryText || '');

        let newMetadata: any = summary.metadata ?? null;
        if (newMetadata && typeof newMetadata === 'object' && !Array.isArray(newMetadata)) {
            newMetadata = { ...newMetadata };
            if (Array.isArray(newMetadata.events)) {
                newMetadata.events = newMetadata.events.filter((e: unknown) =>
                    typeof e === 'string' ? !containsGratitude(e) : true,
                );
            }
            if (Array.isArray(newMetadata.plans)) {
                newMetadata.plans = newMetadata.plans.filter((p: unknown) =>
                    typeof p === 'string' ? !containsGratitude(p) : true,
                );
            }
            if (Array.isArray(newMetadata.memes)) {
                newMetadata.memes = newMetadata.memes.filter((m: unknown) =>
                    typeof m === 'string' ? !containsGratitude(m) : true,
                );
            }
        }

        await prisma.sessionSummary.update({
            where: { id: summary.id },
            data: {
                summaryText: newSummaryText,
                metadata: newMetadata,
            },
        });

        cleaned++;
    }

    return { scanned, cleaned };
}

async function cleanServerMemories(): Promise<{ scanned: number; deleted: number }> {
    const memories = await prisma.serverMemory.findMany({
        where: {
            type: { in: ['event', 'meme', 'plan'] },
        },
    });

    let scanned = 0;
    let deleted = 0;

    for (const mem of memories) {
        const meta = mem.metadata as any;
        if (meta && (meta.isGif === true || meta.isGoodResponseExample === true || meta.isServerBible === true)) {
            continue;
        }

        const combinedText = `${mem.title} ${mem.content}`;
        if (!containsGratitude(combinedText)) {
            continue;
        }

        scanned++;

        await prisma.serverMemory.delete({ where: { id: mem.id } });
        deleted++;
    }

    return { scanned, deleted };
}

async function main(): Promise<void> {
    logger.info('Starting gratitude cleanup script...');

    const summaryResult = await cleanSessionSummaries();
    logger.info(
        `Session summaries scanned=${summaryResult.scanned}, cleaned=${summaryResult.cleaned}`,
    );

    const memoryResult = await cleanServerMemories();
    logger.info(
        `Server memories scanned=${memoryResult.scanned}, deleted=${memoryResult.deleted}`,
    );

    logger.info('Gratitude cleanup script completed');
}

main()
    .catch((err) => {
        logger.error('Gratitude cleanup script failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectDatabase().catch((err) => {
            logger.error('Failed to disconnect database:', err);
        });
    });
