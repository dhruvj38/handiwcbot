import { Router, Response } from 'express'
import { requireAuth, requireGuildAccess, AuthenticatedRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/errorHandler'
import { getPrismaClient } from '../../db/client'

const router = Router()

router.use(requireAuth)

/**
 * GET /api/guilds/:guildId/transcripts
 * Get recent voice transcript chunks for a guild (optionally filtered by channel)
 * This only reads stored transcript text; it does NOT call Whisper/speech APIs.
 */
router.get(
  '/:guildId/transcripts',
  requireGuildAccess(),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { guildId } = req.params
    const { channelId, minutes = '30', limit = '200' } = req.query

    const db = getPrismaClient()

    const minutesNumber = Math.min(Math.max(parseInt(minutes as string, 10) || 30, 1), 1440)
    const limitNumber = Math.min(parseInt(limit as string, 10) || 200, 500)

    const now = new Date()
    const startTime = new Date(now.getTime() - minutesNumber * 60 * 1000)

    const where: Record<string, unknown> = {
      serverId: guildId,
      startedAt: {
        gte: startTime,
      },
    }

    if (channelId && typeof channelId === 'string') {
      where.channelId = channelId
    }

    const transcripts = await db.transcriptChunk.findMany({
      where,
      orderBy: { startedAt: 'asc' },
      take: limitNumber,
      select: {
        id: true,
        serverId: true,
        channelId: true,
        userId: true,
        userName: true,
        startedAt: true,
        endedAt: true,
        rawText: true,
        metadata: true,
        createdAt: true,
      },
    })

    res.json({
      transcripts,
      windowMinutes: minutesNumber,
      limit: limitNumber,
      now,
    })
  })
)

export default router
