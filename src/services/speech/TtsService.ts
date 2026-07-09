import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { retryWithBackoff, formatErrorShort } from '../../utils/helpers';
import { EventEmitter } from 'events';
import { runtimeConfig } from '../RuntimeConfigManager';

export interface TtsResult {
    audioBuffer: Buffer;
    format: 'mp3' | 'opus' | 'pcm';
    characterCount?: number;
    requestId?: string;
}

export interface TtsUsageStats {
    totalCharacters: number;
    totalRequests: number;
    sessionCharacters: number;
    sessionRequests: number;
    lastRequestCharacters: number;
    lastRequestId: string | null;
    estimatedCostUsd: number;
}

// ElevenLabs pricing: ~$0.30 per 1000 characters for standard voices
const COST_PER_1000_CHARS = 0.30;

/**
 * Text-to-Speech service using ElevenLabs API
 * Provides high-quality, natural-sounding voices with usage tracking
 */
export class TtsService extends EventEmitter {
    private client: ElevenLabsClient;
    private model: string;
    private voiceId: string;
    
    // Usage tracking
    private sessionCharacters = 0;
    private sessionRequests = 0;
    private lastRequestCharacters = 0;
    private lastRequestId: string | null = null;

    constructor() {
        super();
        this.client = new ElevenLabsClient({
            apiKey: config.tts.apiKey,
        });
        this.model = config.tts.model;
        this.voiceId = config.tts.voiceId;

        logger.info('TtsService initialized (ElevenLabs)', {
            model: this.model,
            voiceId: this.voiceId,
        });
    }

    /**
     * Convert text to speech audio using ElevenLabs with cost tracking
     */
    async synthesize(text: string, guildId?: string): Promise<TtsResult> {
        try {
            // Skip empty or very short text
            if (!text || text.trim().length < 2) {
                throw new Error('Text too short for synthesis');
            }

            const startTime = Date.now();
            let voiceId = this.voiceId;
            let modelId = this.model;

            // Resolve per-guild TTS settings when guildId is provided
            if (guildId) {
                try {
                    const cfg = await runtimeConfig.getGuildConfig(guildId);

                    if (!cfg.ttsEnabled) {
                        throw new Error('TTS is disabled for this guild');
                    }

                    if (cfg.ttsVoice) {
                        voiceId = cfg.ttsVoice;
                    }

                    if (cfg.ttsModel) {
                        modelId = cfg.ttsModel;
                    }
                } catch (error) {
                    logger.warn(
                        `[TTS] Failed to load runtime TTS config for guild ${guildId}, using static defaults: ${formatErrorShort(error)}`
                    );
                }
            }
            
            const result = await retryWithBackoff(
                async () => {
                    // Use withRawResponse to get headers with character count
                    const { data, rawResponse } = await this.client.textToSpeech
                        .convert(voiceId, {
                            text: text,
                            modelId,
                            outputFormat: 'mp3_44100_128',
                        })
                        .withRawResponse();

                    // Extract usage info from headers
                    const characterCount = parseInt(rawResponse.headers.get('x-character-count') || '0', 10) || text.length;
                    const requestId = rawResponse.headers.get('request-id') || null;

                    // The SDK returns a ReadableStream, convert to Buffer
                    const reader = data.getReader();
                    const chunks: Uint8Array[] = [];
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) chunks.push(value);
                    }
                    
                    return {
                        buffer: Buffer.concat(chunks),
                        characterCount,
                        requestId,
                    };
                },
                { maxRetries: 1, baseDelayMs: 300 },
                'tts-synthesize'
            );

            const latencyMs = Date.now() - startTime;

            // Update usage stats
            this.sessionCharacters += result.characterCount;
            this.sessionRequests += 1;
            this.lastRequestCharacters = result.characterCount;
            this.lastRequestId = result.requestId;

            // Emit usage event for real-time tracking
            this.emit('usage', {
                characterCount: result.characterCount,
                requestId: result.requestId,
                latencyMs,
                textLength: text.length,
            });

            logger.info(`TTS audio generated: ${result.buffer.length} bytes, ${result.characterCount} chars, ${latencyMs}ms`, {
                requestId: result.requestId,
                characterCount: result.characterCount,
            });

            return {
                audioBuffer: result.buffer,
                format: 'mp3',
                characterCount: result.characterCount,
                requestId: result.requestId ?? undefined,
            };
        } catch (error) {
            logger.error('TTS failed:', formatErrorShort(error));
            throw error;
        }
    }

    /**
     * Get current usage statistics
     */
    getUsageStats(): TtsUsageStats {
        return {
            totalCharacters: this.sessionCharacters,
            totalRequests: this.sessionRequests,
            sessionCharacters: this.sessionCharacters,
            sessionRequests: this.sessionRequests,
            lastRequestCharacters: this.lastRequestCharacters,
            lastRequestId: this.lastRequestId,
            estimatedCostUsd: (this.sessionCharacters / 1000) * COST_PER_1000_CHARS,
        };
    }

    /**
     * Get subscription/usage info from ElevenLabs API
     */
    async getSubscriptionInfo(): Promise<{
        characterCount: number;
        characterLimit: number;
        tier: string;
        canExtendCharacterLimit: boolean;
        nextCharacterCountResetUnix: number;
    } | null> {
        try {
            const user = await this.client.user.get();
            const subscription = user.subscription;
            return {
                characterCount: subscription?.characterCount ?? 0,
                characterLimit: subscription?.characterLimit ?? 0,
                tier: subscription?.tier ?? 'free',
                canExtendCharacterLimit: subscription?.canExtendCharacterLimit ?? false,
                nextCharacterCountResetUnix: subscription?.nextCharacterCountResetUnix ?? 0,
            };
        } catch (error) {
            // Silently ignore user_read permission errors - non-critical
            const errStr = String(error);
            if (!errStr.includes('user_read')) {
                logger.error('Failed to get ElevenLabs subscription info:', formatErrorShort(error));
            }
            return null;
        }
    }

    /**
     * Reset session usage counters
     */
    resetSessionStats(): void {
        this.sessionCharacters = 0;
        this.sessionRequests = 0;
        logger.info('TTS session stats reset');
    }

    /**
     * Synthesize with streaming - returns audio as a stream
     */
    async synthesizeStream(text: string): Promise<ReadableStream<Uint8Array>> {
        try {
            const result = await this.synthesize(text);
            // Convert buffer to ReadableStream
            return new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array(result.audioBuffer));
                    controller.close();
                },
            });
        } catch (error) {
            logger.error('Failed to stream TTS:', formatErrorShort(error));
            throw error;
        }
    }

    /**
     * Check if the TTS service is available
     */
    async healthCheck(): Promise<boolean> {
        try {
            // Test with minimal text
            await this.synthesize('Test');
            return true;
        } catch (error) {
            logger.warn('TTS health check failed:', formatErrorShort(error));
            return false;
        }
    }

    /**
     * Get available voices from ElevenLabs
     */
    async getVoices(): Promise<Array<{ voice_id: string; name: string }>> {
        try {
            const response = await this.client.voices.getAll();
            return response.voices.map(voice => ({
                voice_id: voice.voiceId,
                name: voice.name || voice.voiceId,
            }));
        } catch (error) {
            logger.error('Failed to get voices:', formatErrorShort(error));
            // Return some popular default voices as fallback
            return [
                { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George (Male, Deep)' },
                { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Female, Clear)' },
                { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Female, Warm)' },
                { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Male, Friendly)' },
                { voice_id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (Female, Expressive)' },
            ];
        }
    }
}

// Singleton instance for API access
let ttsServiceInstance: TtsService | null = null;

/**
 * Get the TTS service singleton instance
 */
export function getTtsService(): TtsService | null {
    return ttsServiceInstance;
}

/**
 * Set the TTS service singleton instance (called during initialization)
 */
export function setTtsService(service: TtsService): void {
    ttsServiceInstance = service;
}
