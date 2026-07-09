import { getPrismaClient } from '../../db/client';

export interface MetricsSummary {
  messagesCount: number;
  commandsCount: number;
  voiceMinutes: number;
  aiRequestsCount: number;
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  errorsCount: number;
  avgLatencyMs: number | null;
}

export interface TimeSeriesPoint {
  timestamp: Date;
  value: number;
}

export class MetricsService {
  private db = getPrismaClient();

  /**
   * Get aggregated metrics for a guild over a time period
   */
  async getGuildMetrics(guildId: string, startDate: Date, endDate: Date): Promise<MetricsSummary> {
    const logs = await this.db.activityLog.findMany({
      where: {
        guildId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        type: true,
        promptTokens: true,
        outputTokens: true,
        latencyMs: true,
        costUsd: true,
        severity: true,
      },
    });

    let messagesCount = 0;
    let commandsCount = 0;
    let voiceMinutes = 0;
    let aiRequestsCount = 0;
    let promptTokens = 0;
    let outputTokens = 0;
    let estimatedCostUsd = 0;
    let errorsCount = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    for (const log of logs) {
      switch (log.type) {
        case 'message':
          messagesCount++;
          break;
        case 'command':
          commandsCount++;
          break;
        case 'voice_join':
        case 'voice_leave':
          // Voice minutes calculated separately
          break;
        case 'ai_request':
        case 'ai_response':
          aiRequestsCount++;
          if (log.promptTokens) promptTokens += log.promptTokens;
          if (log.outputTokens) outputTokens += log.outputTokens;
          if (log.costUsd) estimatedCostUsd += log.costUsd;
          if (log.latencyMs) {
            totalLatency += log.latencyMs;
            latencyCount++;
          }
          break;
      }

      if (log.severity === 'error') {
        errorsCount++;
      }
    }

    // Calculate voice minutes from voice sessions
    const voiceLogs = logs.filter(l => l.type === 'voice_join' || l.type === 'voice_leave');
    // Simplified: just count voice events for now
    voiceMinutes = voiceLogs.length * 5; // Rough estimate

    return {
      messagesCount,
      commandsCount,
      voiceMinutes,
      aiRequestsCount,
      promptTokens,
      outputTokens,
      estimatedCostUsd,
      errorsCount,
      avgLatencyMs: latencyCount > 0 ? totalLatency / latencyCount : null,
    };
  }

  /**
   * Get time series data for charting
   */
  async getTimeSeries(
    guildId: string,
    metric: 'messages' | 'ai_requests' | 'errors' | 'tokens',
    startDate: Date,
    endDate: Date,
    granularity: 'hour' | 'day' = 'day'
  ): Promise<TimeSeriesPoint[]> {
    const typeFilter = {
      messages: ['message'],
      ai_requests: ['ai_request', 'ai_response'],
      errors: undefined, // Will filter by severity
      tokens: ['ai_request', 'ai_response'],
    }[metric];

    const logs = await this.db.activityLog.findMany({
      where: {
        guildId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        ...(typeFilter ? { type: { in: typeFilter } } : {}),
        ...(metric === 'errors' ? { severity: 'error' } : {}),
      },
      select: {
        createdAt: true,
        promptTokens: true,
        outputTokens: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by time bucket
    const buckets = new Map<string, number>();
    
    for (const log of logs) {
      const date = new Date(log.createdAt);
      let key: string;
      
      if (granularity === 'hour') {
        date.setMinutes(0, 0, 0);
        key = date.toISOString();
      } else {
        date.setHours(0, 0, 0, 0);
        key = date.toISOString();
      }

      const value = metric === 'tokens' 
        ? (log.promptTokens || 0) + (log.outputTokens || 0)
        : 1;
      
      buckets.set(key, (buckets.get(key) || 0) + value);
    }

    return Array.from(buckets.entries())
      .map(([timestamp, value]) => ({
        timestamp: new Date(timestamp),
        value,
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get combined time series data for multiple metrics in a single pass.
   * Returns buckets with separate counts for messages, AI requests, errors,
   * and token usage, formatted for the dashboard analytics page.
   */
  async getCombinedTimeSeries(
    guildId: string,
    startDate: Date,
    endDate: Date,
    granularity: 'hour' | 'day' = 'day'
  ): Promise<Array<{
    date: string;
    messagesCount: number;
    aiRequestsCount: number;
    errorsCount: number;
    promptTokens: number;
    outputTokens: number;
  }>> {
    const logs = await this.db.activityLog.findMany({
      where: {
        guildId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        createdAt: true,
        type: true,
        severity: true,
        promptTokens: true,
        outputTokens: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const buckets = new Map<string, {
      messagesCount: number;
      aiRequestsCount: number;
      errorsCount: number;
      promptTokens: number;
      outputTokens: number;
    }>();

    for (const log of logs) {
      const bucketDate = new Date(log.createdAt);
      if (granularity === 'hour') {
        bucketDate.setMinutes(0, 0, 0);
      } else {
        bucketDate.setHours(0, 0, 0, 0);
      }

      const key = bucketDate.toISOString();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          messagesCount: 0,
          aiRequestsCount: 0,
          errorsCount: 0,
          promptTokens: 0,
          outputTokens: 0,
        };
        buckets.set(key, bucket);
      }

      if (log.type === 'message') {
        bucket.messagesCount += 1;
      }

      if (log.type === 'ai_request' || log.type === 'ai_response') {
        bucket.aiRequestsCount += 1;
        if (log.promptTokens) bucket.promptTokens += log.promptTokens;
        if (log.outputTokens) bucket.outputTokens += log.outputTokens;
      }

      if (log.severity === 'error') {
        bucket.errorsCount += 1;
      }
    }

    return Array.from(buckets.entries())
      .map(([timestamp, value]) => ({
        date: timestamp,
        messagesCount: value.messagesCount,
        aiRequestsCount: value.aiRequestsCount,
        errorsCount: value.errorsCount,
        promptTokens: value.promptTokens,
        outputTokens: value.outputTokens,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  /**
   * Get top users by activity
   */
  async getTopUsers(
    guildId: string,
    startDate: Date,
    endDate: Date,
    limit = 10
  ): Promise<Array<{ userId: string; userName: string | null; activityCount: number }>> {
    const logs = await this.db.activityLog.groupBy({
      by: ['userId', 'userName'],
      where: {
        guildId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        userId: { not: null },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    return logs.map(l => ({
      userId: l.userId as string,
      userName: l.userName,
      activityCount: l._count.id,
    }));
  }

  /**
   * Create hourly snapshot for a guild
   */
  async createSnapshot(guildId: string) {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMinutes(0, 0, 0);
    
    const periodStart = new Date(periodEnd);
    periodStart.setHours(periodStart.getHours() - 1);

    const metrics = await this.getGuildMetrics(guildId, periodStart, periodEnd);

    return this.db.metricsSnapshot.upsert({
      where: {
        guildId_periodStart: {
          guildId,
          periodStart,
        },
      },
      update: metrics,
      create: {
        guildId,
        periodStart,
        periodEnd,
        ...metrics,
      },
    });
  }

  /**
   * Get historical snapshots for charting
   */
  async getSnapshots(guildId: string, startDate: Date, endDate: Date) {
    return this.db.metricsSnapshot.findMany({
      where: {
        guildId,
        periodStart: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { periodStart: 'asc' },
    });
  }
}

export const metricsService = new MetricsService();
