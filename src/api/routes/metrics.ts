import { Router, Response } from 'express';
import { requireAuth, requireGuildAccess, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { metricsService } from '../services/MetricsService';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/guilds/:guildId/metrics
 * Get aggregated metrics for a guild
 */
router.get('/:guildId/metrics', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const { period = '7d' } = req.query;

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  
  switch (period) {
    case '24h':
      startDate.setHours(startDate.getHours() - 24);
      break;
    case '7d':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(startDate.getDate() - 30);
      break;
    case '90d':
      startDate.setDate(startDate.getDate() - 90);
      break;
    default:
      startDate.setDate(startDate.getDate() - 7);
  }

  const metrics = await metricsService.getGuildMetrics(guildId, startDate, endDate);

  res.json({
    period,
    startDate,
    endDate,
    metrics,
  });
}));

/**
 * GET /api/guilds/:guildId/metrics/timeseries
 * Get time series data for charts
 */
router.get('/:guildId/metrics/timeseries', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const { 
    metric,
    period = '7d',
    granularity = 'day',
  } = req.query;

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  
  switch (period) {
    case '24h':
      startDate.setHours(startDate.getHours() - 24);
      break;
    case '7d':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(startDate.getDate() - 30);
      break;
    default:
      startDate.setDate(startDate.getDate() - 7);
  }

  const validMetrics = ['messages', 'ai_requests', 'errors', 'tokens'] as const;
  const validGranularity = ['hour', 'day'] as const;

  const safeGranularity = (validGranularity.includes(granularity as typeof validGranularity[number])
    ? (granularity as typeof validGranularity[number])
    : 'day');

  // When no specific metric is requested, return combined timeseries data for the dashboard
  if (!metric) {
    const timeseries = await metricsService.getCombinedTimeSeries(
      guildId,
      startDate,
      endDate,
      safeGranularity
    );

    return res.json({
      period,
      granularity: safeGranularity,
      timeseries,
    });
  }

  if (!validMetrics.includes(metric as typeof validMetrics[number])) {
    return res.status(400).json({ error: 'Invalid metric' });
  }

  const data = await metricsService.getTimeSeries(
    guildId,
    metric as typeof validMetrics[number],
    startDate,
    endDate,
    safeGranularity
  );

  res.json({
    metric,
    period,
    granularity: safeGranularity,
    data,
  });
}));

/**
 * GET /api/guilds/:guildId/metrics/top-users
 * Get top users by activity
 */
router.get('/:guildId/metrics/top-users', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const { period = '7d', limit = '10' } = req.query;

  const endDate = new Date();
  const startDate = new Date();
  
  switch (period) {
    case '24h':
      startDate.setHours(startDate.getHours() - 24);
      break;
    case '7d':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(startDate.getDate() - 30);
      break;
    default:
      startDate.setDate(startDate.getDate() - 7);
  }

  const topUsers = await metricsService.getTopUsers(
    guildId,
    startDate,
    endDate,
    Math.min(parseInt(limit as string), 50)
  );
  const users = topUsers.map(u => ({
    userId: u.userId,
    userName: u.userName,
    count: u.activityCount,
  }));

  res.json({ users });
}));

/**
 * GET /api/guilds/:guildId/metrics/snapshots
 * Get historical metric snapshots
 */
router.get('/:guildId/metrics/snapshots', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const { period = '7d' } = req.query;

  const endDate = new Date();
  const startDate = new Date();
  
  switch (period) {
    case '24h':
      startDate.setHours(startDate.getHours() - 24);
      break;
    case '7d':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(startDate.getDate() - 30);
      break;
    default:
      startDate.setDate(startDate.getDate() - 7);
  }

  const snapshots = await metricsService.getSnapshots(guildId, startDate, endDate);

  res.json({ snapshots });
}));

export default router;
