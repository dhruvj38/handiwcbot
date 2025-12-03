import { config } from '../../config';
import { logger } from '../../utils/logger';
import { retryWithBackoff } from '../../utils/helpers';
import { TranscriptionResult } from '../../types';

/**
 * Normalize transcript text by removing excessive repetition and optional fillers
 */
export function normalizeTranscriptText(text: string): string {
    if (!config.speech.normalizeText) {
        return text;
    }

    let normalized = text;

    // Collapse repeated words (more than 3 in a row)
    // Example: "yo yo yo yo yo" → "yo yo yo"
    normalized = normalized.replace(/\b(\w+)(\s+\1){3,}\b/gi, (_, word) => {
        return `${word} ${word} ${word}`;
    });

    // Optional: Remove common filler words (can be disabled if it harms meaning)
    // This is conservative and only removes standalone fillers
    const fillers = ['uh', 'um', 'uhm', 'er', 'ah', 'like'];
    const fillerPattern = new RegExp(
        `\\b(${fillers.join('|')})\\b`,
        'gi'
    );

    // Only remove if surrounded by spaces (not part of words)
    normalized = normalized.replace(fillerPattern, ' ');

    // Clean up extra whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
}

/**
 * Speech service supporting multiple STT providers
 * - groq: Groq's free Whisper API (recommended - fast and free)
 * - local: Self-hosted Whisper server
 */
export class LocalSpeechService {
    private provider: 'local' | 'groq';
    private serviceUrl: string;
    private groqApiKey: string;

    constructor() {
        this.provider = config.speech.provider;
        this.serviceUrl = config.speech.serviceUrl;
        this.groqApiKey = config.speech.groqApiKey;

        if (this.provider === 'groq') {
            if (!this.groqApiKey) {
                logger.warn('GROQ_API_KEY not set! Get a free key at https://console.groq.com');
            } else {
                logger.info('Speech service using Groq Whisper API (free & fast)');
            }
        } else {
            logger.info(`Speech service using local Whisper at: ${this.serviceUrl}`);
        }
    }

    /**
     * Transcribe audio buffer to text
     */
    async transcribe(audioBuffer: Buffer, format: string = 'opus'): Promise<TranscriptionResult> {
        if (this.provider === 'groq') {
            return this.transcribeWithGroq(audioBuffer, format);
        } else {
            return this.transcribeWithLocal(audioBuffer, format);
        }
    }

    /**
     * Transcribe using Groq's free Whisper API
     */
    private async transcribeWithGroq(audioBuffer: Buffer, format: string): Promise<TranscriptionResult> {
        if (!this.groqApiKey) {
            logger.error('Cannot transcribe: GROQ_API_KEY not set');
            return { text: '', confidence: 0 };
        }

        try {
            const result = await retryWithBackoff(
                async () => {
                    const formData = new FormData();
                    
                    // Map format to proper MIME type
                    const mimeTypes: Record<string, string> = {
                        'wav': 'audio/wav',
                        'mp3': 'audio/mpeg',
                        'opus': 'audio/opus',
                        'ogg': 'audio/ogg',
                        'webm': 'audio/webm',
                        'flac': 'audio/flac',
                    };
                    const mimeType = mimeTypes[format] || `audio/${format}`;
                    
                    // Groq expects the file with a proper extension
                    const blob = new Blob([audioBuffer], { type: mimeType });
                    formData.append('file', blob, `audio.${format}`);
                    formData.append('model', 'whisper-large-v3-turbo'); // Fast turbo model
                    formData.append('response_format', 'json');

                    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.groqApiKey}`,
                        },
                        body: formData,
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Groq API error: ${response.status} - ${errorText}`);
                    }

                    const data = await response.json() as { text: string };
                    const normalizedText = normalizeTranscriptText(data.text);

                    return {
                        text: normalizedText,
                        confidence: 0.95, // Groq doesn't return confidence, assume high
                    };
                },
                { maxRetries: 2 },
                'groq-transcribe'
            );

            return result;
        } catch (error) {
            logger.error('Failed to transcribe with Groq:', error);
            return { text: '', confidence: 0 };
        }
    }

    /**
     * Transcribe using local Whisper server
     */
    private async transcribeWithLocal(audioBuffer: Buffer, format: string): Promise<TranscriptionResult> {
        try {
            const result = await retryWithBackoff(
                async () => {
                    const formData = new FormData();
                    const blob = new Blob([audioBuffer], { type: `audio/${format}` });
                    formData.append('file', blob, `audio.${format}`);
                    formData.append('response_format', 'verbose_json');

                    const response = await fetch(this.serviceUrl, {
                        method: 'POST',
                        body: formData,
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const data = await response.json() as { text: string; confidence?: number };
                    const normalizedText = normalizeTranscriptText(data.text);

                    return {
                        text: normalizedText,
                        confidence: data.confidence,
                    };
                },
                { maxRetries: 2 },
                'local-transcribe'
            );

            return result;
        } catch (error) {
            logger.error('Failed to transcribe with local Whisper:', error);
            return { text: '', confidence: 0 };
        }
    }

    /**
     * Check if the speech service is available
     */
    async healthCheck(): Promise<boolean> {
        if (this.provider === 'groq') {
            return !!this.groqApiKey;
        }

        try {
            const response = await fetch(this.serviceUrl.replace('/transcribe', '/health'), {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        } catch (error) {
            logger.warn('Local speech service health check failed:', error);
            return false;
        }
    }
}
