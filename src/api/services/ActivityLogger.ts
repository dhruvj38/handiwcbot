import { getPrismaClient } from '../../db/client';
import { logger } from '../../utils/logger';
import { configWebSocket } from '../websocket';
import type { Prisma } from '@prisma/client';

export type LogType =
  | 'message' | 'command' | 'voice_join' | 'voice_leave'
  | 'ai_request' | 'ai_response' | 'tts' | 'stt'
  | 'error' | 'learning' | 'config_change'
  // Task/operation tracking
  | 'task_start' | 'task_progress' | 'task_complete' | 'task_error'
  // Voice and transcription
  | 'transcription' | 'chime_in'
  // Memory operations  
  | 'memory_store' | 'memory_retrieve'
  // Profiling and training
  | 'profiling' | 'gif_train' | 'bible_update';

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  guildId: string;
  channelId?: string;
  userId?: string;
  userName?: string;
  type: LogType;
  severity?: LogSeverity;
  summary: string;
  metadata?: Record<string, unknown>;
  model?: string;
  promptTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  errorCode?: string;
  stackTrace?: string;
  correlationId?: string;
}

class ActivityLoggerService {
  private queue: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private batchSize = 50;
  private flushIntervalMs = 5000;

  constructor() {
    this.startFlushInterval();
  }

  log(entry: LogEntry) {
    this.queue.push({
      ...entry,
      severity: entry.severity || 'info',
    });

    // Also log to console for debugging
    if (entry.severity === 'error') {
      logger.error(`[ActivityLog] ${entry.type}: ${entry.summary}`);
    } else {
      logger.debug(`[ActivityLog] ${entry.type}: ${entry.summary}`);
    }

    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  // Convenience methods
  info(guildId: string, type: LogType, summary: string, extra?: Partial<LogEntry>) {
    this.log({ guildId, type, summary, severity: 'info', ...extra });
  }

  warn(guildId: string, type: LogType, summary: string, extra?: Partial<LogEntry>) {
    this.log({ guildId, type, summary, severity: 'warn', ...extra });
  }

  error(guildId: string, type: LogType, summary: string, error?: Error, extra?: Partial<LogEntry>) {
    this.log({
      guildId,
      type,
      summary,
      severity: 'error',
      errorCode: error?.name,
      stackTrace: error?.stack,
      ...extra,
    });
  }

  aiRequest(guildId: string, data: {
    channelId?: string;
    userId?: string;
    userName?: string;
    model: string;
    promptTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    costUsd?: number;
    correlationId?: string;
    summary?: string;
  }) {
    this.log({
      guildId,
      channelId: data.channelId,
      userId: data.userId,
      userName: data.userName,
      type: 'ai_response',
      severity: 'info',
      summary: data.summary || `AI response generated`,
      model: data.model,
      promptTokens: data.promptTokens,
      outputTokens: data.outputTokens,
      latencyMs: data.latencyMs,
      costUsd: data.costUsd,
      correlationId: data.correlationId,
    });
  }

  // Task operation logging
  taskStart(guildId: string, taskName: string, data?: { userId?: string; userName?: string; correlationId?: string; metadata?: Record<string, unknown> }) {
    this.log({
      guildId,
      userId: data?.userId,
      userName: data?.userName,
      type: 'task_start',
      severity: 'info',
      summary: `Task started: ${taskName}`,
      correlationId: data?.correlationId,
      metadata: data?.metadata,
    });
  }

  taskProgress(guildId: string, taskName: string, progress: string, data?: { correlationId?: string; metadata?: Record<string, unknown> }) {
    this.log({
      guildId,
      type: 'task_progress',
      severity: 'info',
      summary: `[${taskName}] ${progress}`,
      correlationId: data?.correlationId,
      metadata: data?.metadata,
    });
  }

  taskComplete(guildId: string, taskName: string, result?: string, data?: { correlationId?: string; latencyMs?: number; metadata?: Record<string, unknown> }) {
    this.log({
      guildId,
      type: 'task_complete',
      severity: 'info',
      summary: result ? `Task completed: ${taskName} - ${result}` : `Task completed: ${taskName}`,
      correlationId: data?.correlationId,
      latencyMs: data?.latencyMs,
      metadata: data?.metadata,
    });
  }

  taskError(guildId: string, taskName: string, error: Error, data?: { correlationId?: string; metadata?: Record<string, unknown> }) {
    this.log({
      guildId,
      type: 'task_error',
      severity: 'error',
      summary: `Task failed: ${taskName} - ${error.message}`,
      errorCode: error.name,
      stackTrace: error.stack,
      correlationId: data?.correlationId,
      metadata: data?.metadata,
    });
  }

  // Command logging
  command(guildId: string, commandName: string, data?: { userId?: string; userName?: string; channelId?: string; metadata?: Record<string, unknown> }) {
    this.log({
      guildId,
      channelId: data?.channelId,
      userId: data?.userId,
      userName: data?.userName,
      type: 'command',
      severity: 'info',
      summary: `Command executed: /${commandName}`,
      metadata: data?.metadata,
    });
  }

  // Voice operations
  voice(guildId: string, event: 'join' | 'leave', data: { channelId: string; userId?: string; userName?: string; metadata?: Record<string, unknown> }) {
    this.log({
      guildId,
      channelId: data.channelId,
      userId: data.userId,
      userName: data.userName,
      type: event === 'join' ? 'voice_join' : 'voice_leave',
      severity: 'info',
      summary: `Voice ${event}: ${data.userName || data.userId || 'user'}`,
      metadata: data.metadata,
    });
  }

  // Transcription logging
  transcription(guildId: string, data: { channelId: string; userId?: string; userName?: string; text: string; latencyMs?: number; metadata?: Record<string, unknown> }) {
    this.log({
      guildId,
      channelId: data.channelId,
      userId: data.userId,
      userName: data.userName,
      type: 'transcription',
      severity: 'info',
      summary: `Transcribed: "${data.text.substring(0, 100)}${data.text.length > 100 ? '...' : ''}"`,
      latencyMs: data.latencyMs,
      metadata: data.metadata,
    });
  }

  // Memory operations
  memoryOp(guildId: string, operation: 'store' | 'retrieve', data: { type: string; count?: number; latencyMs?: number; metadata?: Record<string, unknown> }) {
    this.log({
      guildId,
      type: operation === 'store' ? 'memory_store' : 'memory_retrieve',
      severity: 'info',
      summary: `Memory ${operation}: ${data.type}${data.count ? ` (${data.count} items)` : ''}`,
      latencyMs: data.latencyMs,
      metadata: data.metadata,
    });
  }

  async flush() {
    if (this.queue.length === 0) return;

    const entries = [...this.queue];
    this.queue = [];

    try {
      const db = getPrismaClient();
      await db.activityLog.createMany({
        data: entries.map(e => ({
          guildId: e.guildId,
          channelId: e.channelId,
          userId: e.userId,
          userName: e.userName,
          type: e.type,
          severity: e.severity || 'info',
          summary: e.summary,
          metadata: e.metadata as unknown as Prisma.InputJsonValue,
          model: e.model,
          promptTokens: e.promptTokens,
          outputTokens: e.outputTokens,
          latencyMs: e.latencyMs,
          costUsd: e.costUsd,
          errorCode: e.errorCode,
          stackTrace: e.stackTrace,
          correlationId: e.correlationId,
        })),
      });

      const uniqueGuildIds = Array.from(new Set(entries.map(e => e.guildId)));
      for (const guildId of uniqueGuildIds) {
        const countForGuild = entries.filter(e => e.guildId === guildId).length;
        try {
          configWebSocket.broadcast(guildId, {
            type: 'log:created',
            message: `${countForGuild} new log${countForGuild === 1 ? '' : 's'}`,
          });
        } catch (wsError) {
          logger.error(`[ActivityLog] Failed to broadcast log updates for guild ${guildId}:`, wsError);
        }
      }
    } catch (error) {
      logger.error('Failed to flush activity logs:', error);
      // Re-queue failed entries (limit to prevent memory issues)
      if (this.queue.length < 1000) {
        this.queue.unshift(...entries);
      }
    }
  }

  private startFlushInterval() {
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  stop() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    return this.flush();
  }
}

export const activityLogger = new ActivityLoggerService();
