import { SlashCommandBuilder } from 'discord.js';

export const commands = [
    new SlashCommandBuilder()
        .setName('voice_logger')
        .setDescription('Control voice logging')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('start')
                .setDescription('Start logging voice chat in a channel')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Voice channel to log')
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('stop')
                .setDescription('Stop logging voice chat')
        ),

    new SlashCommandBuilder()
        .setName('server_memory')
        .setDescription('View and search server memories')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('summary')
                .setDescription('Show a summary of server memories')
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('user')
                .setDescription('Show user profile from memory')
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription('User to view profile for')
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('search')
                .setDescription('Search server memories')
                .addStringOption((option) =>
                    option
                        .setName('query')
                        .setDescription('Search query')
                        .setRequired(true)
                )
        ),

    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Access full word-for-word transcript logs')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('window')
                .setDescription('Get transcripts from a time window')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Channel to get logs from')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('from')
                        .setDescription('Start time (ISO format or relative like "1h ago")')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('to')
                        .setDescription('End time (ISO format or relative like "now")')
                        .setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('user')
                .setDescription('Get transcripts for a specific user')
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription('User to get logs for')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('from')
                        .setDescription('Start time (ISO format or relative like "1h ago")')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('to')
                        .setDescription('End time (ISO format or relative like "now")')
                        .setRequired(false)
                )
        ),
].map((command) => command.toJSON());
