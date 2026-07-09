import { REST, Routes } from 'discord.js';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { commands } from './index';

export async function registerCommands(): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);

    try {
        logger.info('Started refreshing application (/) commands.');

        // Always clear global commands to prevent duplicates
        logger.info('Clearing any stale global commands...');
        await rest.put(
            Routes.applicationCommands(config.discord.clientId),
            { body: [] }
        );

        if (config.discord.guildId) {

            // Register commands for a specific guild (faster for development)
            await rest.put(
                Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
                { body: commands }
            );
            logger.info(`Successfully registered ${commands.length} guild commands.`);
        } else {
            // Register commands globally (takes up to 1 hour to propagate)
            await rest.put(
                Routes.applicationCommands(config.discord.clientId),
                { body: commands }
            );
            logger.info(`Successfully registered ${commands.length} global commands.`);
        }
    } catch (error) {
        logger.error('Failed to register commands:', error);
        throw error;
    }
}
