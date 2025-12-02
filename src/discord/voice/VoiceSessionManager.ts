import {
    joinVoiceChannel,
    entersState,
    VoiceConnectionStatus,
    EndBehaviorType,
    VoiceConnection,
    AudioReceiveStream,
} from '@discordjs/voice';
import { VoiceChannel } from 'discord.js';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../../utils/logger';
import { LocalSpeechService as SpeechService } from '../../services/speech/SpeechService';
import { MemoryService } from '../../services/memory/MemoryService';
import { config } from '../../config';
import { VoiceSession } from '../../types';

export class VoiceSessionManager {
    private sessions: Map<string, VoiceSession>;
    private connections: Map<string, VoiceConnection>;
    private audioBuffers: Map<string, Map<string, Buffer[]>>; // sessionId -> userId -> buffers
    private processingTimers: Map<string, NodeJS.Timeout>;
    private summaryTimers: Map<string, NodeJS.Timeout>;

    private speechService: SpeechService;
    private memoryService: MemoryService;

    constructor(speechService: SpeechService, memoryService: MemoryService) {
        this.sessions = new Map();
        this.connections = new Map();
        this.audioBuffers = new Map();
        this.processingTimers = new Map();
        this.summaryTimers = new Map();
        this.speechService = speechService;
        this.memoryService = memoryService;

        // Ensure temp directory exists
        try {
            mkdirSync(join(process.cwd(), 'temp'), { recursive: true });
        } catch (error) {
            // Directory already exists
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
            // Join voice channel
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator as any,
                selfDeaf: false,
                selfMute: true, // Bot is muted, only listening
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

            // Setup audio receiving
            this.setupAudioReceiving(sessionId, connection);

            // Setup periodic processing
            this.setupPeriodicProcessing(sessionId);

            // Setup periodic summarization
            this.setupPeriodicSummarization(sessionId);

            logger.info(`Started voice session: ${sessionId}`);

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

            // Disconnect from voice channel
            const connection = this.connections.get(sessionId);
            if (connection) {
                connection.destroy();
                this.connections.delete(sessionId);
            }

            // Clean up
            this.audioBuffers.delete(sessionId);
            this.sessions.delete(sessionId);

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

                // Transcribe audio
                const startedAt = new Date(Date.now() - config.bot.voiceChunkDurationMs);
                const endedAt = new Date();

                const transcription = await this.speechService.transcribe(combinedBuffer, 'opus');

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
}
