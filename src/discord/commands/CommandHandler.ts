import { ChatInputCommandInteraction, ChannelType, VoiceChannel, EmbedBuilder, MessageFlags, OAuth2Scopes } from 'discord.js';
import { VoiceSessionManager } from '../voice/VoiceSessionManager';
import { MemoryService } from '../../services/memory/MemoryService';
import { logger } from '../../utils/logger';
import { formatRelativeTime, truncateText } from '../../utils/helpers';
import { parseRelativeTime } from '../../utils/timeUtils';

export class CommandHandler {
    private voiceManager: VoiceSessionManager;
    private memoryService: MemoryService;

    constructor(voiceManager: VoiceSessionManager, memoryService: MemoryService) {
        this.voiceManager = voiceManager;
        this.memoryService = memoryService;
    }

    /**
     * Handle slash command interactions
     */
    async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const { commandName } = interaction;

        try {
            switch (commandName) {
                case 'voice_logger':
                    await this.handleVoiceLogger(interaction);
                    break;
                case 'server_memory':
                    await this.handleServerMemory(interaction);
                    break;
                case 'logs':
                    await this.handleLogs(interaction);
                    break;
                default:
                    await interaction.reply({
                        content: 'Unknown command!',
                        flags: MessageFlags.Ephemeral,
                    });
            }
        } catch (error) {
            logger.error(`Error handling command ${commandName}:`, error);

            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: `Error: ${errorMessage}`,
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await interaction.reply({
                    content: `Error: ${errorMessage}`,
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    }

    /**
     * Handle /voice_logger command
     */
    private async handleVoiceLogger(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'start':
                await this.handleVoiceLoggerStart(interaction);
                break;
            case 'stop':
                await this.handleVoiceLoggerStop(interaction);
                break;
        }
    }

    private async handleVoiceLoggerStart(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channelOption = interaction.options.getChannel('channel', true);
        logger.info(`Voice logger start: guildId=${interaction.guildId}, channelId=${channelOption.id}`);

        if (channelOption.type !== ChannelType.GuildVoice) {
            await interaction.editReply('Please select a voice channel!');
            return;
        }

        // Fetch the guild if not in cache
        logger.info(`Checking for guild in cache...`);
        let guild = interaction.client.guilds.cache.get(interaction.guildId!);

        if (!guild) {
            logger.info(`Guild not in cache, fetching from API...`);
            try {
                guild = await interaction.client.guilds.fetch(interaction.guildId!);
                logger.info(`Successfully fetched guild: ${guild.name}`);
            } catch (error: any) {
                if (error.code === 10004 || error.status === 404) {
                    logger.warn(`Guild not found (likely not invited): ${interaction.guildId}`);
                    const inviteLink = interaction.client.generateInvite({
                        scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
                        permissions: ['Administrator'],
                    });

                    await interaction.editReply({
                        content: `❌ I'm not in this server! \n\nI need to be a member of the server to join voice channels. [Click here to invite me](${inviteLink})`,
                    });
                    return;
                }

                logger.error(`Failed to fetch guild:`, error);
                await interaction.editReply('Could not find the server!');
                return;
            }
        } else {
            logger.info(`Guild found in cache: ${guild.name}`);
        }

        const voiceChannel = guild.channels.cache.get(channelOption.id) as VoiceChannel;
        if (!voiceChannel) {
            logger.error(`Voice channel not found in guild cache`);
            await interaction.editReply('Could not find that voice channel!');
            return;
        }

        logger.info(`Found voice channel: ${voiceChannel.name}`);

        // Check if already logging
        if (this.voiceManager.isSessionActive(interaction.guildId!, voiceChannel.id)) {
            await interaction.editReply(`Already logging voice chat in ${voiceChannel.name}!`);
            return;
        }

        try {
            logger.info(`Starting voice session...`);
            await this.voiceManager.startSession(voiceChannel);
            await interaction.editReply(
                `✅ Started logging voice chat in **${voiceChannel.name}**!\n\nI'll transcribe conversations and build memories from what's discussed.`
            );
        } catch (error) {
            logger.error('Failed to start voice logging:', error);
            await interaction.editReply('Failed to start voice logging. Make sure I have permission to join the channel!');
        }
    }

    /**
     * Handle /voice_logger stop
     */
    private async handleVoiceLoggerStop(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Find active session for this guild
        const member = interaction.member;
        if (!member || !('voice' in member) || !member.voice.channel) {
            await interaction.editReply('You must be in a voice channel to stop logging!');
            return;
        }

        const channelId = member.voice.channel.id;

        if (!this.voiceManager.isSessionActive(interaction.guildId!, channelId)) {
            await interaction.editReply('No active voice logging session in your channel!');
            return;
        }

        try {
            await this.voiceManager.stopSession(interaction.guildId!, channelId);
            await interaction.editReply('✅ Stopped logging voice chat! Session memories have been saved.');
        } catch (error) {
            logger.error('Failed to stop voice logging:', error);
            await interaction.editReply('Failed to stop voice logging.');
        }
    }

    /**
     * Handle /server_memory command
     */
    private async handleServerMemory(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'summary':
                await this.handleServerMemorySummary(interaction);
                break;
            case 'user':
                await this.handleServerMemoryUser(interaction);
                break;
            case 'search':
                await this.handleServerMemorySearch(interaction);
                break;
        }
    }

    /**
     * Handle /server_memory summary
     */
    private async handleServerMemorySummary(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const summary = await this.memoryService.getServerSummary(interaction.guildId!);

        const embed = new EmbedBuilder()
            .setTitle('🧠 Server Memory Summary')
            .setColor(0x5865f2)
            .setDescription('Here\'s what I know about this server:')
            .addFields(
                {
                    name: '📊 Memory Statistics',
                    value: Object.entries(summary.memoryCount)
                        .map(([type, count]) => `${type}: ${count}`)
                        .join('\n') || 'No memories yet',
                }
            )
            .setTimestamp();

        if (summary.recentMemories.length > 0) {
            const recentMemoriesText = summary.recentMemories
                .slice(0, 5)
                .map((mem) => `**[${mem.type}]** ${truncateText(mem.title, 80)}`)
                .join('\n');

            embed.addFields({
                name: '🕐 Recent Memories',
                value: recentMemoriesText,
            });
        }

        await interaction.editReply({ embeds: [embed] });
    }

    /**
     * Handle /server_memory user
     */
    private async handleServerMemoryUser(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const user = interaction.options.getUser('user', true);
        const profile = await this.memoryService.retrieveMemoriesForChat(
            interaction.guildId!,
            '',
            [user.id]
        );

        if (!profile.userProfiles.length) {
            await interaction.editReply(`I don't have a profile for ${user.username} yet!`);
            return;
        }

        const userProfile = profile.userProfiles[0]!;

        const embed = new EmbedBuilder()
            .setTitle(`👤 ${user.username}`)
            .setColor(0x5865f2)
            .setThumbnail(user.displayAvatarURL())
            .setDescription(userProfile.summary)
            .addFields({
                name: '🏷️ Tags',
                value: userProfile.tags.join(', ') || 'No tags',
            })
            .setFooter({
                text: `Last updated ${formatRelativeTime(userProfile.lastUpdated)}`,
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    /**
     * Handle /server_memory search
     */
    private async handleServerMemorySearch(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const query = interaction.options.getString('query', true);
        const results = await this.memoryService.searchMemories(interaction.guildId!, query);

        if (results.length === 0) {
            await interaction.editReply(`No memories found for: "${query}"`);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🔍 Search Results: "${query}"`)
            .setColor(0x5865f2)
            .setDescription(`Found ${results.length} relevant memories:`)
            .setTimestamp();

        for (const memory of results.slice(0, 10)) {
            embed.addFields({
                name: `[${memory.type}] ${memory.title}`,
                value: truncateText(memory.content, 200),
            });
        }

        await interaction.editReply({ embeds: [embed] });
    }

    /**
     * Handle /logs command
     */
    private async handleLogs(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'window':
                await this.handleLogsWindow(interaction);
                break;
            case 'user':
                await this.handleLogsUser(interaction);
                break;
        }
    }

    /**
     * Handle /logs window
     */
    private async handleLogsWindow(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channel = interaction.options.getChannel('channel', true);
        const fromStr = interaction.options.getString('from', true);
        const toStr = interaction.options.getString('to', false) || 'now';

        try {
            const fromDate = parseRelativeTime(fromStr);
            const toDate = parseRelativeTime(toStr);

            // Get transcripts from memory service
            const transcripts = await this.memoryService.getTranscriptsByChannel(
                interaction.guildId!,
                channel.id,
                fromDate,
                toDate
            );

            if (transcripts.length === 0) {
                await interaction.editReply(`No transcripts found for ${channel.name} in the specified time range.`);
                return;
            }

            // Format transcripts into readable text
            const formattedText = transcripts
                .map((t) => {
                    const time = t.startedAt.toISOString();
                    const user = t.userId ? `<@${t.userId}>` : 'Unknown';
                    return `[${time}] ${user}: ${t.rawText}`;
                })
                .join('\n');

            // Split into embeds if needed (Discord embed field limit is 1024 chars)
            const chunks = this.splitIntoChunks(formattedText, 1900);

            for (let i = 0; i < Math.min(chunks.length, 5); i++) {
                const embed = new EmbedBuilder()
                    .setTitle(i === 0 ? `📜 Transcripts: ${channel.name}` : null)
                    .setDescription(`**From:** ${fromDate.toLocaleString()}\n**To:** ${toDate.toLocaleString()}\n\n${chunks[i]}`)
                    .setColor(0x5865f2);

                if (i === 0) {
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
                }
            }

            if (chunks.length > 5) {
                await interaction.followUp({
                    content: `⚠️ Showing first 5 pages. Total: ${chunks.length} pages (${transcripts.length} transcripts)`,
                    flags: MessageFlags.Ephemeral,
                });
            }
        } catch (error) {
            logger.error('Failed to get transcripts:', error);
            await interaction.editReply(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle /logs user
     */
    private async handleLogsUser(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const user = interaction.options.getUser('user', true);
        const fromStr = interaction.options.getString('from', true);
        const toStr = interaction.options.getString('to', false) || 'now';

        try {
            const fromDate = parseRelativeTime(fromStr);
            const toDate = parseRelativeTime(toStr);

            // Get transcripts from memory service
            const transcripts = await this.memoryService.getTranscriptsByUser(
                interaction.guildId!,
                user.id,
                fromDate,
                toDate
            );

            if (transcripts.length === 0) {
                await interaction.editReply(`No transcripts found for ${user.username} in the specified time range.`);
                return;
            }

            // Format transcripts into readable text
            const formattedText = transcripts
                .map((t) => {
                    const time = t.startedAt.toISOString();
                    const channelName = `<#${t.channelId}>`;
                    return `[${time}] ${channelName}: ${t.rawText}`;
                })
                .join('\n');

            // Split into embeds if needed
            const chunks = this.splitIntoChunks(formattedText, 1900);

            for (let i = 0; i < Math.min(chunks.length, 5); i++) {
                const embed = new EmbedBuilder()
                    .setTitle(i === 0 ? `📜 Transcripts: ${user.username}` : null)
                    .setDescription(`**From:** ${fromDate.toLocaleString()}\n**To:** ${toDate.toLocaleString()}\n\n${chunks[i]}`)
                    .setColor(0x5865f2)
                    .setThumbnail(i === 0 ? user.displayAvatarURL() : null);

                if (i === 0) {
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
                }
            }

            if (chunks.length > 5) {
                await interaction.followUp({
                    content: `⚠️ Showing first 5 pages. Total: ${chunks.length} pages (${transcripts.length} transcripts)`,
                    flags: MessageFlags.Ephemeral,
                });
            }
        } catch (error) {
            logger.error('Failed to get user transcripts:', error);
            await interaction.editReply(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Split text into chunks
     */
    private splitIntoChunks(text: string, maxLength: number): string[] {
        const chunks: string[] = [];
        let current = '';
        const lines = text.split('\n');

        for (const line of lines) {
            if (current.length + line.length + 1 > maxLength) {
                if (current) chunks.push(current);
                current = line;
            } else {
                current += (current ? '\n' : '') + line;
            }
        }
        if (current) chunks.push(current);

        return chunks;
    }
}
