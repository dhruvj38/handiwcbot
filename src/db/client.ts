import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

let prisma: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
    if (!prisma) {
        prisma = new PrismaClient({
            log: [
                { level: 'warn', emit: 'event' },
                { level: 'error', emit: 'event' },
            ],
        });

        prisma.$on('warn' as never, (e: unknown) => {
            logger.warn('Prisma warning:', e);
        });

        prisma.$on('error' as never, (e: unknown) => {
            logger.error('Prisma error:', e);
        });
    }

    return prisma;
}

export async function disconnectDatabase(): Promise<void> {
    if (prisma) {
        await prisma.$disconnect();
        prisma = null;
        logger.info('Database disconnected');
    }
}

// Enable pgvector extension
export async function enablePgVector(): Promise<void> {
    const client = getPrismaClient();
    try {
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
        logger.info('pgvector extension enabled');
    } catch (error) {
        logger.error('Failed to enable pgvector extension:', error);
        throw error;
    }
}
