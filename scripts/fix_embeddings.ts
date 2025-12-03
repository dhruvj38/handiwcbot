/**
 * Fix embedding dimensions from 1536 to 768
 * Run with: npx ts-node scripts/fix_embeddings.ts
 */

import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    
    try {
        console.log('Connecting to database...');
        await prisma.$connect();
        
        console.log('Dropping and recreating user_profiles.embedding column...');
        await prisma.$executeRawUnsafe(`ALTER TABLE user_profiles DROP COLUMN IF EXISTS embedding;`);
        await prisma.$executeRawUnsafe(`ALTER TABLE user_profiles ADD COLUMN embedding vector(768);`);
        console.log('✅ user_profiles.embedding updated to vector(768)');
        
        console.log('Dropping and recreating session_summaries.embedding column...');
        await prisma.$executeRawUnsafe(`ALTER TABLE session_summaries DROP COLUMN IF EXISTS embedding;`);
        await prisma.$executeRawUnsafe(`ALTER TABLE session_summaries ADD COLUMN embedding vector(768);`);
        console.log('✅ session_summaries.embedding updated to vector(768)');
        
        console.log('\n🎉 Database updated successfully!');
        console.log('You can now run the bot with: npm run dev');
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
