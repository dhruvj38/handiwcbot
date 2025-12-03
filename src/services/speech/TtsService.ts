import { config } from '../../config';
import { logger } from '../../utils/logger';
import { retryWithBackoff } from '../../utils/helpers';

export interface TtsResult {
    audioBuffer: Buffer;
    format: 'mp3' | 'opus' | 'pcm';
}

interface GoogleTtsRequest {
    input: { text: string };
    voice: {
        languageCode: string;
        name: string;
        ssmlGender: string;
    };
    audioConfig: {
        audioEncoding: string;
        speakingRate: number;
        pitch: number;
    };
}

interface GoogleTtsResponse {
    audioContent: string; // base64 encoded
}

/**
 * Text-to-Speech service using Google Cloud TTS
 * Free tier: 4 million characters/month for Neural2 voices
 */
export class TtsService {
    private apiKey: string;
    private voiceName: string;
    private languageCode: string;
    private speakingRate: number;
    private pitch: number;

    constructor() {
        this.apiKey = config.tts.apiKey;
        this.voiceName = config.tts.voiceName;
        this.languageCode = config.tts.languageCode;
        this.speakingRate = config.tts.speakingRate;
        this.pitch = config.tts.pitch;

        logger.info('TtsService initialized (Google Cloud TTS)', {
            voiceName: this.voiceName,
            languageCode: this.languageCode,
        });
    }

    /**
     * Convert text to speech audio using Google Cloud TTS
     */
    async synthesize(text: string): Promise<TtsResult> {
        try {
            // Skip empty or very short text
            if (!text || text.trim().length < 2) {
                throw new Error('Text too short for synthesis');
            }

            const result = await retryWithBackoff(
                async () => {
                    const requestBody: GoogleTtsRequest = {
                        input: { text: text },
                        voice: {
                            languageCode: this.languageCode,
                            name: this.voiceName,
                            ssmlGender: 'MALE',
                        },
                        audioConfig: {
                            audioEncoding: 'MP3',
                            speakingRate: this.speakingRate,
                            pitch: this.pitch,
                        },
                    };

                    const response = await fetch(
                        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(requestBody),
                        }
                    );

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`TTS API error: ${response.status} - ${errorText}`);
                    }

                    const data = await response.json() as GoogleTtsResponse;
                    return Buffer.from(data.audioContent, 'base64');
                },
                { maxRetries: 2 },
                'tts-synthesize'
            );

            return {
                audioBuffer: result,
                format: 'mp3',
            };
        } catch (error) {
            logger.error('Failed to synthesize speech:', error);
            throw error;
        }
    }

    /**
     * Synthesize with streaming - Google Cloud TTS doesn't support streaming,
     * so we fall back to regular synthesis and return as a stream
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
            logger.error('Failed to stream TTS:', error);
            throw error;
        }
    }

    /**
     * Check if the TTS service is available
     */
    async healthCheck(): Promise<boolean> {
        try {
            // Test with minimal text
            const response = await fetch(
                `https://texttospeech.googleapis.com/v1/voices?key=${this.apiKey}`,
                {
                    method: 'GET',
                    signal: AbortSignal.timeout(5000),
                }
            );
            return response.ok;
        } catch (error) {
            logger.warn('TTS service health check failed:', error);
            return false;
        }
    }

    /**
     * Get available voices from Google Cloud TTS
     */
    async getVoices(): Promise<Array<{ voice_id: string; name: string }>> {
        try {
            const response = await fetch(
                `https://texttospeech.googleapis.com/v1/voices?key=${this.apiKey}`,
                { method: 'GET' }
            );

            if (!response.ok) {
                throw new Error(`Failed to get voices: ${response.status}`);
            }

            interface GoogleVoice {
                name: string;
                languageCodes: string[];
                ssmlGender: string;
            }
            const data = await response.json() as { voices: GoogleVoice[] };
            return data.voices.map((v) => ({
                voice_id: v.name,
                name: `${v.name} (${v.ssmlGender})`,
            }));
        } catch (error) {
            logger.error('Failed to get voices:', error);
            return [];
        }
    }
}
