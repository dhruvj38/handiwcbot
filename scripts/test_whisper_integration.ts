
import { LocalSpeechService } from '../src/services/speech/SpeechService';
import { logger } from '../src/utils/logger';

async function testWhisper() {
    console.log('Testing Local Whisper Integration...');

    try {
        const speechService = new LocalSpeechService();

        console.log('Checking health...');
        const isHealthy = await speechService.healthCheck();

        if (isHealthy) {
            console.log('✅ Whisper service is HEALTHY and connected!');
        } else {
            console.error('❌ Whisper service is UNHEALTHY or not reachable.');
            console.error('Make sure the server is running at the configured URL.');
        }

    } catch (error) {
        console.error('❌ Error testing Whisper service:', error);
    }
}

testWhisper();
