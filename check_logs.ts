import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkLogs() {
    try {
        const count = await prisma.activityLog.count();
        console.log(`Total Activity Logs: ${count}`);

        const recent = await prisma.activityLog.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' }
        });
        console.log('Recent Logs:', JSON.stringify(recent, null, 2));
    } catch (error) {
        console.error('Error checking logs:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkLogs();
