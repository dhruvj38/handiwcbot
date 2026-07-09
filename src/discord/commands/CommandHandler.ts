import { ChatInputCommandInteraction, ChannelType, VoiceChannel, TextChannel, EmbedBuilder, MessageFlags, OAuth2Scopes, PermissionsBitField, GuildMember, Message } from 'discord.js';
import { runtimeConfig } from '../../services/RuntimeConfigManager';
import { VoiceSessionManager } from '../voice/VoiceSessionManager';
import { MemoryService } from '../../services/memory/MemoryService';
import { AiService } from '../../services/ai/AiService';
import { ServerProfiler, RawMessage, MessageCache, ChannelClassifier } from '../../services/profiler';
import { RealtimeLearningService } from '../../services/learning/RealtimeLearningService';
import { logger } from '../../utils/logger';
import { activityLogger } from '../../api/services/ActivityLogger';
import { formatRelativeTime, truncateText } from '../../utils/helpers';
import { parseRelativeTime } from '../../utils/timeUtils';

export class CommandHandler {
    private voiceManager: VoiceSessionManager;
    private memoryService: MemoryService;
    private aiService: AiService;
    private learningService?: RealtimeLearningService;

    constructor(voiceManager: VoiceSessionManager, memoryService: MemoryService, aiService: AiService, learningService?: RealtimeLearningService) {
        this.voiceManager = voiceManager;
        this.memoryService = memoryService;
        this.aiService = aiService;
        this.learningService = learningService;
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
                case 'profile_server':
                    await this.handleProfileServer(interaction);
                    break;
                case 'speak':
                    await this.handleSpeak(interaction);
                    break;
                case 'gif_train':
                    await this.handleGifTrain(interaction);
                    break;
                case 'clear_memories':
                    await this.handleClearMemories(interaction);
                    break;
                case 'feedback':
                    await this.handleFeedback(interaction);
                    break;
                case 'train':
                    await this.handleTrain(interaction);
                    break;
                case 'nickname':
                    await this.handleNickname(interaction);
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

            // Wrap error response in try-catch to prevent crashes from Discord API errors
            try {
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
            } catch (replyError) {
                // Interaction may have expired or already been handled - just log it
                logger.warn(`Could not send error response for ${commandName}:`, replyError);
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
            const message = error instanceof Error && error.message.includes('Speech service unavailable')
                ? 'Failed to start voice logging because the speech/transcription server is unavailable. Make sure your Whisper server is running or disable voice features.'
                : 'Failed to start voice logging. Make sure I have permission to join the channel!';

            await interaction.editReply(message);
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

    private async handleGifTrain(interaction: ChatInputCommandInteraction): Promise<void> {
        const startTime = Date.now();
        const guildId = interaction.guildId!;
        const correlationId = `gif_train_${Date.now()}`;

        // Log command start to activity logger
        activityLogger.command(guildId, 'gif_train', {
            userId: interaction.user.id,
            userName: interaction.user.tag,
            metadata: { correlationId },
        });
        activityLogger.taskStart(guildId, 'gif_train', {
            userId: interaction.user.id,
            userName: interaction.user.tag,
            correlationId,
        });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channelOption = interaction.options.getChannel('channel', true);
        const limitOption = interaction.options.getInteger('limit');

        if (channelOption.type !== ChannelType.GuildText && channelOption.type !== ChannelType.GuildAnnouncement) {
            activityLogger.warn(guildId, 'gif_train', `Invalid channel type: ${channelOption.type}`, { correlationId });
            await interaction.editReply('❌ Please select a text channel!');
            return;
        }

        const maxMessages = limitOption && limitOption > 0 ? Math.min(limitOption, 20000) : 5000;
        const textChannel = channelOption as TextChannel;

        activityLogger.taskProgress(guildId, 'gif_train', `Starting scan of #${textChannel.name} (max ${maxMessages} messages)`, { correlationId });

        await interaction.editReply(
            `🎬 **Training GIF Usage**\n\n` +
            `📌 **Channel:** #${textChannel.name}\n` +
            `📊 **Max Messages:** ${maxMessages.toLocaleString()}\n\n` +
            `⏳ Starting message scan...`
        );

        try {
            let fetchedCount = 0;
            let lastId: string | undefined;
            const gifMap: Map<string, { url: string; count: number; sampleTexts: string[] }> = new Map();
            let lastUpdateTime = Date.now();
            const UPDATE_INTERVAL = 3000; // Update every 3 seconds

            while (fetchedCount < maxMessages) {
                const fetchSize = Math.min(100, maxMessages - fetchedCount);
                const messages = await textChannel.messages.fetch({
                    limit: fetchSize,
                    before: lastId,
                });

                if (!messages.size) {
                    break;
                }

                for (const [, msg] of messages) {
                    fetchedCount++;

                    // Attachments (images/gifs)
                    for (const [, attachment] of msg.attachments) {
                        const url = attachment.url;
                        if (!url) continue;
                        const lower = url.toLowerCase();
                        const isGif = lower.endsWith('.gif') || lower.includes('tenor.com') || lower.includes('giphy.com');
                        if (!isGif) continue;

                        const existing = gifMap.get(url) || { url, count: 0, sampleTexts: [] };
                        existing.count += 1;
                        if (msg.content && existing.sampleTexts.length < 5) {
                            existing.sampleTexts.push(msg.content);
                        }
                        gifMap.set(url, existing);
                    }

                    // Embedded GIFs (e.g., tenor links expanded as embeds)
                    for (const embed of msg.embeds) {
                        const url = embed.url || embed.thumbnail?.url || embed.image?.url;
                        if (!url) continue;
                        const lower = url.toLowerCase();
                        const isGif = lower.endsWith('.gif') || lower.includes('tenor.com') || lower.includes('giphy.com');
                        if (!isGif) continue;

                        const existing = gifMap.get(url) || { url, count: 0, sampleTexts: [] };
                        existing.count += 1;
                        if (msg.content && existing.sampleTexts.length < 5) {
                            existing.sampleTexts.push(msg.content);
                        }
                        gifMap.set(url, existing);
                    }

                    lastId = msg.id;
                    if (fetchedCount >= maxMessages) break;
                }

                // Real-time progress update (every 3 seconds)
                const now = Date.now();
                if (now - lastUpdateTime > UPDATE_INTERVAL) {
                    const elapsedSec = Math.round((now - startTime) / 1000);
                    const rate = Math.round(fetchedCount / elapsedSec);
                    const pct = Math.round((fetchedCount / maxMessages) * 100);
                    const progressBar = `[${'█'.repeat(Math.floor(pct / 5))}${'░'.repeat(20 - Math.floor(pct / 5))}]`;

                    // Log progress to dashboard
                    activityLogger.taskProgress(guildId, 'gif_train', `${pct}% (${fetchedCount}/${maxMessages} msgs, ${gifMap.size} GIFs, ${rate} msg/s)`, {
                        correlationId,
                        metadata: { fetchedCount, maxMessages, gifsFound: gifMap.size, rate },
                    });

                    await interaction.editReply(
                        `🎬 **Training GIF Usage**\n\n` +
                        `📌 **Channel:** #${textChannel.name}\n\n` +
                        `📊 **Progress:**\n` +
                        `${progressBar} ${pct}%\n\n` +
                        `• **Messages scanned:** ${fetchedCount.toLocaleString()} / ${maxMessages.toLocaleString()}\n` +
                        `• **GIFs found:** ${gifMap.size}\n` +
                        `• **Speed:** ${rate} msg/s\n` +
                        `• **Elapsed:** ${elapsedSec}s`
                    );
                    lastUpdateTime = now;
                }

                if (messages.size < 100) break;
            }

            if (gifMap.size === 0) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                activityLogger.taskComplete(guildId, 'gif_train', `No GIFs found in ${fetchedCount} messages`, {
                    correlationId,
                    latencyMs: Date.now() - startTime,
                    metadata: { fetchedCount, gifsFound: 0 },
                });
                await interaction.editReply(
                    `⚠️ **No GIFs Found**\n\n` +
                    `📌 **Channel:** #${textChannel.name}\n` +
                    `📊 **Messages scanned:** ${fetchedCount.toLocaleString()}\n` +
                    `⏱️ **Time taken:** ${elapsed}s\n\n` +
                    `No GIFs or Tenor/Giphy links were found in this channel.`
                );
                return;
            }

            // Sort and limit to top 100
            const sortedGifs = Array.from(gifMap.values()).sort((a, b) => b.count - a.count).slice(0, 100);

            activityLogger.taskProgress(guildId, 'gif_train', `Storing ${sortedGifs.length} GIF patterns`, { correlationId });

            await interaction.editReply(
                `🎬 **Training GIF Usage**\n\n` +
                `📌 **Channel:** #${textChannel.name}\n\n` +
                `✅ **Scan Complete!**\n` +
                `• **Messages scanned:** ${fetchedCount.toLocaleString()}\n` +
                `• **Unique GIFs found:** ${gifMap.size}\n\n` +
                `💾 Storing top ${sortedGifs.length} GIF patterns...`
            );

            let storedCount = 0;
            for (const gif of sortedGifs) {
                const descriptionParts: string[] = [];
                descriptionParts.push(`GIF used ${gif.count} times in #${textChannel.name}.`);
                if (gif.sampleTexts.length > 0) {
                    descriptionParts.push('Example messages around this GIF:');
                    for (const text of gif.sampleTexts) {
                        descriptionParts.push(`- ${text}`);
                    }
                }

                const description = descriptionParts.join('\n');
                const title = `GIF: ${gif.url.split('/').pop() || 'reaction'} (${gif.count} uses)`;

                await this.memoryService.storeGifMemory(interaction.guildId!, {
                    title,
                    gifUrl: gif.url,
                    description,
                    usageCount: gif.count,
                    channelId: textChannel.id,
                });
                storedCount++;
            }

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const topGifs = sortedGifs.slice(0, 5);
            const topGifsDisplay = topGifs.map((g, i) => `${i + 1}. ${g.count} uses`).join('\n');

            activityLogger.taskComplete(guildId, 'gif_train', `Stored ${storedCount} GIF patterns from ${fetchedCount} messages`, {
                correlationId,
                latencyMs: Date.now() - startTime,
                metadata: { fetchedCount, gifsFound: gifMap.size, storedCount },
            });

            await interaction.editReply(
                `✅ **GIF Training Complete!**\n\n` +
                `📌 **Channel:** #${textChannel.name}\n\n` +
                `📊 **Results:**\n` +
                `• **Messages scanned:** ${fetchedCount.toLocaleString()}\n` +
                `• **Unique GIFs found:** ${gifMap.size}\n` +
                `• **GIF patterns stored:** ${storedCount}\n\n` +
                `🏆 **Top GIFs by Usage:**\n\`\`\`\n${topGifsDisplay}\n\`\`\`\n` +
                `⏱️ **Completed in:** ${elapsed}s\n\n` +
                `✨ The bot will now use these GIFs naturally in conversations!`
            );
        } catch (error) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            activityLogger.taskError(guildId, 'gif_train', error instanceof Error ? error : new Error(String(error)), {
                correlationId,
                metadata: { elapsed },
            });
            await interaction.editReply(
                `❌ **GIF Training Failed**\n\n` +
                `📌 **Channel:** #${textChannel.name}\n` +
                `⏱️ **After:** ${elapsed}s\n\n` +
                `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}`
            );
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
     * Handle /profile_server command - dispatch to subcommand handlers
     */
    private async handleProfileServer(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'scan':
                await this.handleProfileServerScan(interaction);
                break;
            case 'recheck_messages':
                await this.handleProfileServerRecheck(interaction);
                break;
            case 'status':
                await this.handleProfileServerStatus(interaction);
                break;
            default:
                // Fallback for legacy calls without subcommand
                await this.handleProfileServerScan(interaction);
        }
    }

    /**
     * Handle /profile_server status - show cache info and profile status
     */
    private async handleProfileServerStatus(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply('This command must be used in a server!');
            return;
        }

        const metadata = MessageCache.loadMetadata(guild.id);
        const cacheAge = MessageCache.getCacheAge(guild.id);
        const hasValidCache = MessageCache.hasValidCache(guild.id);

        const embed = new EmbedBuilder()
            .setTitle(`📊 Profile Status: ${guild.name}`)
            .setColor(hasValidCache ? 0x00ff00 : 0xffaa00)
            .setThumbnail(guild.iconURL());

        if (metadata) {
            embed.addFields(
                {
                    name: '💾 Cache Status',
                    value: hasValidCache ? '✅ Valid cache available' : '⚠️ Cache expired or missing',
                    inline: true,
                },
                {
                    name: '⏰ Cache Age',
                    value: cacheAge ? `${cacheAge.toFixed(1)} days` : 'No cache',
                    inline: true,
                },
                {
                    name: '💬 Cached Messages',
                    value: metadata.messageCount.toLocaleString(),
                    inline: true,
                },
                {
                    name: '📅 Cache Date',
                    value: new Date(metadata.cachedAt).toLocaleString(),
                    inline: true,
                },
                {
                    name: '📆 Message Range',
                    value: `${new Date(metadata.oldestMessage).toLocaleDateString()} → ${new Date(metadata.newestMessage).toLocaleDateString()}`,
                    inline: true,
                }
            );
        } else {
            embed.addFields({
                name: '💾 Cache Status',
                value: '❌ No cache found - run `/profile_server scan` to build profile',
            });
        }

        embed.addFields({
            name: '🔧 Commands',
            value: '• `/profile_server scan` - Run profile (uses cache if valid)\n• `/profile_server scan force:true` - Force fresh scan\n• `/profile_server recheck_messages` - Delete cache and rescan all messages',
        });

        await interaction.editReply({ embeds: [embed] });
    }

    /**
     * Handle /profile_server recheck_messages - delete cache and rescan
     */
    private async handleProfileServerRecheck(interaction: ChatInputCommandInteraction): Promise<void> {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: 'This command must be used in a server!', flags: MessageFlags.Ephemeral });
            return;
        }

        // Delete the cache first
        MessageCache.deleteCache(guild.id);
        logger.info(`[RECHECK_MESSAGES] Deleted cache for ${guild.id}, starting fresh scan...`);

        // Now run the regular scan (which will fetch fresh data since cache is gone)
        await this.handleProfileServerScan(interaction, true);
    }

    /**
     * Handle /profile_server scan - parse ALL server data with NO LIMITS
     */
    private async handleProfileServerScan(interaction: ChatInputCommandInteraction, isRecheck: boolean = false): Promise<void> {
        console.log('[PROFILE_SERVER] Command received, deferring reply...');
        logger.info(`profile_server ${isRecheck ? 'recheck_messages' : 'scan'} invoked`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        console.log('[PROFILE_SERVER] Reply deferred successfully');

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply('This command must be used in a server!');
            return;
        }

        // Check for force option to skip cache (only for 'scan' subcommand)
        const forceRefresh = isRecheck || (interaction.options.getBoolean('force') || false);
        if (forceRefresh && !isRecheck) {
            MessageCache.deleteCache(guild.id);
            logger.info(`Force refresh requested - deleted cache for ${guild.id}`);
        }

        try {
            const startTime = Date.now();

            const formatElapsed = () => {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                const mins = Math.floor(elapsed / 60);
                const secs = elapsed % 60;
                return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            };

            const formatNumber = (n: number) => n.toLocaleString();

            const calcRate = (count: number) => {
                const elapsedSec = (Date.now() - startTime) / 1000;
                if (elapsedSec < 1) return { rate: 0, eta: '...' };
                const rate = Math.round(count / elapsedSec);
                return { rate, eta: rate > 0 ? `${Math.round((200000 - count) / rate / 60)}m remaining` : '...' };
            };

            // Track if we've switched to channel messages (after webhook timeout)
            let useChannelMessages = false;
            let lastChannelMessage: Message<boolean> | null = null;

            // Terminal progress helper - strips markdown for clean console output
            const logToTerminal = (status: string) => {
                // Strip markdown formatting for terminal
                const clean = status
                    .replace(/\*\*/g, '')  // Bold
                    .replace(/`{1,3}/g, '') // Code blocks
                    .replace(/#{1,6} /g, '') // Headers
                    .replace(/\|/g, ' ') // Table pipes
                    .replace(/-{2,}/g, '-') // Table separators
                    .replace(/\n{3,}/g, '\n\n') // Multiple newlines
                    .trim();
                console.log('\n' + '═'.repeat(60));
                console.log(`[PROFILE SERVER] ${formatElapsed()}`);
                console.log('═'.repeat(60));
                console.log(clean);
                console.log('═'.repeat(60) + '\n');
            };

            const updateProgress = async (status: string) => {
                // Always log to terminal for live updates
                logToTerminal(status);

                try {
                    // Check if webhook has likely expired (be more aggressive - 3 minutes)
                    const elapsed = Date.now() - startTime;
                    if (elapsed > 180000 && !useChannelMessages) { // 3 minutes
                        useChannelMessages = true;
                        logger.info(`Switching to channel messages after ${Math.round(elapsed / 1000)}s`);

                        // Send initial channel message
                        const channel = interaction.channel;
                        if (channel && 'send' in channel) {
                            lastChannelMessage = await channel.send(`📊 **Profile Server Progress** (continuing...)\n${status.substring(0, 1900)}`);
                        }
                        return;
                    }

                    if (useChannelMessages) {
                        // Edit the channel message instead
                        if (lastChannelMessage) {
                            try {
                                await lastChannelMessage.edit(`📊 **Profile Server Progress**\n${status.substring(0, 1900)}`);
                            } catch (editErr) {
                                logger.warn('Failed to edit channel message, sending new one');
                                // If edit fails, send a new message
                                const channel = interaction.channel;
                                if (channel && 'send' in channel) {
                                    lastChannelMessage = await channel.send(`📊 **Profile Server Progress**\n${status.substring(0, 1900)}`);
                                }
                            }
                        }
                    } else {
                        // Try to update the interaction reply
                        try {
                            await interaction.editReply(status.substring(0, 1900));
                        } catch (replyErr: any) {
                            // Check if interaction expired
                            if (replyErr.code === 10062 || replyErr.message?.includes('Unknown interaction')) {
                                logger.warn('Interaction expired, switching to channel messages');
                                useChannelMessages = true;
                                const channel = interaction.channel;
                                if (channel && 'send' in channel) {
                                    lastChannelMessage = await channel.send(`📊 **Profile Server Progress** (interaction expired)\n${status.substring(0, 1900)}`);
                                }
                            } else {
                                throw replyErr;
                            }
                        }
                    }
                } catch (e: any) {
                    // If webhook fails, switch to channel messages
                    logger.error(`updateProgress error: ${e.message}`);
                    if (!useChannelMessages) {
                        useChannelMessages = true;
                        logger.warn('Webhook failed, switching to channel messages');
                        try {
                            const channel = interaction.channel;
                            if (channel && 'send' in channel) {
                                lastChannelMessage = await channel.send(`📊 **Profile Server Progress** (error recovery)\n${status.substring(0, 1900)}`);
                            }
                        } catch (sendErr) {
                            logger.error('Failed to send channel message:', sendErr);
                        }
                    }
                }
            };

            console.log('[PROFILE_SERVER] Sending initial progress update...');
            await updateProgress(`# 🔍 FULL SERVER SCAN\n\`\`\`\n⏱️ Elapsed: ${formatElapsed()}\n\`\`\`\n📋 Fetching ALL channels...`);
            console.log('[PROFILE_SERVER] Initial progress sent, fetching channels...');

            // ═══════════════════════════════════════════════════════════
            // FETCH ALL CHANNELS (text, voice, categories, forums, etc.)
            // ═══════════════════════════════════════════════════════════
            const channels = await guild.channels.fetch();
            console.log(`[PROFILE_SERVER] Fetched ${channels.size} channels`);
            const channelData: Array<{ id: string; name: string; type: string; topic?: string | null; parentName?: string; position: number }> = [];

            for (const [, channel] of channels) {
                if (!channel) continue;
                channelData.push({
                    id: channel.id,
                    name: channel.name,
                    type: ChannelType[channel.type] || 'Unknown',
                    topic: 'topic' in channel ? channel.topic : null,
                    parentName: channel.parent?.name || undefined,
                    position: channel.position,
                });
            }

            // Classify channels by their purpose (rules, general, media, etc.)
            const classifiedChannels = ChannelClassifier.classifyChannels(channelData);
            const channelCategorySummary = Object.entries(
                classifiedChannels.reduce((acc, ch) => {
                    acc[ch.category] = (acc[ch.category] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>)
            ).map(([cat, count]) => `${cat}: ${count}`).join(', ');
            console.log(`[PROFILE_SERVER] Channel categories: ${channelCategorySummary}`);

            await updateProgress(`# 🔍 FULL SERVER SCAN\n\`\`\`\n⏱️ Elapsed: ${formatElapsed()}\n\`\`\`\n✅ **${formatNumber(channelData.length)}** channels (classified)\n📋 Fetching ALL roles...`);

            // ═══════════════════════════════════════════════════════════
            // FETCH ALL ROLES
            // ═══════════════════════════════════════════════════════════
            console.log('[PROFILE_SERVER] Fetching roles...');
            const roles = await guild.roles.fetch();
            console.log(`[PROFILE_SERVER] Fetched ${roles.size} roles`);
            const roleData: Array<{ id: string; name: string; color: number; memberCount: number; permissions: string[]; position: number; mentionable: boolean; hoisted: boolean }> = [];

            for (const [, role] of roles) {
                if (!role) continue;
                roleData.push({
                    id: role.id,
                    name: role.name,
                    color: role.color,
                    memberCount: role.members.size,
                    permissions: role.permissions.toArray(),
                    position: role.position,
                    mentionable: role.mentionable,
                    hoisted: role.hoist,
                });
            }

            await updateProgress(`# 🔍 FULL SERVER SCAN\n\`\`\`\n⏱️ Elapsed: ${formatElapsed()}\n\`\`\`\n✅ **${formatNumber(channelData.length)}** channels\n✅ **${formatNumber(roleData.length)}** roles\n📋 Fetching ALL members...`);

            // ═══════════════════════════════════════════════════════════
            // FETCH ALL MEMBERS (including bots)
            // ═══════════════════════════════════════════════════════════
            console.log('[PROFILE_SERVER] Fetching members...');
            const members = await guild.members.fetch();
            console.log(`[PROFILE_SERVER] Fetched ${members.size} members`);
            const memberData: Array<{ id: string; displayName: string; username: string; roles: string[]; isBot: boolean; joinedAt: Date | null; premiumSince: Date | null; nickname: string | null; status?: string }> = [];

            for (const [, member] of members) {
                if (!member) continue;
                memberData.push({
                    id: member.id,
                    displayName: member.displayName,
                    username: member.user.username,
                    nickname: member.nickname,
                    roles: member.roles.cache.map(r => r.name).filter(n => n !== '@everyone'),
                    isBot: member.user.bot,
                    joinedAt: member.joinedAt,
                    premiumSince: member.premiumSince,
                    status: member.presence?.status || 'offline',
                });
            }

            await updateProgress(`# 🔍 FULL SERVER SCAN\n\`\`\`\n⏱️ Elapsed: ${formatElapsed()}\n\`\`\`\n✅ **${formatNumber(channelData.length)}** channels\n✅ **${formatNumber(roleData.length)}** roles\n✅ **${formatNumber(memberData.length)}** members\n📋 Fetching emojis & stickers...`);

            // ═══════════════════════════════════════════════════════════
            // FETCH EMOJIS AND STICKERS
            // ═══════════════════════════════════════════════════════════
            console.log('[PROFILE_SERVER] Fetching emojis...');
            const emojis = await guild.emojis.fetch();
            console.log(`[PROFILE_SERVER] Fetched ${emojis.size} emojis`);
            const emojiData = Array.from(emojis.values()).map(e => ({
                name: e.name || 'unknown',
                animated: e.animated || false,
                createdBy: e.author?.username || 'unknown',
            }));

            let stickerData: Array<{ name: string; description: string | null }> = [];
            try {
                const stickers = await guild.stickers.fetch();
                stickerData = Array.from(stickers.values()).map(s => ({
                    name: s.name,
                    description: s.description,
                }));
            } catch (e) {
                logger.warn('Could not fetch stickers');
            }

            await updateProgress(`# 🔍 FULL SERVER SCAN\n\`\`\`\n⏱️ Elapsed: ${formatElapsed()}\n\`\`\`\n✅ **${formatNumber(channelData.length)}** channels\n✅ **${formatNumber(roleData.length)}** roles\n✅ **${formatNumber(memberData.length)}** members\n✅ **${formatNumber(emojiData.length)}** emojis, **${formatNumber(stickerData.length)}** stickers\n📋 Fetching scheduled events...`);

            // ═══════════════════════════════════════════════════════════
            // FETCH SCHEDULED EVENTS
            // ═══════════════════════════════════════════════════════════
            let eventData: Array<{ name: string; description: string | null; scheduledStart: Date | null; location: string | null }> = [];
            try {
                const events = await guild.scheduledEvents.fetch();
                eventData = Array.from(events.values()).map(e => ({
                    name: e.name,
                    description: e.description,
                    scheduledStart: e.scheduledStartAt,
                    location: e.entityMetadata?.location || null,
                }));
            } catch (e) {
                logger.warn('Could not fetch scheduled events');
            }

            // ═══════════════════════════════════════════════════════════
            // CHECK FOR CACHED MESSAGES (< 5 days old)
            // ═══════════════════════════════════════════════════════════
            let messageData: Array<{ channelId: string; channelName: string; authorId: string; authorName: string; content: string; timestamp: Date; attachments: number; reactions: string[]; mentions: string[] }> = [];
            let usedCache = false;
            const cacheAge = MessageCache.getCacheAge(guild.id);

            const channelCategoryById = new Map<string, string>();
            for (const ch of classifiedChannels) {
                channelCategoryById.set(ch.id, ch.category);
            }

            const lowValueChannelIds = new Set(
                classifiedChannels
                    .filter(ch => ch.category === 'bot-commands' || ch.category === 'logs')
                    .map(ch => ch.id)
            );

            if (MessageCache.hasValidCache(guild.id)) {
                await updateProgress(`# 🔍 FULL SERVER SCAN\n\`\`\`\n⏱️ Elapsed: ${formatElapsed()}\n\`\`\`\n✅ **${formatNumber(channelData.length)}** channels | **${formatNumber(roleData.length)}** roles | **${formatNumber(memberData.length)}** members\n\n## 📦 LOADING FROM CACHE (${cacheAge?.toFixed(1)} days old)\n⚡ Skipping message fetch - using cached data...`);

                const cachedMessages = MessageCache.loadMessages(guild.id);
                messageData = cachedMessages.map(m => ({
                    channelId: m.channelId,
                    channelName: m.channelName,
                    authorId: m.authorId,
                    authorName: m.authorName,
                    content: m.content,
                    timestamp: m.timestamp,
                    attachments: m.attachments,
                    reactions: m.reactions ? m.reactions.split(',') : [],
                    mentions: m.mentions ? m.mentions.split(',') : [],
                }));
                usedCache = true;

                await updateProgress(`# 🔍 FULL SERVER SCAN\n\`\`\`\n⏱️ Elapsed: ${formatElapsed()}\n\`\`\`\n✅ **${formatNumber(channelData.length)}** channels | **${formatNumber(roleData.length)}** roles | **${formatNumber(memberData.length)}** members\n\n## 📦 LOADED FROM CACHE\n✅ **${formatNumber(messageData.length)}** messages loaded instantly!`);
            } else {
                // ═══════════════════════════════════════════════════════════
                // FETCH MESSAGES FROM TEXT CHANNELS - IMPROVED VERSION
                // ═══════════════════════════════════════════════════════════
                const textChannels = channels.filter(c => c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement));

                // Tracking stats
                let processedChannels = 0;
                let skippedChannels = 0;
                let errorChannels = 0;
                const channelStats: { name: string; count: number; status: string }[] = [];
                let currentChannels: string[] = [];

                // Limits for comprehensive profiling - NO TIMEOUTS, MAX SPEED
                const GLOBAL_MESSAGE_LIMIT = 1000000; // 1 million total max
                const PER_CHANNEL_LIMIT = 100000; // 100k per channel
                const PARALLEL_CHANNELS = 10; // 10 parallel fetches for max speed
                const RETRY_DELAY_MS = 10; // Minimal delay between fetches
                const PROGRESS_UPDATE_INTERVAL = 2000; // Update Discord every 2 seconds

                // Progress bar helper
                const makeProgressBar = (current: number, total: number, width: number = 20): string => {
                    const filled = Math.round((current / total) * width);
                    const empty = width - filled;
                    const percent = Math.round((current / total) * 100);
                    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
                };

                // Live progress tracking - updated in real-time during fetch
                let liveMessageCount = 0;
                let currentChannelName = '';
                let currentChannelMessages = 0;

                // Build detailed progress display
                const buildProgressDisplay = (): string => {
                    const totalChannels = accessibleChannels.length;
                    const totalMsgs = messageData.length + liveMessageCount;
                    const { rate, eta } = calcRate(totalMsgs);

                    // Top channels by message count (include live channel)
                    const liveStats = [...channelStats];
                    if (currentChannelName && currentChannelMessages > 0) {
                        liveStats.push({ name: currentChannelName + ' ⏳', count: currentChannelMessages, status: 'in-progress' });
                    }
                    const topChannels = liveStats
                        .filter(c => c.count > 0)
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 5)
                        .map(c => `  #${c.name}: ${formatNumber(c.count)}`)
                        .join('\n');

                    // Currently scanning with live count
                    const scanning = currentChannels.length > 0
                        ? `🔄 **Scanning:** ${currentChannels.map(c => c === currentChannelName ? `#${c} (${formatNumber(currentChannelMessages)})` : `#${c}`).join(', ')}`
                        : '';

                    return `# 🔍 FULL SERVER SCAN
\`\`\`
⏱️ ${formatElapsed()} elapsed
\`\`\`

## 📊 Collection Progress
| Data | Count | Status |
|------|-------|--------|
| 📂 Channels | ${formatNumber(channelData.length)} | ✅ |
| 👥 Members | ${formatNumber(memberData.length)} | ✅ |
| 🎭 Roles | ${formatNumber(roleData.length)} | ✅ |
| 💬 Messages | **${formatNumber(totalMsgs)}** | 🔄 |

## 💬 Message Fetch Progress
${makeProgressBar(processedChannels, totalChannels, 25)}

\`\`\`
📂 Channels: ${processedChannels}/${totalChannels} (${skippedChannels} no-access, ${errorChannels} errors)
⚡ Speed: ${formatNumber(rate)} msg/sec
⏳ ETA: ${eta}
\`\`\`

${scanning}

${topChannels ? `### 📈 Top Channels So Far\n\`\`\`\n${topChannels}\n\`\`\`` : ''}`;
                };

                // Real-time progress updater (runs in background)
                let progressInterval: NodeJS.Timeout | null = null;
                const startProgressUpdater = () => {
                    progressInterval = setInterval(async () => {
                        try {
                            await updateProgress(buildProgressDisplay());
                        } catch (e) {
                            // Ignore update errors - will retry next interval
                        }
                    }, PROGRESS_UPDATE_INTERVAL);
                };

                const stopProgressUpdater = () => {
                    if (progressInterval) {
                        clearInterval(progressInterval);
                        progressInterval = null;
                    }
                };

                // Helper function to fetch all messages from one channel with timeout and live progress
                const fetchChannelMessages = async (textChannel: TextChannel): Promise<{ msgs: typeof messageData; status: string }> => {
                    const channelMsgs: typeof messageData = [];

                    // Safety check for bot member
                    const botMember = guild.members.me;
                    if (!botMember) {
                        return { msgs: [], status: 'no-bot-member' };
                    }

                    const permissions = textChannel.permissionsFor(botMember);
                    if (!permissions || !permissions.has(PermissionsBitField.Flags.ViewChannel) || !permissions.has(PermissionsBitField.Flags.ReadMessageHistory)) {
                        return { msgs: [], status: 'no-permission' };
                    }

                    // Set current channel for live progress display
                    currentChannelName = textChannel.name;
                    currentChannelMessages = 0;

                    let lastMessageId: string | undefined;
                    let consecutiveErrors = 0;
                    const MAX_CONSECUTIVE_ERRORS = 5; // More retries before giving up

                    while (channelMsgs.length < PER_CHANNEL_LIMIT) {
                        // Check global limit
                        if (messageData.length + liveMessageCount >= GLOBAL_MESSAGE_LIMIT) {
                            logger.info(`Global limit reached during #${textChannel.name}`);
                            return { msgs: channelMsgs, status: `global-limit-${channelMsgs.length}` };
                        }

                        const fetchOptions: { limit: number; before?: string } = { limit: 100 };
                        if (lastMessageId) fetchOptions.before = lastMessageId;

                        try {
                            const messages = await textChannel.messages.fetch(fetchOptions);

                            if (!messages || messages.size === 0) break;

                            for (const [, msg] of messages) {
                                channelMsgs.push({
                                    channelId: textChannel.id,
                                    channelName: textChannel.name,
                                    authorId: msg.author.id,
                                    authorName: msg.author.displayName || msg.author.username,
                                    content: msg.content.substring(0, 1000),
                                    timestamp: msg.createdAt,
                                    attachments: msg.attachments.size,
                                    reactions: Array.from(msg.reactions.cache.values()).map(r => `${r.emoji.name}(${r.count})`),
                                    mentions: msg.mentions.users.map(u => u.username),
                                });
                                lastMessageId = msg.id;
                            }

                            // Update live progress counter
                            currentChannelMessages = channelMsgs.length;
                            liveMessageCount = channelMsgs.length; // This channel's contribution

                            consecutiveErrors = 0; // Reset on success
                            if (messages.size < 100) break; // No more messages

                            // Delay to avoid rate limits
                            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                        } catch (fetchError: unknown) {
                            consecutiveErrors++;
                            const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
                            logger.warn(`Fetch error in #${textChannel.name} (attempt ${consecutiveErrors}): ${errMsg}`);

                            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                                return { msgs: channelMsgs, status: `error-after-${channelMsgs.length}` };
                            }

                            // Wait longer on error
                            await new Promise(resolve => setTimeout(resolve, 1000 * consecutiveErrors));
                        }
                    }

                    // Clear current channel tracking
                    currentChannelName = '';
                    currentChannelMessages = 0;

                    return { msgs: channelMsgs, status: 'complete' };
                };

                // Get list of accessible text channels
                const accessibleChannels: TextChannel[] = [];
                for (const [, channel] of textChannels) {
                    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) continue;

                    if (lowValueChannelIds.has(channel.id)) {
                        const category = channelCategoryById.get(channel.id) || 'unknown';
                        logger.info(`[PROFILE] Skipping low-value channel #${channel.name} (${category}) from message fetch`);
                        continue;
                    }

                    accessibleChannels.push(channel as TextChannel);
                }

                // Sort channels by name for consistent ordering
                accessibleChannels.sort((a, b) => a.name.localeCompare(b.name));

                await updateProgress(buildProgressDisplay());
                logger.info(`Starting message fetch: ${accessibleChannels.length} accessible text channels`);

                // Start real-time progress updates (every 2 seconds)
                startProgressUpdater();

                // Fetch messages from channels in parallel batches
                const totalBatches = Math.ceil(accessibleChannels.length / PARALLEL_CHANNELS);
                let currentBatch = 0;

                for (let i = 0; i < accessibleChannels.length && messageData.length < GLOBAL_MESSAGE_LIMIT; i += PARALLEL_CHANNELS) {
                    currentBatch++;
                    const batch = accessibleChannels.slice(i, i + PARALLEL_CHANNELS);
                    currentChannels = batch.map(c => c.name);

                    logger.info(`[PROFILE] Starting batch ${currentBatch}/${totalBatches}: ${currentChannels.join(', ')}`);

                    // Update display to show current channels
                    await updateProgress(buildProgressDisplay());

                    const batchPromises = batch.map(async (channel) => {
                        try {
                            const result = await fetchChannelMessages(channel);
                            return { channel: channel.name, ...result };
                        } catch (error) {
                            logger.warn(`Failed to fetch messages from #${channel.name}:`, error);
                            return { channel: channel.name, msgs: [], status: 'exception' };
                        }
                    });

                    const batchResults = await Promise.all(batchPromises);
                    logger.info(`[PROFILE] Batch ${currentBatch}/${totalBatches} complete: ${messageData.length} total messages so far`);

                    for (const result of batchResults) {
                        channelStats.push({ name: result.channel, count: result.msgs.length, status: result.status });

                        // Log each channel result to the logger (not just console)
                        logger.info(`[PROFILE] #${result.channel}: ${result.msgs.length} messages (${result.status})`);

                        if (result.status === 'no-permission' || result.status === 'no-bot-member') {
                            skippedChannels++;
                        } else if (result.status === 'exception' || result.status.startsWith('error')) {
                            errorChannels++;
                        }

                        // Add messages to collection
                        const remaining = GLOBAL_MESSAGE_LIMIT - messageData.length;
                        if (result.msgs.length > 0) {
                            if (result.msgs.length > remaining) {
                                messageData.push(...result.msgs.slice(0, remaining));
                            } else {
                                messageData.push(...result.msgs);
                            }
                        }

                        // Live terminal update per channel
                        const statusIcon = result.status === 'complete' ? '✓' : result.status === 'no-permission' ? '⊘' : '✗';
                        console.log(`  ${statusIcon} #${result.channel}: ${formatNumber(result.msgs.length)} msgs (${result.status})`);
                    }

                    processedChannels += batch.length;
                    currentChannels = [];

                    // Quick batch summary to terminal
                    const { rate } = calcRate(messageData.length);
                    console.log(`  → Batch done: ${formatNumber(messageData.length)} total msgs | ${formatNumber(rate)} msg/s | ${processedChannels}/${accessibleChannels.length} channels`);

                    // Reset live counter after batch is added to main collection
                    liveMessageCount = 0;
                }

                // Stop real-time progress updates
                stopProgressUpdater();

                // Final summary with channel breakdown
                const successfulChannels = channelStats.filter(c => c.status === 'complete' && c.count > 0);
                const topFive = [...successfulChannels].sort((a, b) => b.count - a.count).slice(0, 5);

                await updateProgress(`# ✅ MESSAGE FETCH COMPLETE
\`\`\`
⏱️ ${formatElapsed()} total
\`\`\`

## 📊 Final Stats
| Metric | Value |
|--------|-------|
| 💬 Total Messages | **${formatNumber(messageData.length)}** |
| 📂 Channels Scanned | ${processedChannels} |
| ⏭️ Skipped (no access) | ${skippedChannels} |
| ❌ Errors | ${errorChannels} |

### 📈 Top 5 Channels
\`\`\`
${topFive.map((c, i) => `${i + 1}. #${c.name}: ${formatNumber(c.count)} messages`).join('\n')}
\`\`\`

💾 **Saving to cache...**`);

                MessageCache.saveMessages(guild.id, guild.name, messageData.map(m => ({
                    channelId: m.channelId,
                    channelName: m.channelName,
                    authorId: m.authorId,
                    authorName: m.authorName,
                    content: m.content,
                    timestamp: m.timestamp,
                    attachments: m.attachments,
                    reactions: m.reactions.join(','),
                    mentions: m.mentions.join(','),
                })));

                await updateProgress(`# ✅ MESSAGE FETCH COMPLETE
\`\`\`
⏱️ ${formatElapsed()} total
\`\`\`

## 📊 Final Stats  
💬 **${formatNumber(messageData.length)}** messages from **${successfulChannels.length}** channels

✅ Cache saved! Future scans will be instant.

🤖 **Starting 6-layer AI profiler...**`);
            }

            // ═══════════════════════════════════════════════════════════
            // FETCH INVITES (if we have permission)
            // ═══════════════════════════════════════════════════════════
            let inviteData: Array<{ code: string; uses: number; createdBy: string; channel: string }> = [];
            try {
                const invites = await guild.invites.fetch();
                inviteData = Array.from(invites.values()).map(i => ({
                    code: i.code,
                    uses: i.uses || 0,
                    createdBy: i.inviter?.username || 'unknown',
                    channel: i.channel?.name || 'unknown',
                }));
            } catch (e) {
                logger.warn('Could not fetch invites (missing permissions)');
            }

            // ═══════════════════════════════════════════════════════════
            // FETCH BANS (if we have permission)
            // ═══════════════════════════════════════════════════════════
            let banCount = 0;
            try {
                const bans = await guild.bans.fetch();
                banCount = bans.size;
            } catch (e) {
                logger.warn('Could not fetch bans (missing permissions)');
            }

            // ═══════════════════════════════════════════════════════════
            // COMPILE SERVER METADATA
            // ═══════════════════════════════════════════════════════════
            const serverMetadata = {
                name: guild.name,
                description: guild.description,
                icon: guild.iconURL(),
                banner: guild.bannerURL(),
                memberCount: guild.memberCount,
                createdAt: guild.createdAt,
                ownerId: guild.ownerId,
                ownerName: (await guild.fetchOwner()).displayName,
                boostLevel: guild.premiumTier,
                boostCount: guild.premiumSubscriptionCount || 0,
                verificationLevel: guild.verificationLevel,
                nsfwLevel: guild.nsfwLevel,
                vanityUrl: guild.vanityURLCode,
                features: guild.features,
            };

            await updateProgress(`# ✅ SCAN COMPLETE\n\`\`\`\n⏱️ Total Time: ${formatElapsed()}\n\`\`\`\n## 📊 Data Collected\n| Type | Count |\n|------|-------|\n| Channels | **${formatNumber(channelData.length)}** |\n| Roles | **${formatNumber(roleData.length)}** |\n| Members | **${formatNumber(memberData.length)}** |\n| Messages | **${formatNumber(messageData.length)}** |\n| Emojis | **${formatNumber(emojiData.length)}** |\n| Stickers | **${formatNumber(stickerData.length)}** |\n| Events | **${formatNumber(eventData.length)}** |\n| Invites | **${formatNumber(inviteData.length)}** |\n| Bans | **${formatNumber(banCount)}** |\n\n🤖 **Running 6-layer profiler...** (processing ALL ${formatNumber(messageData.length)} messages)`);

            // ═══════════════════════════════════════════════════════════
            // RUN 6-LAYER SERVER PROFILER (full or incremental)
            // ═══════════════════════════════════════════════════════════

            // Convert to RawMessage format
            const rawMessages: RawMessage[] = messageData.map(m => ({
                channelId: m.channelId,
                channelName: m.channelName,
                authorId: m.authorId,
                authorName: m.authorName,
                content: m.content,
                timestamp: m.timestamp,
                attachments: m.attachments,
                reactions: m.reactions,
                mentions: m.mentions,
            }));

            const profiler = new ServerProfiler();

            const existingBible = MessageCache.loadBibleSnapshot(guild.id);
            let bible;

            if (existingBible && existingBible.metadata?.dateRange?.end) {
                const lastEnd = existingBible.metadata.dateRange.end instanceof Date
                    ? existingBible.metadata.dateRange.end
                    : new Date(existingBible.metadata.dateRange.end as any);

                const newMessages = rawMessages.filter(m => m.timestamp.getTime() > lastEnd.getTime());

                if (newMessages.length === 0) {
                    logger.info(`[PROFILE] No new messages since last Server Bible for ${guild.id}, reusing existing snapshot`);
                    await updateProgress(`# ✅ 6-LAYER PROFILER SKIPPED\n\`\`\`\n⏱️ Total Time: ${formatElapsed()}\n\`\`\`\nNo new messages since last run. Reusing existing Server Bible (covering ${existingBible.metadata.messageCount.toLocaleString()} messages).`);
                    bible = existingBible;
                } else {
                    logger.info(`[PROFILE] Incremental update with ${newMessages.length} new messages for ${guild.id}`);
                    bible = await profiler.updateBibleIncremental(
                        guild.id,
                        existingBible,
                        newMessages,
                        memberData.map(m => ({
                            id: m.id,
                            displayName: m.displayName,
                            username: m.username,
                            roles: m.roles,
                        })),
                        async (status) => {
                            await updateProgress(`${status}\n\n⏱️ Elapsed: ${formatElapsed()}`);
                        }
                    );
                }
            } else {
                console.log('\n🤖 STARTING 6-LAYER AI PROFILER (full run)...');
                console.log(`   Processing ${formatNumber(rawMessages.length)} messages\n`);
                bible = await profiler.profileServer(
                    guild.id,
                    guild.name,
                    guild.description,
                    rawMessages,
                    memberData.map(m => ({
                        id: m.id,
                        displayName: m.displayName,
                        username: m.username,
                        roles: m.roles,
                    })),
                    classifiedChannels, // Pass classified channels instead of raw channelData
                    roleData.map(r => ({ id: r.id, name: r.name, memberCount: r.memberCount })),
                    async (status) => {
                        await updateProgress(`${status}\n\n⏱️ Elapsed: ${formatElapsed()}`);
                    }
                );
            }

            // Store the Server Bible in memory
            await this.memoryService.storeServerBible(guild.id, bible);

            const totalElapsed = Math.round((Date.now() - startTime) / 1000);

            // Final completion message to terminal
            console.log('\n' + '═'.repeat(60));
            console.log('🎉 SERVER BIBLE COMPLETE!');
            console.log('═'.repeat(60));
            console.log(`   ⏱️  Total time: ${totalElapsed}s`);
            console.log(`   💬  Messages processed: ${formatNumber(messageData.length)}`);
            console.log(`   👥  User profiles: ${bible.userProfiles.length}`);
            console.log(`   🗣️  Slang terms: ${Object.keys(bible.vocabulary.slangDictionary).length}`);
            console.log(`   📝  Chunks: ${bible.metadata.chunkCount}`);
            console.log('═'.repeat(60) + '\n');

            // Build result embed with Server Bible data
            const slangSample = Object.entries(bible.vocabulary.slangDictionary).slice(0, 5).map(([k, v]) => `**${k}**: ${v}`).join('\n') || 'None';
            const patternCount = bible.exampleLibrary.patterns.length;
            const userCount = bible.userProfiles.length;

            const embed = new EmbedBuilder()
                .setTitle('✅ 6-LAYER SERVER BIBLE COMPLETE!')
                .setColor(0x00ff00)
                .setThumbnail(guild.iconURL() || null)
                .setDescription(bible.coreIdentity.summary)
                .addFields(
                    {
                        name: '📊 Everything Scanned',
                        value: `• ${channelData.length} channels\n• ${roleData.length} roles\n• ${memberData.length} members\n• **${messageData.length} messages** ${usedCache ? '(from cache)' : '(fetched)'}\n• ${emojiData.length} emojis\n• ${stickerData.length} stickers`,
                        inline: true,
                    },
                    {
                        name: '🧠 Server Bible Built',
                        value: `• ${bible.metadata.chunkCount} conversation chunks\n• ${patternCount} response patterns\n• ${userCount} user profiles\n• ${Object.keys(bible.vocabulary.slangDictionary).length} slang terms\n\n⏱️ ${usedCache ? '⚡ FAST: ' : ''}${totalElapsed}s`,
                        inline: true,
                    },
                    {
                        name: '💬 Style Detected',
                        value: `**Caps:** ${bible.styleRules.capitalization}\n**Punctuation:** ${bible.styleRules.punctuation}\n**Emoji:** ${bible.styleRules.emojiUsage.frequency}\n**Swearing:** ${bible.styleRules.swearingLevel}\n**Msg Length:** ~${bible.styleRules.messageLength.typical} words`,
                    },
                    {
                        name: '🗣️ Slang Dictionary Sample',
                        value: slangSample.substring(0, 1000) || 'None detected',
                    },
                    {
                        name: '🎭 Personality Archetypes',
                        value: bible.coreIdentity.archetypes.join(', ') || 'friend, shitposter, lorekeeper, hypeman',
                    },
                    {
                        name: '⭐ Top Users Profiled',
                        value: bible.userProfiles.slice(0, 10).map(u => `**${u.displayName}**: ${u.personality}`).join('\n') || 'None',
                    },
                    {
                        name: '📜 Master Prompt Length',
                        value: `${bible.masterPrompt.length} characters\n(${bible.masterPrompt.split(' ').length} words)`,
                        inline: true,
                    },
                    {
                        name: '🎖️ Server Info',
                        value: `Owner: ${serverMetadata.ownerName}\nBoost: Lvl ${serverMetadata.boostLevel} (${serverMetadata.boostCount})\nCreated: ${serverMetadata.createdAt.toDateString()}`,
                        inline: true,
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'The bot now speaks like your server! Use /server_memory summary to view stored data.' });

            // Send final result (handle webhook timeout)
            try {
                if (useChannelMessages) {
                    // Delete the progress message and send embed to channel
                    if (lastChannelMessage !== null) {
                        await (lastChannelMessage as Message<boolean>).delete().catch(() => { });
                    }
                    const channel = interaction.channel;
                    if (channel && 'send' in channel) {
                        await channel.send({ embeds: [embed] });
                    }
                } else {
                    await interaction.editReply({ content: null, embeds: [embed] });
                }
            } catch (finalError) {
                // Last resort: send to channel
                const errMsg = finalError instanceof Error ? finalError.message : String(finalError);
                logger.warn(`Final reply failed (likely webhook expired), sending to channel: ${errMsg}`);
                const channel = interaction.channel;
                if (channel && 'send' in channel) {
                    await channel.send({ embeds: [embed] });
                }
            }

        } catch (error) {
            logger.error('Failed to profile server:', error);

            // Handle error reply with fallback
            const errorMsg = `❌ Failed to profile server: ${error instanceof Error ? error.message : 'Unknown error'}`;
            try {
                await interaction.editReply(errorMsg);
            } catch {
                const channel = interaction.channel;
                if (channel && 'send' in channel) {
                    await channel.send(errorMsg);
                }
            }
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

    /**
     * Handle /speak command - make the bot speak in voice chat
     */
    private async handleSpeak(interaction: ChatInputCommandInteraction): Promise<void> {
        // Check if TTS is enabled
        if (!interaction.guildId) {
            await interaction.reply({
                content: '❌ This command can only be used in a server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const cfg = await runtimeConfig.getGuildConfig(interaction.guildId);
        if (!cfg.ttsEnabled) {
            await interaction.reply({
                content: '❌ TTS is disabled for this server. Enable TTS in the dashboard Voice/TTS settings.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const text = interaction.options.getString('text', true);

        // Check if user is in a voice channel
        const member = interaction.member as GuildMember;
        if (!member?.voice?.channel) {
            await interaction.editReply('❌ You must be in a voice channel for me to speak!');
            return;
        }

        const voiceChannel = member.voice.channel as VoiceChannel;

        // Check if bot has an active session in this channel
        if (!this.voiceManager.isSessionActive(interaction.guildId!, voiceChannel.id)) {
            await interaction.editReply(
                `❌ I'm not in that voice channel! Use \`/voice_logger start\` to bring me to **${voiceChannel.name}** first.`
            );
            return;
        }

        try {
            const success = await this.voiceManager.speak(
                interaction.guildId!,
                voiceChannel.id,
                text
            );

            if (success) {
                await interaction.editReply(`🔊 Speaking: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
            } else {
                await interaction.editReply(
                    '❌ Failed to speak. Check the logs for details.\n' +
                    'Common issues:\n' +
                    '• TTS not enabled (`TTS_ENABLED=true` in .env)\n' +
                    '• Bot not properly connected to voice channel'
                );
            }
        } catch (error) {
            logger.error('Failed to speak:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            await interaction.editReply(`❌ Error generating speech: ${errorMsg}`);
        }
    }

    /**
     * Handle /clear_memories command - DELETE ALL memories for this server
     */
    private async handleClearMemories(interaction: ChatInputCommandInteraction): Promise<void> {
        const startTime = Date.now();
        console.log('\n' + '═'.repeat(60));
        console.log('[CLEAR_MEMORIES] Command received');
        console.log('═'.repeat(60));
        console.log(`[CLEAR_MEMORIES] User: ${interaction.user.tag}`);
        console.log(`[CLEAR_MEMORIES] Guild: ${interaction.guildId}`);
        logger.info(`clear_memories command invoked by ${interaction.user.tag}`);

        const confirmed = interaction.options.getBoolean('confirm', true);
        console.log(`[CLEAR_MEMORIES] Confirmed: ${confirmed}`);

        if (!confirmed) {
            console.log('[CLEAR_MEMORIES] ❌ Not confirmed, aborting');
            logger.warn(`clear_memories: User ${interaction.user.tag} did not confirm deletion`);
            await interaction.reply({
                content: '❌ You must set `confirm` to `true` to delete all memories. This action is **irreversible**!',
                flags: MessageFlags.Ephemeral,
            });
            console.log('═'.repeat(60) + '\n');
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        console.log('[CLEAR_MEMORIES] Reply deferred');

        const guild = interaction.guild;
        if (!guild) {
            console.log('[CLEAR_MEMORIES] ❌ No guild context');
            await interaction.editReply('This command must be used in a server!');
            console.log('═'.repeat(60) + '\n');
            return;
        }

        console.log(`[CLEAR_MEMORIES] Guild name: ${guild.name}`);
        logger.info(`clear_memories: Starting deletion for guild ${guild.name} (${guild.id})`);

        await interaction.editReply(
            `⚠️ **Clearing All Memories**\n\n` +
            `🏠 **Server:** ${guild.name}\n\n` +
            `⏳ Deleting all memories, profiles, transcripts, AI interactions, logs, and cache...\n\n` +
            `_This action is irreversible!_`
        );

        try {
            console.log('[CLEAR_MEMORIES] Calling memoryService.clearAllMemories...');
            const result = await this.memoryService.clearAllMemories(guild.id);

            const total = result.serverMemories + result.userProfiles + result.sessionSummaries +
                result.transcriptChunks + result.aiInteractions + result.activityLogs +
                result.metricsSnapshots;
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            console.log(`[CLEAR_MEMORIES] ✅ Deletion complete in ${elapsed}s`);
            console.log(`[CLEAR_MEMORIES] Deleted: ${result.serverMemories} memories, ${result.userProfiles} profiles, ` +
                `${result.sessionSummaries} summaries, ${result.transcriptChunks} transcripts, ` +
                `${result.aiInteractions} AI interactions, ${result.activityLogs} activity logs, ` +
                `${result.metricsSnapshots} metrics snapshots`);
            console.log(`[CLEAR_MEMORIES] Total: ${total} records deleted`);
            console.log('═'.repeat(60) + '\n');
            logger.info(`clear_memories: Completed in ${elapsed}s - deleted ${total} records`);

            await interaction.editReply(
                `🗑️ **All Memories Cleared!**\n\n` +
                `🏠 **Server:** ${guild.name}\n\n` +
                `📊 **Deleted:**\n` +
                `• **${result.serverMemories}** server memories\n` +
                `• **${result.userProfiles}** user profiles\n` +
                `• **${result.sessionSummaries}** session summaries\n` +
                `• **${result.transcriptChunks}** transcript chunks\n` +
                `• **${result.aiInteractions}** AI interactions\n` +
                `• **${result.activityLogs}** activity logs\n` +
                `• **${result.metricsSnapshots}** metrics snapshots\n\n` +
                `📈 **Total:** ${total} records deleted\n` +
                `🗄️ **Cache:** Message cache files cleared\n` +
                `⏱️ **Completed in:** ${elapsed}s\n\n` +
                `💡 Run \`/profile_server\` to rebuild the server profile.`
            );
        } catch (error) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`[CLEAR_MEMORIES] ❌ Error after ${elapsed}s:`, error);
            console.log('═'.repeat(60) + '\n');
            logger.error('Failed to clear memories:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            await interaction.editReply(
                `❌ **Failed to Clear Memories**\n\n` +
                `🏠 **Server:** ${guild.name}\n` +
                `⏱️ **After:** ${elapsed}s\n\n` +
                `**Error:** ${errorMsg}`
            );
        }
    }

    /**
     * Handle /feedback command - explicit user feedback on bot responses
     * Now works without learning service by storing feedback as style rules directly
     */
    private async handleFeedback(interaction: ChatInputCommandInteraction): Promise<void> {
        const startTime = Date.now();
        console.log('\n' + '═'.repeat(60));
        console.log('[FEEDBACK] Command received');
        console.log('═'.repeat(60));
        console.log(`[FEEDBACK] User: ${interaction.user.tag}`);
        console.log(`[FEEDBACK] Guild: ${interaction.guildId}`);
        logger.info(`feedback command invoked by ${interaction.user.tag}`);

        const guild = interaction.guild;
        if (!guild) {
            console.log('[FEEDBACK] ❌ No guild context');
            console.log('═'.repeat(60) + '\n');
            await interaction.reply({
                content: '❌ This command must be used in a server!',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const feedbackType = interaction.options.getString('type', true);
        const reason = interaction.options.getString('reason') || '';
        const isPositive = feedbackType === 'good';

        console.log(`[FEEDBACK] Type: ${feedbackType} (${isPositive ? 'positive' : 'negative'})`);
        console.log(`[FEEDBACK] Reason: ${reason || '(none provided)'}`);
        logger.info(`feedback: type=${feedbackType}, reason="${reason.substring(0, 50)}"`);

        // Try to find the bot's most recent message in this channel
        const channel = interaction.channel;
        if (!channel || !channel.isTextBased()) {
            console.log('[FEEDBACK] ❌ Could not access channel');
            console.log('═'.repeat(60) + '\n');
            await interaction.reply({
                content: '❌ Could not access the channel!',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        console.log(`[FEEDBACK] Channel: ${channel.id}`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        console.log('[FEEDBACK] Reply deferred');

        await interaction.editReply(
            `📝 **Processing Feedback**\n\n` +
            `${isPositive ? '👍' : '👎'} **Type:** ${isPositive ? 'Positive' : 'Negative'}\n` +
            (reason ? `💬 **Reason:** ${reason}\n\n` : '\n') +
            `⏳ Finding my last message...`
        );

        try {
            // Fetch recent messages to find the bot's last response
            console.log('[FEEDBACK] Fetching recent messages...');
            const messages = await channel.messages.fetch({ limit: 20 });
            const botMessages = messages.filter(m => m.author.id === interaction.client.user?.id);

            console.log(`[FEEDBACK] Found ${botMessages.size} bot messages in last 20`);

            if (botMessages.size === 0) {
                console.log('[FEEDBACK] ❌ No bot messages found');
                console.log('═'.repeat(60) + '\n');
                logger.warn('feedback: No bot messages found in channel');
                await interaction.editReply(
                    `❌ **No Bot Messages Found**\n\n` +
                    `I couldn't find any of my recent messages in this channel.\n\n` +
                    `Make sure you use this command in a channel where I've recently responded!`
                );
                return;
            }

            const botMessage = botMessages.first()!;
            console.log(`[FEEDBACK] Target message: "${botMessage.content.substring(0, 50)}..."`);
            console.log(`[FEEDBACK] Message ID: ${botMessage.id}`);
            logger.info(`feedback: Rating message ${botMessage.id}`);

            await interaction.editReply(
                `📝 **Processing Feedback**\n\n` +
                `${isPositive ? '👍' : '👎'} **Type:** ${isPositive ? 'Positive' : 'Negative'}\n` +
                (reason ? `💬 **Reason:** ${reason}\n\n` : '\n') +
                `📨 **Message:** "${botMessage.content.substring(0, 80)}${botMessage.content.length > 80 ? '...' : ''}"\n\n` +
                `⏳ Storing feedback as style rule...`
            );

            // Store feedback directly as a style rule (works without learning service!)
            const feedbackLabel = isPositive ? 'positive' : 'negative';
            let styleRule: string;

            if (isPositive) {
                // Positive feedback - learn to do MORE of this
                if (reason) {
                    styleRule = `GOOD RESPONSE PATTERN: "${botMessage.content.substring(0, 150)}" - User said this was good because: ${reason}. Do more responses like this.`;
                } else {
                    styleRule = `GOOD RESPONSE PATTERN: "${botMessage.content.substring(0, 150)}" - Users liked this response style.`;
                }
            } else {
                // Negative feedback - learn to AVOID this
                if (reason) {
                    styleRule = `AVOID: "${botMessage.content.substring(0, 150)}" - User feedback: ${reason}. Don't respond like this.`;
                } else {
                    styleRule = `AVOID: "${botMessage.content.substring(0, 150)}" - Users disliked this response style.`;
                }
            }

            console.log('[FEEDBACK] Storing style rule...');
            await this.memoryService.storeStyleRule(
                guild.id,
                styleRule,
                interaction.user.id
            );

            // Also use learning service if available for richer learning
            if (this.learningService) {
                console.log('[FEEDBACK] Also processing through learning service...');
                await this.learningService.processFeedbackExample(
                    guild.id,
                    channel.id,
                    botMessage.id,
                    reason ? `${botMessage.content}\n\n[USER FEEDBACK: ${reason}]` : botMessage.content,
                    isPositive,
                    interaction.user.id
                );
            }

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const emoji = isPositive ? '👍' : '👎';

            console.log(`[FEEDBACK] ✅ Feedback processed in ${elapsed}s`);
            console.log(`[FEEDBACK] Type: ${feedbackLabel}`);
            console.log('═'.repeat(60) + '\n');
            logger.info(`📝 EXPLICIT FEEDBACK: ${feedbackLabel} | user=${interaction.user.tag} | reason="${reason.substring(0, 50)}" | completed in ${elapsed}s`);

            await interaction.editReply(
                `${emoji} **Thanks for the ${feedbackLabel} feedback!**\n\n` +
                `📨 **Message rated:**\n"${botMessage.content.substring(0, 100)}${botMessage.content.length > 100 ? '...' : ''}"\n\n` +
                (reason ? `💬 **Your reason:** ${reason}\n\n` : '') +
                `✅ **Style rule saved!**\n` +
                `⏱️ **Processed in:** ${elapsed}s\n\n` +
                `✨ I'll use this to improve my responses!`
            );
        } catch (error) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`[FEEDBACK] ❌ Error after ${elapsed}s:`, error);
            console.log('═'.repeat(60) + '\n');
            logger.error('Failed to process feedback command:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            await interaction.editReply(
                `❌ **Failed to Submit Feedback**\n\n` +
                `⏱️ **After:** ${elapsed}s\n\n` +
                `**Error:** ${errorMsg}`
            );
        }
    }

    /**
     * Handle /train command - Analyze bot conversations and suggest improvements
     */
    private async handleTrain(interaction: ChatInputCommandInteraction): Promise<void> {
        const startTime = Date.now();
        console.log('\n' + '═'.repeat(60));
        console.log('[TRAIN] Command received');
        console.log('═'.repeat(60));
        console.log(`[TRAIN] User: ${interaction.user.tag}`);
        console.log(`[TRAIN] Guild: ${interaction.guildId}`);
        logger.info(`train command invoked by ${interaction.user.tag}`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channelOption = interaction.options.getChannel('channel', true);
        const limitOption = interaction.options.getInteger('limit') || 100;
        const applyFixes = interaction.options.getBoolean('apply_fixes') || false;

        console.log(`[TRAIN] Channel: ${channelOption.name} (${channelOption.id})`);
        console.log(`[TRAIN] Limit: ${limitOption}`);
        console.log(`[TRAIN] Apply fixes: ${applyFixes}`);

        if (channelOption.type !== ChannelType.GuildText && channelOption.type !== ChannelType.GuildAnnouncement) {
            await interaction.editReply('❌ Please select a text channel!');
            return;
        }

        const textChannel = channelOption as TextChannel;

        await interaction.editReply(
            `🔍 **Analyzing Bot Conversations**\n\n` +
            `📌 **Channel:** #${textChannel.name}\n` +
            `📊 **Max messages:** ${limitOption}\n\n` +
            `⏳ Fetching bot messages...`
        );

        try {
            // Fetch messages and find bot's messages
            const botId = interaction.client.user?.id;
            if (!botId) {
                await interaction.editReply('❌ Could not get bot ID');
                return;
            }

            let fetchedCount = 0;
            let lastId: string | undefined;
            const conversations: Array<{
                trigger: { author: string; content: string; timestamp: Date };
                botResponse: { content: string; timestamp: Date };
                reactions: Array<{ author: string; content: string; timestamp: Date }>;
            }> = [];

            // Fetch messages in batches
            while (fetchedCount < limitOption * 10 && conversations.length < limitOption) {
                const messages = await textChannel.messages.fetch({
                    limit: 100,
                    before: lastId,
                });

                if (!messages.size) break;

                // Find bot messages and their context
                for (const [, msg] of messages) {
                    if (msg.author.id === botId && msg.content.trim()) {
                        // This is a bot message - find what triggered it and reactions
                        const trigger = messages.find(m =>
                            m.createdTimestamp < msg.createdTimestamp &&
                            m.createdTimestamp > msg.createdTimestamp - 60000 && // Within 1 minute before
                            m.author.id !== botId
                        );

                        const reactions = Array.from(messages.values())
                            .filter(m =>
                                m.createdTimestamp > msg.createdTimestamp &&
                                m.createdTimestamp < msg.createdTimestamp + 120000 && // Within 2 minutes after
                                m.author.id !== botId
                            )
                            .map(m => ({
                                author: m.author.username,
                                content: m.content,
                                timestamp: m.createdAt,
                            }))
                            .slice(0, 3); // Max 3 reactions

                        if (trigger) {
                            conversations.push({
                                trigger: {
                                    author: trigger.author.username,
                                    content: trigger.content,
                                    timestamp: trigger.createdAt,
                                },
                                botResponse: {
                                    content: msg.content,
                                    timestamp: msg.createdAt,
                                },
                                reactions,
                            });
                        }
                    }
                    lastId = msg.id;
                    fetchedCount++;
                }

                if (messages.size < 100) break;
            }

            console.log(`[TRAIN] Found ${conversations.length} conversation pairs`);

            if (conversations.length === 0) {
                await interaction.editReply(
                    `⚠️ **No Conversations Found**\n\n` +
                    `📌 **Channel:** #${textChannel.name}\n` +
                    `📊 **Messages scanned:** ${fetchedCount}\n\n` +
                    `No bot messages with trigger context were found.`
                );
                return;
            }

            await interaction.editReply(
                `🔍 **Analyzing Bot Conversations**\n\n` +
                `📌 **Channel:** #${textChannel.name}\n` +
                `📊 **Conversations found:** ${conversations.length}\n\n` +
                `🧠 Analyzing with AI...`
            );

            // Build analysis prompt
            const conversationText = conversations.slice(0, 50).map((conv, i) => {
                const reactionText = conv.reactions.length > 0
                    ? `\nReactions: ${conv.reactions.map(r => `${r.author}: "${r.content}"`).join(', ')}`
                    : '';
                return `--- Conversation ${i + 1} ---
User ${conv.trigger.author}: "${conv.trigger.content}"
Bot: "${conv.botResponse.content}"${reactionText}`;
            }).join('\n\n');

            const analysisPrompt = `Analyze these Discord bot conversations and identify issues:

${conversationText}

Look for:
1. MALFORMED PHRASES - Words missing, broken grammar, nonsensical phrases
2. WRONG NAMES - Bot calling users by wrong names
3. REPETITION - Same phrase used too often across responses
4. POOR RESPONSES - Responses that don't match the trigger's intent
5. STYLE ISSUES - Responses that sound too robotic/AI-like
6. USER REACTIONS - If users seem confused or call out issues

For each issue found, provide:
- The exact problematic text
- What's wrong
- A suggested fix

Respond in JSON:
{
  "issues": [
    {
      "type": "malformed_phrase|wrong_name|repetition|poor_response|style_issue",
      "severity": "high|medium|low",
      "example": "exact text from conversation",
      "problem": "what's wrong",
      "suggestedFix": "how to fix it",
      "rule": "a rule to prevent this (e.g., 'never say X', 'always use user's current name')"
    }
  ],
  "summary": "overall summary of issues found",
  "positivePatterns": ["things the bot does well"]
}`;

            // Call AI for analysis
            const analysisResult = await this.aiService.analyzeConversations(analysisPrompt);

            console.log(`[TRAIN] Analysis complete`);

            // Format results
            let resultText = `✅ **Conversation Analysis Complete!**\n\n` +
                `📌 **Channel:** #${textChannel.name}\n` +
                `📊 **Conversations analyzed:** ${Math.min(conversations.length, 50)}\n\n`;

            if (analysisResult.summary) {
                resultText += `📋 **Summary:**\n${analysisResult.summary}\n\n`;
            }

            if (analysisResult.issues && analysisResult.issues.length > 0) {
                resultText += `⚠️ **Issues Found (${analysisResult.issues.length}):**\n`;
                for (const issue of analysisResult.issues.slice(0, 5)) {
                    const severityEmoji = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
                    resultText += `${severityEmoji} **${issue.type}**: ${issue.problem}\n`;
                    resultText += `   → Fix: ${issue.suggestedFix}\n`;
                }
                if (analysisResult.issues.length > 5) {
                    resultText += `   ... and ${analysisResult.issues.length - 5} more issues\n`;
                }
                resultText += '\n';
            } else {
                resultText += `✨ **No major issues found!**\n\n`;
            }

            if (analysisResult.positivePatterns && analysisResult.positivePatterns.length > 0) {
                resultText += `👍 **What's working well:**\n`;
                for (const pattern of analysisResult.positivePatterns.slice(0, 3)) {
                    resultText += `• ${pattern}\n`;
                }
                resultText += '\n';
            }

            // Apply fixes if requested
            if (applyFixes && analysisResult.issues && analysisResult.issues.length > 0) {
                const highSeverityIssues = analysisResult.issues.filter((i: { severity: string }) => i.severity === 'high');
                if (highSeverityIssues.length > 0) {
                    resultText += `🔧 **Applying ${highSeverityIssues.length} high-severity fixes...**\n`;

                    for (const issue of highSeverityIssues) {
                        if (issue.rule) {
                            await this.memoryService.storeStyleRule(
                                interaction.guildId!,
                                issue.rule,
                                interaction.user.id
                            ).catch((err: Error) => logger.warn('Failed to store style rule:', err));
                        }
                    }

                    resultText += `✅ Style rules updated!\n\n`;
                }
            }

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            resultText += `⏱️ **Completed in:** ${elapsed}s`;

            console.log(`[TRAIN] ✅ Complete in ${elapsed}s`);
            console.log('═'.repeat(60) + '\n');

            if (resultText.length <= 2000) {
                await interaction.editReply(resultText);
            } else {
                const chunks = this.splitIntoChunks(resultText, 1900);
                const [first, ...rest] = chunks;

                if (!first) {
                    await interaction.editReply(resultText.substring(0, 1900));
                    return;
                }

                await interaction.editReply(first);
                for (const chunk of rest) {
                    await interaction.followUp({
                        content: chunk,
                        flags: MessageFlags.Ephemeral,
                    });
                }
            }

        } catch (error) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`[TRAIN] ❌ Error after ${elapsed}s:`, error);
            console.log('═'.repeat(60) + '\n');
            logger.error('Failed to analyze conversations:', error);
            await interaction.editReply(
                `❌ **Analysis Failed**\n\n` +
                `⏱️ **After:** ${elapsed}s\n\n` +
                `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Handle /nickname command
     */
    private async handleNickname(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'set':
                await this.handleNicknameSet(interaction);
                break;
            case 'reset':
                await this.handleNicknameReset(interaction);
                break;
            case 'view':
                await this.handleNicknameView(interaction);
                break;
            case 'set_user':
                await this.handleNicknameSetUser(interaction);
                break;
        }
    }

    /**
     * Handle /nickname set - user sets their own nickname
     */
    private async handleNicknameSet(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const nickname = interaction.options.getString('name', true).trim();

        // Validate nickname
        if (nickname.length < 1 || nickname.length > 32) {
            await interaction.editReply('❌ Nickname must be between 1 and 32 characters.');
            return;
        }

        // Check for invalid characters (basic sanitation)
        if (/[@#:`]/.test(nickname)) {
            await interaction.editReply('❌ Nickname cannot contain @, #, :, or ` characters.');
            return;
        }

        try {
            await this.memoryService.updateUserNickname(
                interaction.guildId!,
                interaction.user.id,
                nickname,
                'user_set'
            );

            await interaction.editReply(
                `✅ **Nickname set!**\n\n` +
                `I'll call you **${nickname}** from now on.`
            );

            logger.info(`User ${interaction.user.tag} set their nickname to "${nickname}" in guild ${interaction.guildId}`);
        } catch (error) {
            logger.error('Failed to set nickname:', error);
            await interaction.editReply('❌ Failed to set nickname. Please try again.');
        }
    }

    /**
     * Handle /nickname reset - clear user's custom nickname
     */
    private async handleNicknameReset(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            await this.memoryService.updateUserNickname(
                interaction.guildId!,
                interaction.user.id,
                null,
                'user_set'
            );

            // Get what name we'll use now
            const member = interaction.member as GuildMember;
            const fallbackName = member?.nickname || member?.displayName || interaction.user.username;

            await interaction.editReply(
                `✅ **Nickname cleared!**\n\n` +
                `I'll call you **${fallbackName}** (your server name) from now on.`
            );

            logger.info(`User ${interaction.user.tag} reset their nickname in guild ${interaction.guildId}`);
        } catch (error) {
            logger.error('Failed to reset nickname:', error);
            await interaction.editReply('❌ Failed to reset nickname. Please try again.');
        }
    }

    /**
     * Handle /nickname view - view current nickname
     */
    private async handleNicknameView(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const targetUser = interaction.options.getUser('user', false) || interaction.user;

        try {
            const nickname = await this.memoryService.getUserNickname(
                interaction.guildId!,
                targetUser.id
            );

            const member = interaction.guild?.members.cache.get(targetUser.id);
            const serverNick = member?.nickname;
            const displayName = member?.displayName || targetUser.displayName || targetUser.username;

            const embed = new EmbedBuilder()
                .setTitle(`🏷️ Nickname Info: ${targetUser.username}`)
                .setColor(0x5865f2)
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    {
                        name: '📝 Preferred Nickname',
                        value: nickname || '*Not set*',
                        inline: true,
                    },
                    {
                        name: '🏠 Server Nickname',
                        value: serverNick || '*Not set*',
                        inline: true,
                    },
                    {
                        name: '🌐 Display Name',
                        value: displayName,
                        inline: true,
                    },
                    {
                        name: '✨ What I Call Them',
                        value: `**${nickname || serverNick || displayName}**`,
                        inline: false,
                    }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.error('Failed to view nickname:', error);
            await interaction.editReply('❌ Failed to get nickname info. Please try again.');
        }
    }

    /**
     * Handle /nickname set_user - admin sets another user's nickname
     */
    private async handleNicknameSetUser(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Check if user has manage nicknames permission
        const member = interaction.member as GuildMember;
        if (!member.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
            await interaction.editReply('❌ You need the **Manage Nicknames** permission to set other users\' nicknames.');
            return;
        }

        const targetUser = interaction.options.getUser('user', true);
        const nickname = interaction.options.getString('name', true).trim();

        // Validate nickname
        if (nickname.length < 1 || nickname.length > 32) {
            await interaction.editReply('❌ Nickname must be between 1 and 32 characters.');
            return;
        }

        if (/[@#:`]/.test(nickname)) {
            await interaction.editReply('❌ Nickname cannot contain @, #, :, or ` characters.');
            return;
        }

        try {
            await this.memoryService.updateUserNickname(
                interaction.guildId!,
                targetUser.id,
                nickname,
                'admin_set'
            );

            await interaction.editReply(
                `✅ **Nickname set for ${targetUser.username}!**\n\n` +
                `I'll call them **${nickname}** from now on.`
            );

            logger.info(`Admin ${interaction.user.tag} set nickname for ${targetUser.tag} to "${nickname}" in guild ${interaction.guildId}`);
        } catch (error) {
            logger.error('Failed to set user nickname:', error);
            await interaction.editReply('❌ Failed to set nickname. Please try again.');
        }
    }
}
