import { logger } from './logger';

export interface RetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryableErrors?: string[];
}

const defaultRetryOptions: RetryOptions = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
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
            const message = error.message.toLowerCase();
            return (
                message.includes('timeout') ||
                message.includes('network') ||
                message.includes('econnreset') ||
                message.includes('enotfound') ||
                message.includes('rate limit') ||
                message.includes('503') ||
                message.includes('502') ||
                message.includes('429')
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
            logger.warn(
                `${context} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}). Retrying in ${delay}ms...`,
                error
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
