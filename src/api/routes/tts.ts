import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getTtsService } from '../../services/speech/TtsService';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/tts/usage
 * Get current TTS usage statistics
 */
router.get('/usage', asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const ttsService = getTtsService();
  
  if (!ttsService) {
    res.status(503).json({ 
      error: 'TTS service not initialized',
      enabled: false,
    });
    return;
  }

  const sessionStats = ttsService.getUsageStats();
  const subscriptionInfo = await ttsService.getSubscriptionInfo();

  res.json({
    enabled: true,
    session: sessionStats,
    subscription: subscriptionInfo,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/tts/voices
 * Get available ElevenLabs voices
 */
router.get('/voices', asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const ttsService = getTtsService();
  
  if (!ttsService) {
    res.json({ 
      error: 'TTS service not initialized',
      voices: [],
    });
    return;
  }

  const voices = await ttsService.getVoices();
  res.json({ voices });
}));

/**
 * POST /api/tts/reset-session
 * Reset session usage counters
 */
router.post('/reset-session', asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const ttsService = getTtsService();
  
  if (!ttsService) {
    res.status(503).json({ error: 'TTS service not initialized' });
    return;
  }

  ttsService.resetSessionStats();
  res.json({ 
    success: true,
    message: 'Session stats reset',
    timestamp: new Date().toISOString(),
  });
}));

export default router;
