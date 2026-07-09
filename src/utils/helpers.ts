import { logger } from './logger';

export interface RetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryableErrors?: string[];
}

const defaultRetryOptions: RetryOptions = {
    maxRetries: 3,
    baseDelayMs: 500,  // Reduced from 1000ms for faster recovery
    maxDelayMs: 5000,  // Reduced from 10000ms
};

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // Add 10% jitter
    return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown, retryableErrors?: string[]): boolean {
    if (!retryableErrors) {
        // Default retryable conditions
        if (error instanceof Error) {
            const anyErr = error as any;
            const message = error.message.toLowerCase();
            const causeMessage =
                typeof anyErr?.cause?.message === 'string'
                    ? (anyErr.cause.message as string).toLowerCase()
                    : '';
            const combined = `${message} ${causeMessage}`;

            return (
                error.name === 'AbortError' ||
                combined.includes('aborted') ||
                combined.includes('timeout') ||
                combined.includes('network') ||
                combined.includes('econnreset') ||
                combined.includes('enotfound') ||
                combined.includes('rate limit') ||
                combined.includes('503') ||
                combined.includes('502') ||
                combined.includes('429') ||
                anyErr?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT'
            );
        }
        return false;
    }

    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return retryableErrors.some((pattern) => message.includes(pattern.toLowerCase()));
    }
    return false;
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {},
    context: string = 'operation'
): Promise<T> {
    const opts = { ...defaultRetryOptions, ...options };
    let lastError: unknown;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Don't retry on last attempt
            if (attempt === opts.maxRetries) {
                break;
            }

            // Check if error is retryable
            if (!isRetryableError(error, opts.retryableErrors)) {
                logger.error(`Non-retryable error in ${context}:`, error);
                throw error;
            }

            const delay = calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
            // Extract concise error info
            const errorMsg = formatErrorShort(error);
            logger.warn(
                `${context} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}). Retrying in ${delay.toFixed(0)}ms...`,
                { error: errorMsg }
            );

            await sleep(delay);
        }
    }

    logger.error(`${context} failed after ${opts.maxRetries + 1} attempts`);
    throw lastError;
}

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength: number, suffix: string = '...'): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Chunk an array into smaller arrays
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Format error for concise logging (avoid dumping full API responses)
 */
export function formatErrorShort(error: unknown): { message: string; status?: number; name?: string } {
    if (error instanceof Error) {
        const anyErr = error as any;
        const status = anyErr.status || anyErr.code || anyErr.statusCode;
        // Extract just the main message, not the full JSON dump
        let msg = error.message;
        // If message contains JSON, extract the core message
        if (msg.includes('"message":')) {
            const match = msg.match(/"message":\s*"([^"]+)"/);
            if (match && match[1]) {
                msg = match[1].split('\\n')[0] ?? match[1]; // First line only
            }
        }
        // Truncate long messages
        if (msg.length > 100) {
            msg = msg.substring(0, 100) + '...';
        }
        return { message: msg, status, name: error.name };
    }
    return { message: String(error).substring(0, 100) };
}

/**
 * Format a date relative to now
 */
export function formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMinutes > 0) return `${diffMinutes}m ago`;
    return `${diffSeconds}s ago`;
}
