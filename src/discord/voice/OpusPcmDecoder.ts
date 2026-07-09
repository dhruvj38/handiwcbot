import { Readable } from 'stream';
import { opus as PrismOpus } from 'prism-media';
import { logger } from '../../utils/logger';

type DiscordOpusModule = typeof import('@discordjs/opus');

interface DecoderContext {
    sessionId: string;
    userId: string;
}

let nativeOpus: DiscordOpusModule | null | undefined;

function loadNativeOpus(): DiscordOpusModule | null {
    if (nativeOpus !== undefined) {
        return nativeOpus;
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        nativeOpus = require('@discordjs/opus') as DiscordOpusModule;
        logger.info('Using @discordjs/opus for voice decoding');
    } catch (error) {
        nativeOpus = null;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
            `@discordjs/opus native module unavailable, falling back to prism-media decoder (reason: ${message}).`
        );
    }

    return nativeOpus;
}

export function createPcmStreamFromOpus(audioStream: Readable, context: DecoderContext): Readable {
    const native = loadNativeOpus();
    if (native) {
        return createNativeDecoderStream(audioStream, context, native);
    }

    return createPrismDecoderStream(audioStream, context);
}

function createNativeDecoderStream(
    audioStream: Readable,
    context: DecoderContext,
    native: DiscordOpusModule
): Readable {
    const pcmStream = new Readable({
        read() {
            // Data is pushed imperatively from the decoder callback.
        },
    });

    const createDecoder = () => new native.OpusEncoder(48000, 2);
    let decoder = createDecoder();
    let closed = false;

    const cleanup = () => {
        if (closed) return;
        closed = true;
        audioStream.removeListener('data', onData);
        audioStream.removeListener('end', onEnd);
        audioStream.removeListener('close', onClose);
        audioStream.removeListener('error', onError);
        pcmStream.push(null);
    };

    const onData = (chunk: Buffer) => {
        if (!chunk || chunk.length === 0) {
            return;
        }

        try {
            const decoded = decoder.decode(chunk);
            if (decoded && decoded.length > 0) {
                pcmStream.push(decoded);
            }
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.warn(
                `Native Opus decoder error for user ${context.userId} in session ${context.sessionId}, recreating decoder (reason: ${errMsg}).`
            );
            decoder = createDecoder();
        }
    };

    const onEnd = () => cleanup();
    const onClose = () => cleanup();
    const onError = (error: Error) => {
        logger.warn(
            `Opus audio stream error for user ${context.userId} in session ${context.sessionId}:`,
            error
        );
        cleanup();
    };

    audioStream.on('data', onData);
    audioStream.once('end', onEnd);
    audioStream.once('close', onClose);
    audioStream.once('error', onError);

    pcmStream.once('close', cleanup);

    return pcmStream;
}

// Track which user/session combos have already logged an error to reduce spam
const loggedErrors = new Set<string>();

function createPrismDecoderStream(audioStream: Readable, context: DecoderContext): Readable {
    const decoder = new PrismOpus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
    });

    const errorKey = `${context.sessionId}:${context.userId}`;
    decoder.on('error', (error) => {
        // Only log the first error per user per session to avoid log spam
        if (!loggedErrors.has(errorKey)) {
            loggedErrors.add(errorKey);
            logger.warn(
                `Opus decoder error for user ${context.userId} in session ${context.sessionId} (further errors suppressed):`,
                error
            );
            // Clear after 60 seconds so we can log again if errors persist
            setTimeout(() => loggedErrors.delete(errorKey), 60000);
        }
        // Silently skip invalid packets - they're usually just noise or silence
    });

    audioStream.pipe(decoder);
    return decoder;
}
