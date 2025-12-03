import {
    joinVoiceChannel,
    entersState,
    VoiceConnectionStatus,
    EndBehaviorType,
    VoiceConnection,
    AudioReceiveStream,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    AudioPlayer,
    StreamType,
} from '@discordjs/voice';
import { VoiceChannel, Client, Guild, ChannelType, VoiceState } from 'discord.js';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { logger } from '../../utils/logger';
import { LocalSpeechService as SpeechService } from '../../services/speech/SpeechService';
import { TtsService } from '../../services/speech/TtsService';
import { MemoryService } from '../../services/memory/MemoryService';
import { AiService } from '../../services/ai/AiService';
import { RealtimeLearningService } from '../../services/learning/RealtimeLearningService';
import { config } from '../../config';
import { VoiceSession } from '../../types';
import { createWavBuffer, hasAudioContent, getAudioDuration } from '../../utils/audioUtils';

export class VoiceSessionManager {
    private sessions: Map<string, VoiceSession>;
    private connections: Map<string, VoiceConnection>;
    private audioBuffers: Map<string, Map<string, Buffer[]>>; // sessionId -> userId -> buffers
    private processingTimers: Map<string, NodeJS.Timeout>;
    private summaryTimers: Map<string, NodeJS.Timeout>;
    private chimeInTimers: Map<string, NodeJS.Timeout>;
    private audioPlayers: Map<string, AudioPlayer>;
    private lastChimeTime: Map<string, number>;
    private recentTranscripts: Map<string, Array<{ userId: string; text: string; timestamp: Date }>>;

    private speechService: SpeechService;
    private ttsService: TtsService;
    private memoryService: MemoryService;
    private aiService: AiService;
    private learningService: RealtimeLearningService | null = null;
    private discordClient: Client | null = null;

    constructor(
        speechService: SpeechService,
        ttsService: TtsService,
        memoryService: MemoryService,
        aiService: AiService,
        learningService?: RealtimeLearningService
    ) {
        this.sessions = new Map();
        this.connections = new Map();
        this.audioBuffers = new Map();
        this.processingTimers = new Map();
        this.summaryTimers = new Map();
        this.chimeInTimers = new Map();
        this.audioPlayers = new Map();
        this.lastChimeTime = new Map();
        this.recentTranscripts = new Map();
        this.speechService = speechService;
        this.ttsService = ttsService;
        this.memoryService = memoryService;
        this.aiService = aiService;
        this.learningService = learningService || null;

        // Ensure temp directory exists
        try {
            mkdirSync(join(process.cwd(), 'temp'), { recursive: true });
        } catch (error) {
            // Directory already exists
        }
    }

    /**
     * Set the Discord client for user lookups
     */
    setDiscordClient(client: Client): void {
        this.discordClient = client;
    }

    /**
     * Get display name for a user ID
     */
    private async getUserDisplayName(userId: string): Promise<string> {
        if (!this.discordClient) return `User ${userId}`;
        
        try {
            const user = await this.discordClient.users.fetch(userId);
            return user.displayName || user.username || `User ${userId}`;
        } catch {
            return `User ${userId}`;
        }
    }

    /**
     * Start a voice logging session
     */
    async startSession(channel: VoiceChannel): Promise<VoiceSession> {
        const sessionId = `${channel.guild.id}-${channel.id}`;

        // Check if session already exists
        if (this.sessions.has(sessionId)) {
            logger.warn(`Voice session already active for ${sessionId}`);
            return this.sessions.get(sessionId)!;
        }

        try {
            // Join voice channel - unmuted if TTS is enabled
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator as any,
                selfDeaf: false,
                selfMute: !config.tts.enabled, // Unmute if TTS enabled so we can speak
            });

            // Wait for connection to be ready
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

            const session: VoiceSession = {
                serverId: channel.guild.id,
                channelId: channel.id,
                startedAt: new Date(),
                isActive: true,
                lastSummaryAt: new Date(),
            };

            this.sessions.set(sessionId, session);
            this.connections.set(sessionId, connection);
            this.audioBuffers.set(sessionId, new Map());
            this.recentTranscripts.set(sessionId, []);

            // Setup audio player for TTS
            if (config.tts.enabled) {
                const player = createAudioPlayer();
                connection.subscribe(player);
                this.audioPlayers.set(sessionId, player);
                logger.info(`Audio player created for session ${sessionId}`);
            }

            // Setup audio receiving
            this.setupAudioReceiving(sessionId, connection);

            // Setup periodic processing
            this.setupPeriodicProcessing(sessionId);

            // Setup periodic summarization
            this.setupPeriodicSummarization(sessionId);

            // Setup chime-in logic if enabled
            if (config.tts.enabled && config.voiceChat.chimeInEnabled) {
                this.setupChimeInLogic(sessionId, channel);
            }

            logger.info(`Started voice session: ${sessionId} (TTS: ${config.tts.enabled})`);

            return session;
        } catch (error) {
            logger.error(`Failed to start voice session: ${sessionId}`, error);
            throw error;
        }
    }

    /**
     * Stop a voice logging session
     */
    async stopSession(serverId: string, channelId: string): Promise<void> {
        const sessionId = `${serverId}-${channelId}`;

        const session = this.sessions.get(sessionId);
        if (!session) {
            logger.warn(`No active voice session for ${sessionId}`);
            return;
        }

        try {
            // Process any remaining audio
            await this.processAudioBuffers(sessionId);

            // Generate final summary
            await this.generateSessionSummary(sessionId);

            // Clear timers
            const processingTimer = this.processingTimers.get(sessionId);
            if (processingTimer) {
                clearInterval(processingTimer);
                this.processingTimers.delete(sessionId);
            }

            const summaryTimer = this.summaryTimers.get(sessionId);
            if (summaryTimer) {
                clearInterval(summaryTimer);
                this.summaryTimers.delete(sessionId);
            }

            const chimeTimer = this.chimeInTimers.get(sessionId);
            if (chimeTimer) {
                clearInterval(chimeTimer);
                this.chimeInTimers.delete(sessionId);
            }

            // Clean up audio player
            const player = this.audioPlayers.get(sessionId);
            if (player) {
                player.stop();
                this.audioPlayers.delete(sessionId);
            }

            // Disconnect from voice channel
            const connection = this.connections.get(sessionId);
            if (connection) {
                connection.destroy();
                this.connections.delete(sessionId);
            }

            // Clean up
            this.audioBuffers.delete(sessionId);
            this.sessions.delete(sessionId);
            this.recentTranscripts.delete(sessionId);
            this.lastChimeTime.delete(sessionId);

            logger.info(`Stopped voice session: ${sessionId}`);
        } catch (error) {
            logger.error(`Failed to stop voice session: ${sessionId}`, error);
        }
    }

    /**
     * Setup audio receiving for a session
     */
    private setupAudioReceiving(sessionId: string, connection: VoiceConnection): void {
        const receiver = connection.receiver;

        receiver.speaking.on('start', (userId) => {
            logger.debug(`User ${userId} started speaking in ${sessionId}`);

            const audioStream = receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 1000, // 1 second of silence
                },
            });

            this.handleAudioStream(sessionId, userId, audioStream);
        });
    }

    /**
     * Handle audio stream from a user
     */
    private async handleAudioStream(
        sessionId: string,
        userId: string,
        stream: AudioReceiveStream
    ): Promise<void> {
        const buffers: Buffer[] = [];

        stream.on('data', (chunk: Buffer) => {
            buffers.push(chunk);
        });

        stream.on('end', async () => {
            if (buffers.length === 0) return;

            const audioBuffer = Buffer.concat(buffers);

            // Store in session buffers
            const sessionBuffers = this.audioBuffers.get(sessionId);
            if (sessionBuffers) {
                const userBuffers = sessionBuffers.get(userId) || [];
                userBuffers.push(audioBuffer);
                sessionBuffers.set(userId, userBuffers);
            }
        });
    }

    /**
     * Setup periodic audio processing
     */
    private setupPeriodicProcessing(sessionId: string): void {
        const timer = setInterval(async () => {
            await this.processAudioBuffers(sessionId);
        }, config.bot.voiceChunkDurationMs);

        this.processingTimers.set(sessionId, timer);
    }

    /**
     * Setup periodic summarization
     */
    private setupPeriodicSummarization(sessionId: string): void {
        const timer = setInterval(async () => {
            await this.generateSessionSummary(sessionId);
        }, config.bot.voiceSummaryIntervalMs);

        this.summaryTimers.set(sessionId, timer);
    }

    /**
     * Process audio buffers for a session
     */
    private async processAudioBuffers(sessionId: string): Promise<void> {
        const sessionBuffers = this.audioBuffers.get(sessionId);
        if (!sessionBuffers || sessionBuffers.size === 0) return;

        const session = this.sessions.get(sessionId);
        if (!session) return;

        logger.info(`Processing audio buffers for session ${sessionId}`);

        for (const [userId, buffers] of sessionBuffers.entries()) {
            if (buffers.length === 0) continue;

            try {
                // Combine all buffers for this user
                const combinedBuffer = Buffer.concat(buffers);

                // Check if there's actual audio content (not just silence)
                if (!hasAudioContent(combinedBuffer)) {
                    logger.debug(`Skipping silent audio for user ${userId}`);
                    buffers.length = 0; // Clear buffers even when skipping
                    continue;
                }

                // Check minimum duration (at least 0.3 seconds)
                const duration = getAudioDuration(combinedBuffer);
                if (duration < 0.3) {
                    logger.debug(`Skipping short audio (${duration.toFixed(2)}s) for user ${userId}`);
                    buffers.length = 0; // Clear buffers even when skipping
                    continue;
                }

                // Convert PCM to WAV format for Groq API
                const wavBuffer = createWavBuffer(combinedBuffer);

                // Transcribe audio
                const startedAt = new Date(Date.now() - config.bot.voiceChunkDurationMs);
                const endedAt = new Date();

                const transcription = await this.speechService.transcribe(wavBuffer, 'wav');

                if (transcription.text && transcription.text.trim().length > 0) {
                    // Store transcript chunk
                    await this.memoryService.storeTranscriptChunk({
                        serverId: session.serverId,
                        channelId: session.channelId,
                        userId,
                        startedAt,
                        endedAt,
                        rawText: transcription.text,
                        metadata: {
                            confidence: transcription.confidence,
                        },
                    });

                    logger.info(`Stored transcript for user ${userId}: ${transcription.text.substring(0, 50)}...`);

                    // Also store in recent transcripts for chime-in logic
                    this.storeRecentTranscript(sessionId, userId, transcription.text);

                    // Feed to learning service for personality building
                    if (this.learningService) {
                        const userName = await this.getUserDisplayName(userId);
                        this.learningService.processVoiceTranscript(
                            session.serverId,
                            userId,
                            userName,
                            transcription.text
                        ).catch(err => {
                            logger.warn('Learning service error on voice transcript:', err);
                        });
                    }

                    // If the bot was mentioned in this chunk, respond immediately in VC
                    if (config.tts.enabled && config.voiceChat.chimeInEnabled && this.mentionsBot(transcription.text)) {
                        try {
                            const recent = this.recentTranscripts.get(sessionId) || [];
                            const conversationText = recent
                                .slice(-10)
                                .map(t => `${t.userId}: ${t.text}`)
                                .join('\n');

                            const shouldChime = await this.shouldChimeInToConversation(
                                session.serverId,
                                conversationText || transcription.text,
                                true
                            );

                            if (shouldChime.response) {
                                await this.speak(session.serverId, session.channelId, shouldChime.response);
                                this.lastChimeTime.set(sessionId, Date.now());
                            }
                        } catch (error) {
                            logger.error('Error responding to immediate voice mention:', error);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Failed to process audio for user ${userId}:`, error);
            }

            // Clear processed buffers
            buffers.length = 0;
        }
    }

    /**
     * Generate session summary
     */
    private async generateSessionSummary(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        logger.info(`Generating session summary for ${sessionId}`);

        try {
            // Get transcript chunks since last summary
            const chunks = await this.memoryService.getTranscriptChunksForProcessing(
                session.serverId,
                session.channelId,
                session.lastSummaryAt
            );

            if (chunks.length === 0) {
                logger.info('No new transcript chunks to summarize');
                return;
            }

            // Process transcripts and update memories
            await this.memoryService.processTranscripts(session.serverId, session.channelId, chunks);

            // Update last summary time
            session.lastSummaryAt = new Date();

            logger.info(`Generated session summary with ${chunks.length} transcript chunks`);
        } catch (error) {
            logger.error('Failed to generate session summary:', error);
        }
    }

    /**
     * Get active session
     */
    getSession(serverId: string, channelId: string): VoiceSession | undefined {
        const sessionId = `${serverId}-${channelId}`;
        return this.sessions.get(sessionId);
    }

    /**
     * Check if session is active
     */
    isSessionActive(serverId: string, channelId: string): boolean {
        return this.sessions.has(`${serverId}-${channelId}`);
    }

    /**
     * Setup the chime-in logic that periodically checks if the bot should speak
     */
    private setupChimeInLogic(sessionId: string, channel: VoiceChannel): void {
        // Check every 10 seconds if we should chime in
        const timer = setInterval(async () => {
            await this.evaluateChimeIn(sessionId, channel);
        }, 10000);

        this.chimeInTimers.set(sessionId, timer);
        logger.info(`Chime-in logic setup for session ${sessionId}`);
    }

    // Bot name variations for detecting when someone mentions the bot
    private readonly BOT_NAME_PATTERNS = [
        'handi', 'handiwc', 'handi wc', 'mr handi', 'mr. handi', 'mrhandi',
        'mr handi wc', 'mr. handi wc', 'mrhandiwc', 'the bot', 'hey bot'
    ];

    /**
     * Check if text contains a reference to the bot
     */
    private mentionsBot(text: string): boolean {
        const lower = text.toLowerCase();
        return this.BOT_NAME_PATTERNS.some(name => lower.includes(name));
    }

    /**
     * Evaluate whether to chime in based on recent conversation
     */
    private async evaluateChimeIn(sessionId: string, channel: VoiceChannel): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        // Get recent transcripts
        const lastChime = this.lastChimeTime.get(sessionId) || 0;
        let transcripts = this.recentTranscripts.get(sessionId) || [];

        // Only consider transcripts since the last time we spoke to avoid duplicate reactions
        if (lastChime) {
            transcripts = transcripts.filter(t => t.timestamp.getTime() > lastChime);
        }

        if (transcripts.length < 1) {
            return; // No conversation yet
        }

        // Check if player is already playing
        const player = this.audioPlayers.get(sessionId);
        if (player && player.state.status === AudioPlayerStatus.Playing) {
            return;
        }

        // Build conversation context from recent transcripts
        const conversationText = transcripts
            .slice(-10) // Last 10 utterances
            .map(t => `${t.userId}: ${t.text}`)
            .join('\n');

        // Check if someone mentioned the bot - if so, ALWAYS respond (no cooldown, no random chance)
        const recentText = transcripts.slice(-3).map(t => t.text).join(' ');
        const wasMentioned = this.mentionsBot(recentText);

        if (wasMentioned) {
            logger.info('Bot was mentioned in VC - responding!');
            try {
                const shouldChime = await this.shouldChimeInToConversation(
                    session.serverId,
                    conversationText,
                    true // force response
                );

                if (shouldChime.response) {
                    await this.speakInVoice(sessionId, shouldChime.response, channel);
                    this.lastChimeTime.set(sessionId, Date.now());
                }
            } catch (error) {
                logger.error('Error responding to mention:', error);
            }
            return;
        }

        // For random chime-ins, check cooldown
        const now = Date.now();
        if (now - lastChime < config.voiceChat.minSecondsBetweenChimes * 1000) {
            return;
        }

        // Need at least 2 transcripts for random chime-in
        if (transcripts.length < 2) {
            return;
        }

        // Roll for chime-in chance
        if (Math.random() > config.voiceChat.chimeInChance) {
            return;
        }

        try {
            // Check if the conversation is interesting enough to chime in
            const shouldChime = await this.shouldChimeInToConversation(
                session.serverId,
                conversationText,
                false
            );

            if (shouldChime.chimeIn) {
                logger.info(`Chiming into VC conversation: ${shouldChime.reason}`);
                await this.speakInVoice(sessionId, shouldChime.response, channel);
                this.lastChimeTime.set(sessionId, now);
            }
        } catch (error) {
            logger.error('Error evaluating chime-in:', error);
        }
    }

    /**
     * Ask AI if we should chime into this conversation
     * @param forceResponse - If true, always generate a response (someone mentioned the bot)
     */
    private async shouldChimeInToConversation(
        serverId: string,
        conversationText: string,
        forceResponse: boolean = false
    ): Promise<{ chimeIn: boolean; reason: string; response: string }> {
        try {
            // Get server memories for context
            const memories = await this.memoryService.retrieveMemoriesForChat(
                serverId,
                conversationText,
                []
            );

            // Different instructions based on whether we're forced to respond
            const instructions = forceResponse
                ? `Someone just mentioned you (Mr. Handi WC) in voice chat! You MUST respond.
                
The conversation:
${conversationText}

Rules:
- They said your name, so respond directly to what they said
- If they asked a question, answer it
- If they were talking about you, react to it (playfully defensive, sassy, or funny)
- Keep it SHORT - 1-2 sentences max for voice
- Be natural, like a friend in the call
- Sound like you overheard them mention you
- SPEAK IN AAVE (African American Vernacular English) - use slang like "finna", "bet", "no cap", "lowkey", "bruh", "ayo", "deadass", "ion" (I don't), "tryna", "ngl" etc. Be authentic and natural with it.

Just respond with what you'd say (no explanation, just the words).`
                : `You're listening to a voice chat conversation. Decide if you should chime in.
                
The conversation:
${conversationText}

Rules for chiming in:
- Chime in fairly often - you're part of the crew, not a wallflower
- If there's an inside joke you know, you can reference it
- If they're wrong about something, you can correct them playfully
- If there's a natural pause/lull, you can make a comment
- React to interesting things people say
- Keep it SHORT - 1-2 sentences max for voice
- Be natural, like a friend in the call
- SPEAK IN AAVE (African American Vernacular English) - use slang like "finna", "bet", "no cap", "lowkey", "bruh", "ayo", "deadass", "ion" (I don't), "tryna", "ngl" etc. Be authentic and natural with it.

If you should NOT chime in, respond with exactly: NO_CHIME
If you SHOULD chime in, just respond with what you'd say (no explanation, just the words).`;

            const context = {
                serverId,
                channelId: 'voice',
                userMessage: conversationText,
                userId: 'voice-conversation',
                userName: 'Voice Chat',
                recentMessages: [],
                serverMemories: memories.serverMemories,
                userProfiles: memories.userProfiles,
                sessionSummaries: memories.sessionSummaries,
                instructions,
            };

            const response = await this.aiService.generateChatResponse(context);

            // If forced, always return the response (unless it's literally empty)
            if (forceResponse) {
                const truncated = response.substring(0, config.voiceChat.maxResponseLength);
                return {
                    chimeIn: true,
                    reason: 'Bot was mentioned',
                    response: truncated || "yo what's up",
                };
            }

            if (response.trim().toUpperCase() === 'NO_CHIME' || response.length < 3) {
                return { chimeIn: false, reason: 'Nothing relevant to add', response: '' };
            }

            // Truncate if too long for voice
            const truncated = response.substring(0, config.voiceChat.maxResponseLength);

            return {
                chimeIn: true,
                reason: 'Found something relevant to say',
                response: truncated,
            };
        } catch (error) {
            logger.error('Error checking if should chime in:', error);
            return { chimeIn: false, reason: 'Error', response: '' };
        }
    }

    /**
     * Speak text in voice channel
     * @returns true if audio was played successfully, false otherwise
     */
    async speakInVoice(sessionId: string, text: string, _channel: VoiceChannel): Promise<boolean> {
        const player = this.audioPlayers.get(sessionId);
        const connection = this.connections.get(sessionId);

        if (!player) {
            logger.error(`Cannot speak: no audio player for session ${sessionId}. Was TTS enabled when the voice session started?`);
            return false;
        }

        if (!connection) {
            logger.error(`Cannot speak: no voice connection for session ${sessionId}`);
            return false;
        }

        // Ensure player is subscribed to the connection
        connection.subscribe(player);

        try {
            logger.info(`Speaking in VC: "${text.substring(0, 50)}..."`);

            // Generate TTS audio
            const ttsResult = await this.ttsService.synthesize(text);
            
            if (!ttsResult.audioBuffer || ttsResult.audioBuffer.length === 0) {
                logger.error('TTS returned empty audio buffer');
                return false;
            }

            logger.info(`TTS generated ${ttsResult.audioBuffer.length} bytes of audio`);

            // Create a readable stream from the buffer
            const audioStream = Readable.from(ttsResult.audioBuffer);

            // Create audio resource - using mp3 format from ElevenLabs
            // StreamType.Arbitrary will let FFmpeg detect and decode the mp3 format
            const resource = createAudioResource(audioStream, {
                inputType: StreamType.Arbitrary,
            });

            // Play the audio
            player.play(resource);
            logger.info('Audio player started playing');

            // Wait for audio to finish
            await new Promise<void>((resolve, reject) => {
                const cleanup = () => {
                    player.off(AudioPlayerStatus.Idle, onIdle);
                    player.off('error', onError);
                };

                const onIdle = () => {
                    cleanup();
                    resolve();
                };

                const onError = (error: Error) => {
                    cleanup();
                    reject(error);
                };

                player.once(AudioPlayerStatus.Idle, onIdle);
                player.once('error', onError);

                // Timeout after 30 seconds max
                setTimeout(() => {
                    cleanup();
                    resolve();
                }, 30000);
            });

            logger.info('Finished speaking in VC');
            return true;
        } catch (error) {
            logger.error('Error speaking in voice:', error);
            return false;
        }
    }

    /**
     * Manually trigger the bot to speak (for testing or commands)
     */
    async speak(serverId: string, channelId: string, text: string): Promise<boolean> {
        const sessionId = `${serverId}-${channelId}`;
        const session = this.sessions.get(sessionId);

        if (!session) {
            logger.warn(`Cannot speak: no active session for ${sessionId}`);
            return false;
        }

        // Check if audio player exists (TTS must have been enabled when session started)
        const player = this.audioPlayers.get(sessionId);
        if (!player) {
            // Try to create the audio player now if TTS is enabled
            if (config.tts.enabled) {
                const connection = this.connections.get(sessionId);
                if (connection) {
                    const newPlayer = createAudioPlayer();
                    connection.subscribe(newPlayer);
                    this.audioPlayers.set(sessionId, newPlayer);
                    logger.info(`Created audio player for existing session ${sessionId}`);
                } else {
                    logger.error(`Cannot speak: no voice connection for ${sessionId}`);
                    return false;
                }
            } else {
                logger.error('Cannot speak: TTS is disabled in config');
                return false;
            }
        }

        const channel = this.discordClient?.channels.cache.get(channelId) as VoiceChannel;
        if (!channel) {
            logger.warn(`Cannot speak: channel not found ${channelId}`);
            return false;
        }

        return await this.speakInVoice(sessionId, text, channel);
    }

    /**
     * Store transcript in recent transcripts buffer (called after transcription)
     */
    storeRecentTranscript(sessionId: string, userId: string, text: string): void {
        const transcripts = this.recentTranscripts.get(sessionId) || [];
        
        transcripts.push({
            userId,
            text,
            timestamp: new Date(),
        });

        // Keep only last 20 transcripts
        while (transcripts.length > 20) {
            transcripts.shift();
        }

        this.recentTranscripts.set(sessionId, transcripts);
    }

    // ==================== AUTO-JOIN FUNCTIONALITY ====================

    private autoJoinEnabled = false;
    private autoJoinCheckInterval: NodeJS.Timeout | null = null;
    private minMembersToJoin = 2; // Minimum non-bot members to auto-join

    /**
     * Enable auto-join mode - bot will automatically join the most popular VC
     */
    enableAutoJoin(): void {
        if (this.autoJoinEnabled) {
            logger.info('Auto-join already enabled');
            return;
        }

        this.autoJoinEnabled = true;
        logger.info('Auto-join enabled - bot will automatically join popular VCs');

        // Check immediately
        this.checkAndJoinPopularVC();

        // Then check every 30 seconds
        this.autoJoinCheckInterval = setInterval(() => {
            this.checkAndJoinPopularVC();
        }, 30000);
    }

    /**
     * Disable auto-join mode
     */
    disableAutoJoin(): void {
        this.autoJoinEnabled = false;
        
        if (this.autoJoinCheckInterval) {
            clearInterval(this.autoJoinCheckInterval);
            this.autoJoinCheckInterval = null;
        }
        
        logger.info('Auto-join disabled');
    }

    /**
     * Check all guilds and join the most popular VC if not already in one
     */
    private async checkAndJoinPopularVC(): Promise<void> {
        if (!this.discordClient) {
            logger.warn('Cannot auto-join: Discord client not set');
            return;
        }

        try {
            // Get all guilds the bot is in
            const guilds = this.discordClient.guilds.cache;

            for (const [guildId, guild] of guilds) {
                await this.checkAndJoinGuildVC(guildId, guild);
            }
        } catch (error) {
            logger.error('Error in auto-join check:', error);
        }
    }

    /**
     * Check a specific guild and join the most popular VC
     */
    private async checkAndJoinGuildVC(guildId: string, guild: Guild): Promise<void> {
        // Check if we're already in a VC in this guild
        const existingSession = Array.from(this.sessions.values())
            .find(s => s.serverId === guildId && s.isActive);

        if (existingSession) {
            // Already in a VC - check if we should move to a more popular one
            const currentChannel = this.discordClient?.channels.cache.get(existingSession.channelId) as VoiceChannel | undefined;
            const currentMembers = currentChannel?.members.filter(m => !m.user.bot).size || 0;

            // If current VC is empty (just us), find a better one
            if (currentMembers === 0) {
                const popularVC = this.findMostPopularVC(guild);
                if (popularVC && popularVC.id !== existingSession.channelId) {
                    logger.info(`Moving from empty VC to ${popularVC.name} (${popularVC.members.filter(m => !m.user.bot).size} members)`);
                    await this.stopSession(guildId, existingSession.channelId);
                    await this.startSession(popularVC);
                }
            }
            return;
        }

        // Not in a VC - find the most popular one
        const popularVC = this.findMostPopularVC(guild);
        
        if (popularVC) {
            const memberCount = popularVC.members.filter(m => !m.user.bot).size;
            logger.info(`Auto-joining ${popularVC.name} in ${guild.name} (${memberCount} members)`);
            
            try {
                await this.startSession(popularVC);
                logger.info(`Successfully auto-joined ${popularVC.name}`);
            } catch (error) {
                logger.error(`Failed to auto-join ${popularVC.name}:`, error);
            }
        }
    }

    /**
     * Find the most popular (most members) voice channel in a guild
     */
    findMostPopularVC(guild: Guild): VoiceChannel | null {
        const voiceChannels = guild.channels.cache
            .filter((channel): channel is VoiceChannel => 
                channel.type === ChannelType.GuildVoice
            );

        let mostPopular: VoiceChannel | null = null;
        let maxMembers = 0;

        for (const [, channel] of voiceChannels) {
            // Count non-bot members
            const memberCount = channel.members.filter(m => !m.user.bot).size;
            
            if (memberCount >= this.minMembersToJoin && memberCount > maxMembers) {
                maxMembers = memberCount;
                mostPopular = channel;
            }
        }

        return mostPopular;
    }

    /**
     * Handle voice state update - follow users when they move
     */
    async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
        if (!this.autoJoinEnabled) return;
        if (!newState.guild) return;

        const guildId = newState.guild.id;
        const existingSession = Array.from(this.sessions.values())
            .find(s => s.serverId === guildId && s.isActive);

        // If someone joined a VC and we're not in one, check if we should join
        if (newState.channel && !oldState.channel) {
            if (!existingSession) {
                const memberCount = newState.channel.members.filter(m => !m.user.bot).size;
                if (memberCount >= this.minMembersToJoin && newState.channel.type === ChannelType.GuildVoice) {
                    logger.info(`User joined ${newState.channel.name}, auto-joining...`);
                    try {
                        await this.startSession(newState.channel as VoiceChannel);
                    } catch (error) {
                        logger.error('Failed to auto-join on voice state update:', error);
                    }
                }
            }
        }

        // If we're in a VC and everyone left, leave too
        if (existingSession && oldState.channel?.id === existingSession.channelId) {
            const channel = this.discordClient?.channels.cache.get(existingSession.channelId) as VoiceChannel | undefined;
            const remainingMembers = channel?.members.filter(m => !m.user.bot).size || 0;
            
            if (remainingMembers === 0) {
                logger.info(`Everyone left ${channel?.name}, leaving VC...`);
                await this.stopSession(guildId, existingSession.channelId);
                
                // Check if there's another active VC to join
                setTimeout(() => {
                    this.checkAndJoinGuildVC(guildId, newState.guild!);
                }, 2000);
            }
        }

        // If users moved to a different VC and more people are there now, follow them
        if (existingSession && newState.channel && newState.channel.id !== existingSession.channelId) {
            const currentChannel = this.discordClient?.channels.cache.get(existingSession.channelId) as VoiceChannel | undefined;
            const currentMembers = currentChannel?.members.filter(m => !m.user.bot).size || 0;
            const newChannelMembers = newState.channel.members.filter(m => !m.user.bot).size;

            // If the new channel has more people, move there
            if (newChannelMembers > currentMembers && newChannelMembers >= this.minMembersToJoin) {
                logger.info(`More people in ${newState.channel.name} (${newChannelMembers}) than current VC (${currentMembers}), moving...`);
                await this.stopSession(guildId, existingSession.channelId);
                
                if (newState.channel.type === ChannelType.GuildVoice) {
                    try {
                        await this.startSession(newState.channel as VoiceChannel);
                    } catch (error) {
                        logger.error('Failed to move to new VC:', error);
                    }
                }
            }
        }
    }

    /**
     * Get auto-join status
     */
    isAutoJoinEnabled(): boolean {
        return this.autoJoinEnabled;
    }
}
