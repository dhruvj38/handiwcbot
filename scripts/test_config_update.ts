import { configService } from '../src/api/services/ConfigService';
import { getPrismaClient } from '../src/db/client';

import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(__dirname, 'test_output.txt');

function log(message: any) {
    const str = String(message);
    console.error(str);
    fs.appendFileSync(LOG_FILE, str + '\n');
}

// Clear log file
fs.writeFileSync(LOG_FILE, '');

async function testConfigPersistence() {
    const db = getPrismaClient();

    // Get the first guild config to test with
    const existingConfig = await db.guildConfig.findFirst();

    if (!existingConfig) {
        log('No guild config found to test with.');
        return;
    }

    const guildId = existingConfig.guildId;
    log(`Testing with guildId: ${guildId}`);

    // 1. Get initial state
    const initialConfig = await configService.getGuildConfig(guildId);
    log(`Initial chimeInChance: ${initialConfig?.chimeInChance}`);

    // 2. Update a value
    const newChance = 0.99; // Distinct value
    log(`Updating chimeInChance to ${newChance}...`);

    await configService.updateGuildConfig(
        guildId,
        { chimeInChance: newChance },
        'test-script',
        'Test Script'
    );

    // 3. Verify persistence (bypass cache to be sure, though service handles cache invalidation)
    // We'll use the service first to check its cache logic
    const updatedConfigService = await configService.getGuildConfig(guildId);
    log(`Service returned chimeInChance: ${updatedConfigService?.chimeInChance}`);

    if (updatedConfigService?.chimeInChance !== newChance) {
        log('FAILED: Service did not return updated value.');
    } else {
        log('SUCCESS: Service returned updated value.');
    }

    // 4. Verify directly in DB to ensure it's not just a cache update
    const dbConfig = await db.guildConfig.findUnique({ where: { guildId } });
    log(`DB returned chimeInChance: ${dbConfig?.chimeInChance}`);

    if (dbConfig?.chimeInChance !== newChance) {
        log('FAILED: Database does not have updated value.');
    } else {
        log('SUCCESS: Database has updated value.');
    }

    // 5. Cleanup - Restore original value
    if (initialConfig) {
        log(`Restoring original chimeInChance: ${initialConfig.chimeInChance}...`);
        await configService.updateGuildConfig(
            guildId,
            { chimeInChance: initialConfig.chimeInChance },
            'test-script',
            'Test Script'
        );
    }
}

testConfigPersistence()
    .catch((e) => log(e))
    .finally(async () => {
        const db = getPrismaClient();
        await db.$disconnect();
        log('Test completed. Exiting.');
        process.exit(0);
    });
