import { ChatInputCommandInteraction, ChannelType, VoiceChannel, TextChannel, EmbedBuilder, MessageFlags, OAuth2Scopes, PermissionsBitField, GuildMember, Message } from 'discord.js';
import { config } from '../../config';
import { VoiceSessionManager } from '../voice/VoiceSessionManager';
import { MemoryService } from '../../services/memory/MemoryService';
import { ServerProfiler, RawMessage, MessageCache } from '../../services/profiler';
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
                case 'profile_server':
                    await this.handleProfileServer(interaction);
                    break;
                case 'speak':
                    await this.handleSpeak(interaction);
                    break;
                case 'train_vc':
                    await this.handleTrainVc(interaction);
                    break;
                case 'clear_memories':
                    await this.handleClearMemories(interaction);
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

    private async handleTrainVc(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channel = interaction.options.getChannel('channel', true);
        const fromStr = interaction.options.getString('from', true);
        const toStr = interaction.options.getString('to', false) || 'now';

        if (channel.type !== ChannelType.GuildVoice) {
            await interaction.editReply('Please select a voice channel!');
            return;
        }

        try {
            const fromDate = parseRelativeTime(fromStr);
            const toDate = parseRelativeTime(toStr);

            const transcripts = await this.memoryService.getTranscriptsByChannel(
                interaction.guildId!,
                channel.id,
                fromDate,
                toDate
            );

            if (transcripts.length === 0) {
                await interaction.editReply(`No voice transcripts found for ${channel.name} in the specified time range.`);
                return;
            }

            await this.memoryService.processTranscripts(
                interaction.guildId!,
                channel.id,
                transcripts
            );

            await interaction.editReply(
                `✅ Trained personality from ${transcripts.length} transcript chunks in **${channel.name}**.\n` +
                'This updated server memories and user profiles based on that voice chat.'
            );
        } catch (error) {
            logger.error('Failed to train from voice channel:', error);
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
     * Handle /profile_server command - parse ALL server data with NO LIMITS
     */
    private async handleProfileServer(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply('This command must be used in a server!');
            return;
        }

        // Check for force option to skip cache
        const forceRefresh = interaction.options.getBoolean('force') || false;
        if (forceRefresh) {
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
            const WEBHOOK_TIMEOUT_MS = 12 * 60 * 1000; // 12 minutes (webhook expires at 15)
            
            const updateProgress = async (status: string) => {
                try {
                    // Check if webhook has likely expired
                    if (Date.now() - startTime > WEBHOOK_TIMEOUT_MS && !useChannelMessages) {
                        useChannelMessages = true;
                        logger.info('Switching to channel messages due to webhook timeout');
                        
                        // Send initial channel message
                        const channel = interaction.channel;
                        if (channel && 'send' in channel) {
                            lastChannelMessage = await channel.send(`📊 **Profile Server Progress** (continuing...)\n${status}`);
                        }
                        return;
                    }
                    
                    if (useChannelMessages) {
                        // Edit the channel message instead
                        if (lastChannelMessage) {
                            try {
                                await lastChannelMessage.edit(`📊 **Profile Server Progress**\n${status}`);
                            } catch {
                                // If edit fails, send a new message
                                const channel = interaction.channel;
                                if (channel && 'send' in channel) {
                                    lastChannelMessage = await channel.send(`📊 **Profile Server Progress**\n${status}`);
                                }
                            }
                        }
                    } else {
                        await interaction.editReply(status);
                    }
                } catch (e) {
                    // If webhook fails, switch to channel messages
                    if (!useChannelMessages) {
                        useChannelMessages = true;
                        logger.warn('Webhook failed, switching to channel messages');
                        const channel = interaction.channel;
                        if (channel && 'send' in channel) {
                            lastChannelMessage = await channel.send(`📊 **Profile Server Progress** (webhook expired)\n${status}`);
                        }
                    }
                }
            };

            await updateProgress(`# 🔍 FULL SERVER SCAN\n\`\`\`\n⏱️ Elapsed: ${formatElapsed()}\n\`\`\`\n📋 Fetching ALL channels...`);

            // ═══════════════════════════════════════════════════════════
            // FETCH ALL CHANNELS (text, voice, categories, forums, etc.)
            // ═══════════════════════════════════════════════════════════
            const channels = await guild.channels.fetch();
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

            await updateProgress(`# 🔍 FULL SERVER SCAN\n\`\`\`\n⏱️ Elapsed: ${formatElapsed()}\n\`\`\`\n✅ **${formatNumber(channelData.length)}** channels\n📋 Fetching ALL roles...`);

            // ═══════════════════════════════════════════════════════════
            // FETCH ALL ROLES
            // ═══════════════════════════════════════════════════════════
            const roles = await guild.roles.fetch();
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
            const members = await guild.members.fetch();
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
            const emojis = await guild.emojis.fetch();
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
                
                // GENEROUS limits for comprehensive profiling
                const GLOBAL_MESSAGE_LIMIT = 500000; // 500k max (increased from 200k)
                const PER_CHANNEL_LIMIT = 100000; // 100k per channel (increased from 50k)
                const PARALLEL_CHANNELS = 5; // Reduced for more stability
                const RETRY_DELAY_MS = 100; // Delay between fetches to avoid rate limits

                // Progress bar helper
                const makeProgressBar = (current: number, total: number, width: number = 20): string => {
                    const filled = Math.round((current / total) * width);
                    const empty = width - filled;
                    const percent = Math.round((current / total) * 100);
                    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
                };

                // Build detailed progress display
                const buildProgressDisplay = (): string => {
                    const totalChannels = accessibleChannels.length;
                    const { rate, eta } = calcRate(messageData.length);
                    
                    // Top channels by message count
                    const topChannels = [...channelStats]
                        .filter(c => c.count > 0)
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 5)
                        .map(c => `  #${c.name}: ${formatNumber(c.count)}`)
                        .join('\n');
                    
                    // Currently scanning
                    const scanning = currentChannels.length > 0 
                        ? `🔄 Scanning: ${currentChannels.map(c => `#${c}`).join(', ')}`
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
| 💬 Messages | **${formatNumber(messageData.length)}** | 🔄 |

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

                // Helper function to fetch all messages from one channel (NO TIMEOUT - let it complete)
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

                    let lastMessageId: string | undefined;
                    let consecutiveErrors = 0;
                    const MAX_CONSECUTIVE_ERRORS = 3;

                    while (channelMsgs.length < PER_CHANNEL_LIMIT) {
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

                    return { msgs: channelMsgs, status: 'complete' };
                };

                // Get list of accessible text channels
                const accessibleChannels: TextChannel[] = [];
                for (const [, channel] of textChannels) {
                    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) continue;
                    accessibleChannels.push(channel as TextChannel);
                }

                // Sort channels by name for consistent ordering
                accessibleChannels.sort((a, b) => a.name.localeCompare(b.name));

                await updateProgress(buildProgressDisplay());
                logger.info(`Starting message fetch: ${accessibleChannels.length} accessible text channels`);
                
                // Fetch messages from channels in parallel batches
                for (let i = 0; i < accessibleChannels.length && messageData.length < GLOBAL_MESSAGE_LIMIT; i += PARALLEL_CHANNELS) {
                    const batch = accessibleChannels.slice(i, i + PARALLEL_CHANNELS);
                    currentChannels = batch.map(c => c.name);
                    
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
                    
                    for (const result of batchResults) {
                        channelStats.push({ name: result.channel, count: result.msgs.length, status: result.status });
                        
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
                    }

                    processedChannels += batch.length;
                    currentChannels = [];
                    
                    // Update progress after each batch
                    await updateProgress(buildProgressDisplay());
                }

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
            // RUN 6-LAYER SERVER PROFILER (processes ALL messages)
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

            // Run the 6-layer profiler
            const profiler = new ServerProfiler();
            const bible = await profiler.profileServer(
                guild.name,
                guild.description,
                rawMessages,
                memberData.map(m => ({
                    id: m.id,
                    displayName: m.displayName,
                    username: m.username,
                    roles: m.roles,
                })),
                channelData,
                roleData.map(r => ({ id: r.id, name: r.name, memberCount: r.memberCount })),
                async (status) => {
                    await updateProgress(`${status}\n\n⏱️ Elapsed: ${formatElapsed()}`);
                }
            );

            // Store the Server Bible in memory
            await this.memoryService.storeServerBible(guild.id, bible);

            const totalElapsed = Math.round((Date.now() - startTime) / 1000);

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
                        await (lastChannelMessage as Message<boolean>).delete().catch(() => {});
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
        if (!config.tts.enabled) {
            await interaction.reply({
                content: '❌ TTS is not enabled! Set `TTS_ENABLED=true` in your .env file and add your ElevenLabs API key.',
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
                    '• Invalid ElevenLabs API key\n' +
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
        const confirmed = interaction.options.getBoolean('confirm', true);

        if (!confirmed) {
            await interaction.reply({
                content: '❌ You must set `confirm` to `true` to delete all memories. This action is **irreversible**!',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply('This command must be used in a server!');
            return;
        }

        try {
            const result = await this.memoryService.clearAllMemories(guild.id);

            const total = result.serverMemories + result.userProfiles + result.sessionSummaries + result.transcriptChunks;

            await interaction.editReply(
                `🗑️ **All memories cleared for ${guild.name}!**\n\n` +
                `Deleted:\n` +
                `• **${result.serverMemories}** server memories\n` +
                `• **${result.userProfiles}** user profiles\n` +
                `• **${result.sessionSummaries}** session summaries\n` +
                `• **${result.transcriptChunks}** transcript chunks\n\n` +
                `**Total: ${total} records deleted**\n\n` +
                `Run \`/profile_server\` to rebuild the server profile.`
            );
        } catch (error) {
            logger.error('Failed to clear memories:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            await interaction.editReply(`❌ Failed to clear memories: ${errorMsg}`);
        }
    }
}
