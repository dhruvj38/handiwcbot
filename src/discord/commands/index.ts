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

    new SlashCommandBuilder()
        .setName('profile_server')
        .setDescription('Build COMPLETE profiles by parsing ALL server data - no limits')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('scan')
                .setDescription('Run full server profile scan (uses cache if available)')
                .addBooleanOption((option) =>
                    option
                        .setName('force')
                        .setDescription('Force fresh scan, ignoring cached data')
                        .setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('recheck_messages')
                .setDescription('Delete cache and re-scan all messages from scratch')
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('status')
                .setDescription('View current profile status and cache info')
        ),

    new SlashCommandBuilder()
        .setName('speak')
        .setDescription('Make the bot speak in voice chat (requires TTS enabled)')
        .addStringOption((option) =>
            option
                .setName('text')
                .setDescription('What to say in voice chat')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('gif_train')

        .setDescription('Train GIF usage from a text channel')
        .addChannelOption((option) =>
            option
                .setName('channel')
                .setDescription('Text channel to train from')
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName('limit')
                .setDescription('Max messages to scan (default 5000)')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('clear_memories')
        .setDescription('⚠️ DELETE ALL memories, profiles, and transcripts for this server')
        .addBooleanOption((option) =>
            option
                .setName('confirm')
                .setDescription('Set to true to confirm deletion (this is irreversible!)')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('Give feedback on the bot\'s last response (reply to the bot\'s message)')
        .addStringOption((option) =>
            option
                .setName('type')
                .setDescription('Was the response good or bad?')
                .setRequired(true)
                .addChoices(
                    { name: '👍 Good response', value: 'good' },
                    { name: '👎 Bad response', value: 'bad' }
                )
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Optional: explain what was wrong/right about the response')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('train')
        .setDescription('Analyze bot conversations to find issues and suggest improvements')
        .addChannelOption((option) =>
            option
                .setName('channel')
                .setDescription('Text channel to analyze conversations from')
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName('limit')
                .setDescription('Max bot messages to analyze (default 100)')
                .setRequired(false)
        )
        .addBooleanOption((option) =>
            option
                .setName('apply_fixes')
                .setDescription('Automatically apply suggested fixes to personality')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('nickname')
        .setDescription('Set what the bot calls you')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('set')
                .setDescription('Set your preferred nickname')
                .addStringOption((option) =>
                    option
                        .setName('name')
                        .setDescription('What you want to be called (1-32 characters)')
                        .setRequired(true)
                        .setMaxLength(32)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('reset')
                .setDescription('Clear your nickname (bot will use your server name)')
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('view')
                .setDescription('View nickname info for yourself or another user')
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription('User to view (defaults to you)')
                        .setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('set_user')
                .setDescription('(Admin) Set nickname for another user')
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription('User to set nickname for')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('name')
                        .setDescription('Nickname to set (1-32 characters)')
                        .setRequired(true)
                        .setMaxLength(32)
                )
        ),
].map((command) => command.toJSON());
