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
 * Local speech service using self-hosted Whisper server
 */
export class LocalSpeechService {
    private serviceUrl: string;

    constructor() {
        this.serviceUrl = config.speech.serviceUrl;
        logger.info(`Local speech service configured at: ${this.serviceUrl}`);
    }

    /**
     * Transcribe audio buffer to text using local Whisper server
     */
    async transcribe(audioBuffer: Buffer, format: string = 'opus'): Promise<TranscriptionResult> {
        try {
            const result = await retryWithBackoff(
                async () => {
                    // Create form data for multipart upload
                    const formData = new FormData();

                    // Convert buffer to blob
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

                    // Normalize the text if configured
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
            logger.error('Failed to transcribe audio with local Whisper:', error);
            return { text: '', confidence: 0 };
        }
    }

    /**
     * Check if the local speech service is available
     */
    async healthCheck(): Promise<boolean> {
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
