import { Router, Response } from 'express';
import { requireAuth, requireGuildAccess, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getPrismaClient } from '../../db/client';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/guilds/:guildId/logs
 * Get activity logs with filtering and pagination
 */
router.get('/:guildId/logs', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const {
    type,
    severity,
    search,
    startDate,
    endDate,
    page = '1',
    limit = '50',
  } = req.query;

  const db = getPrismaClient();

  const where: Record<string, unknown> = {
    guildId,
  };

  if (type && typeof type === 'string') {
    where.type = type;
  }

  if (severity && typeof severity === 'string') {
    where.severity = severity;
  }

  if (search && typeof search === 'string') {
    where.summary = { contains: search, mode: 'insensitive' };
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate && typeof startDate === 'string') {
      (where.createdAt as Record<string, Date>).gte = new Date(startDate);
    }
    if (endDate && typeof endDate === 'string') {
      (where.createdAt as Record<string, Date>).lte = new Date(endDate);
    }
  }

  const pageNumber = Math.max(parseInt(page as string, 10) || 1, 1);
  const limitNumber = Math.min(parseInt(limit as string, 10) || 50, 100);

  const [logs, total] = await Promise.all([
    db.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limitNumber,
      skip: (pageNumber - 1) * limitNumber,
    }),
    db.activityLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limitNumber));

  res.json({
    logs,
    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      totalPages,
    },
  });
}));

/**
 * GET /api/guilds/:guildId/logs/:logId
 * Get a single log entry with full details
 */
router.get('/:guildId/logs/:logId', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId, logId } = req.params;

  const db = getPrismaClient();
  const log = await db.activityLog.findFirst({
    where: { id: logId, guildId },
  });

  if (!log) {
    return res.status(404).json({ error: 'Log not found' });
  }

  // Get related logs by correlationId if present
  let relatedLogs: typeof log[] = [];
  if (log.correlationId) {
    relatedLogs = await db.activityLog.findMany({
      where: {
        correlationId: log.correlationId,
        id: { not: logId },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  res.json({ log, relatedLogs });
}));

/**
 * GET /api/guilds/:guildId/logs/stats
 * Get log statistics
 */
router.get('/:guildId/logs/stats', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const { startDate, endDate } = req.query;

  const db = getPrismaClient();

  const where: Record<string, unknown> = { guildId };
  
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate && typeof startDate === 'string') {
      (where.createdAt as Record<string, Date>).gte = new Date(startDate);
    }
    if (endDate && typeof endDate === 'string') {
      (where.createdAt as Record<string, Date>).lte = new Date(endDate);
    }
  }

  // Count by type
  const byType = await db.activityLog.groupBy({
    by: ['type'],
    where,
    _count: { id: true },
  });

  // Count by severity
  const bySeverity = await db.activityLog.groupBy({
    by: ['severity'],
    where,
    _count: { id: true },
  });

  // Total count
  const total = await db.activityLog.count({ where });

  res.json({
    total,
    byType: Object.fromEntries(byType.map(b => [b.type, b._count.id])),
    bySeverity: Object.fromEntries(bySeverity.map(b => [b.severity, b._count.id])),
  });
}));

export default router;
