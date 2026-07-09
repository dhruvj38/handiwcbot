import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkLogs() {
    try {
        const recent = await prisma.activityLog.findMany({
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: { type: true, summary: true, guildId: true }
        });
        console.log('Recent Log Types:', JSON.stringify(recent, null, 2));
    } catch (error) {
        console.error('Error checking logs:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkLogs();
