import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { logger } from '../utils/logger';

import authRoutes from './routes/auth';
import guildsRoutes from './routes/guilds';
import logsRoutes from './routes/logs';
import metricsRoutes from './routes/metrics';
import personalityRoutes from './routes/personality';
import transcriptsRoutes from './routes/transcripts';
import envRoutes from './routes/env';
import ttsRoutes from './routes/tts';
import aiResponsesRoutes from './routes/aiResponses';
import voiceSessionsRoutes from './routes/voice-sessions';
import { errorHandler } from './middleware/errorHandler';
import { activityLogger } from './services/ActivityLogger';
import { configWebSocket } from './websocket';

export function createApiServer() {
  const app = express();

  // Middleware
  app.use(cors({
    origin: process.env.DASHBOARD_URL || 'http://localhost:3001',
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.path.startsWith('/api') && !req.path.includes('/health')) {
        logger.debug(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
      }
    });
    next();
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/guilds', guildsRoutes);
  app.use('/api/guilds', logsRoutes);      // /api/guilds/:guildId/logs
  app.use('/api/guilds', metricsRoutes);   // /api/guilds/:guildId/metrics
  app.use('/api/guilds', personalityRoutes); // /api/guilds/:guildId/personality
  app.use('/api/guilds', transcriptsRoutes); // /api/guilds/:guildId/transcripts
  app.use('/api/guilds', voiceSessionsRoutes); // /api/guilds/:guildId/voice-sessions
  app.use('/api/env', envRoutes);          // /api/env - environment config
  app.use('/api/tts', ttsRoutes);          // /api/tts - TTS usage and voices
  app.use('/api/guilds', aiResponsesRoutes); // /api/guilds/:guildId/ai-responses

  // WebSocket client count endpoint
  app.get('/api/ws/status', (_req, res) => {
    res.json({
      clients: configWebSocket.getClientCount(),
      timestamp: new Date().toISOString(),
    });
  });

  // Error handler
  app.use(errorHandler);

  return app;
}

let httpServer: ReturnType<typeof createServer> | null = null;

export function startApiServer(port: number = 3000) {
  const app = createApiServer();

  // Create HTTP server to attach WebSocket
  httpServer = createServer(app);

  // Initialize WebSocket server
  configWebSocket.initialize(httpServer);

  httpServer.listen(port, () => {
    logger.info(`Dashboard API server running on http://localhost:${port}`);
    logger.info(`WebSocket server running on ws://localhost:${port}/ws`);
    logger.info(`Dashboard URL: ${process.env.DASHBOARD_URL || 'http://localhost:3001'}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Shutting down API server...');
    activityLogger.stop();
    configWebSocket.shutdown();
    httpServer?.close();
  });

  return { app, httpServer };
}

export function stopApiServer() {
  activityLogger.stop();
  configWebSocket.shutdown();
  httpServer?.close();
}
