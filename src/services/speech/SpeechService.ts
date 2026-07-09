import { config } from '../../config';
import { logger } from '../../utils/logger';
import { retryWithBackoff } from '../../utils/helpers';
import { TranscriptionResult } from '../../types';

/**
 * Normalize transcript text by removing excessive repetition and optional fillers
 */
export function normalizeTranscriptText(text: string): string {
    if (!text || text.trim().length === 0) {
        return '';
    }

    let normalized = text.trim();

    // Filter known Whisper hallucinations (common on silence/low-energy audio)
    const hallucinationPatterns = [
        /^thank you\.?$/i,
        /^thanks\.?$/i,
        /^thanks for watching\.?$/i,
        /^see you in the next video\.?$/i,
        /^bye\.?$/i,
        /^goodbye\.?$/i,
        /^please subscribe\.?$/i,
        /^like and subscribe\.?$/i,
        /^i'll see you\.?$/i,
        /^mm-hmm\.?$/i,
        /^uh-huh\.?$/i,
        /^hahaha\.?$/i,
        /^pfft\.?$/i,
        /^so\.?$/i,
    ];

    for (const pattern of hallucinationPatterns) {
        if (pattern.test(normalized)) {
            return '';
        }
    }

    // Collapse repeated words (more than 3 in a row)
    // Example: "yo yo yo yo yo" → "yo yo yo"
    normalized = normalized.replace(/\b(\w+)(\s+\1){3,}\b/gi, (_, word) => {
        return `${word} ${word} ${word}`;
    });

    // Collapse repeated phrases (2-4 words repeated more than twice)
    // Example: "I'm so back I'm so back I'm so back" → "I'm so back"
    normalized = normalized.replace(/\b((?:\w+\s+){1,4}\w+)(?:\s+\1){2,}\b/gi, '$1');

    // Optional: Remove common filler words (can be disabled if it harms meaning)
    // This is conservative and only removes standalone fillers
    if (config.speech.normalizeText) {
        const fillers = ['uh', 'um', 'uhm', 'er', 'ah'];
        const fillerPattern = new RegExp(
            `\\b(${fillers.join('|')})\\b`,
            'gi'
        );
        // Only remove if surrounded by spaces (not part of words)
        normalized = normalized.replace(fillerPattern, ' ');
    }

    // Clean up extra whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();

    // Final check: if result is too short or just noise, return empty
    if (normalized.length < 2 || /^[.\s,!?-]+$/.test(normalized)) {
        return '';
    }

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
    private consecutiveLocalFailures = 0;
    private localDisabledUntil: number | null = null;

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
        const MAX_FAILURES = 3;
        const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

        if (this.localDisabledUntil && Date.now() < this.localDisabledUntil) {
            return { text: '', confidence: 0 };
        }

        try {
            // Calculate timeout based on audio size
            // WAV: 48kHz * 2 channels * 2 bytes = 192,000 bytes/sec
            // Allow ~2x realtime for CPU transcription + 30s buffer
            const audioDurationSec = audioBuffer.length / 192000;
            const timeoutMs = Math.round(
                Math.max(60000, Math.min(300000, audioDurationSec * 2000 + 30000))
            );
            logger.info(`Whisper timeout set to ${Math.round(timeoutMs / 1000)}s for ${Math.round(audioDurationSec)}s audio`);

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

            this.consecutiveLocalFailures = 0;
            this.localDisabledUntil = null;

            return result;
        } catch (error) {
            this.consecutiveLocalFailures += 1;

            if (this.consecutiveLocalFailures >= MAX_FAILURES) {
                if (!this.localDisabledUntil || Date.now() >= this.localDisabledUntil) {
                    this.localDisabledUntil = Date.now() + COOLDOWN_MS;
                    logger.warn(
                        `Local Whisper unreachable after ${this.consecutiveLocalFailures} attempts, disabling for ${Math.round(
                            COOLDOWN_MS / 1000
                        )}s`
                    );
                }
            }

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
