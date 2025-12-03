/**
 * Audio utility functions for format conversion
 */

/**
 * Creates a WAV header for PCM audio data
 * Discord voice sends: 48kHz, 16-bit, stereo PCM
 */
export function createWavBuffer(pcmBuffer: Buffer): Buffer {
    const sampleRate = 48000;
    const numChannels = 2; // Stereo
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmBuffer.length;

    // WAV header is 44 bytes
    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4); // File size - 8
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
}

/**
 * Check if a buffer has valid audio data (not just silence)
 * Returns true if the audio contains non-silent content
 */
export function hasAudioContent(pcmBuffer: Buffer, threshold: number = 500): boolean {
    if (pcmBuffer.length < 100) return false;

    // Sample some values to check for audio content
    // PCM 16-bit values range from -32768 to 32767
    let maxAmplitude = 0;
    const step = Math.max(2, Math.floor(pcmBuffer.length / 1000)); // Sample ~1000 points

    for (let i = 0; i < pcmBuffer.length - 1; i += step) {
        const sample = pcmBuffer.readInt16LE(i);
        const amplitude = Math.abs(sample);
        if (amplitude > maxAmplitude) {
            maxAmplitude = amplitude;
        }
    }

    return maxAmplitude > threshold;
}

/**
 * Get audio duration in seconds from PCM buffer
 * Based on: 48kHz, 16-bit, stereo
 */
export function getAudioDuration(pcmBuffer: Buffer): number {
    const sampleRate = 48000;
    const numChannels = 2;
    const bytesPerSample = 2; // 16-bit
    const bytesPerSecond = sampleRate * numChannels * bytesPerSample;
    return pcmBuffer.length / bytesPerSecond;
}
