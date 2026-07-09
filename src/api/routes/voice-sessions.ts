import { Router, Response } from 'express'
import { requireAuth, requireGuildAccess, AuthenticatedRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/errorHandler'
import { getPrismaClient } from '../../db/client'

const router = Router()

router.use(requireAuth)

/**
 * GET /api/guilds/:guildId/voice-sessions
 * Get voice sessions for a guild, optionally filtered by date range
 */
router.get(
    '/:guildId/voice-sessions',
    requireGuildAccess(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const { guildId } = req.params
        const { date, limit = '50', includeActive = 'true' } = req.query

        const db = getPrismaClient()
        const limitNumber = Math.min(parseInt(limit as string, 10) || 50, 100)

        // Build where clause
        const where: Record<string, unknown> = {
            serverId: guildId,
        }

        // Filter by date if provided (YYYY-MM-DD format)
        if (date && typeof date === 'string') {
            const startOfDay = new Date(date)
            startOfDay.setHours(0, 0, 0, 0)
            const endOfDay = new Date(date)
            endOfDay.setHours(23, 59, 59, 999)

            where.startedAt = {
                gte: startOfDay,
                lte: endOfDay,
            }
        }

        // Optionally exclude active sessions
        if (includeActive !== 'true') {
            where.isActive = false
        }

        const sessions = await db.voiceSessionTranscript.findMany({
            where,
            orderBy: { startedAt: 'desc' },
            take: limitNumber,
            select: {
                id: true,
                serverId: true,
                channelId: true,
                channelName: true,
                startedAt: true,
                endedAt: true,
                isActive: true,
                participantCount: true,
                totalMessages: true,
                createdAt: true,
                updatedAt: true,
            },
        })

        res.json({
            sessions,
            count: sessions.length,
            date: date || null,
        })
    })
)

/**
 * GET /api/guilds/:guildId/voice-sessions/by-day
 * Get sessions grouped by day for calendar/timeline view
 */
router.get(
    '/:guildId/voice-sessions/by-day',
    requireGuildAccess(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const { guildId } = req.params
        const { days = '30' } = req.query

        const db = getPrismaClient()
        const daysNumber = Math.min(parseInt(days as string, 10) || 30, 90)

        const startDate = new Date()
        startDate.setDate(startDate.getDate() - daysNumber)
        startDate.setHours(0, 0, 0, 0)

        const sessions = await db.voiceSessionTranscript.findMany({
            where: {
                serverId: guildId,
                startedAt: { gte: startDate },
            },
            orderBy: { startedAt: 'desc' },
            select: {
                id: true,
                channelName: true,
                startedAt: true,
                endedAt: true,
                isActive: true,
                participantCount: true,
                totalMessages: true,
            },
        })

        // Group sessions by date
        const byDay: Record<string, typeof sessions> = {}
        for (const session of sessions) {
            const dateKey = session.startedAt.toISOString().split('T')[0]
            if (!byDay[dateKey]) {
                byDay[dateKey] = []
            }
            byDay[dateKey].push(session)
        }

        res.json({
            byDay,
            totalSessions: sessions.length,
            daysRange: daysNumber,
        })
    })
)

/**
 * GET /api/guilds/:guildId/voice-sessions/:sessionId
 * Get full session details with all transcript chunks
 */
router.get(
    '/:guildId/voice-sessions/:sessionId',
    requireGuildAccess(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const { guildId, sessionId } = req.params

        const db = getPrismaClient()

        const session = await db.voiceSessionTranscript.findFirst({
            where: {
                id: sessionId,
                serverId: guildId,
            },
            include: {
                transcriptChunks: {
                    orderBy: { startedAt: 'asc' },
                    select: {
                        id: true,
                        userId: true,
                        userName: true,
                        startedAt: true,
                        endedAt: true,
                        rawText: true,
                        metadata: true,
                    },
                },
            },
        })

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        res.json({ session })
    })
)

/**
 * GET /api/guilds/:guildId/voice-sessions/dates-with-sessions
 * Get list of dates that have sessions (for calendar highlighting)
 */
router.get(
    '/:guildId/voice-sessions/dates-with-sessions',
    requireGuildAccess(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const { guildId } = req.params
        const { days = '90' } = req.query

        const db = getPrismaClient()
        const daysNumber = Math.min(parseInt(days as string, 10) || 90, 365)

        const startDate = new Date()
        startDate.setDate(startDate.getDate() - daysNumber)
        startDate.setHours(0, 0, 0, 0)

        const sessions = await db.voiceSessionTranscript.findMany({
            where: {
                serverId: guildId,
                startedAt: { gte: startDate },
            },
            select: {
                startedAt: true,
            },
        })

        // Get unique dates
        const dates = [...new Set(
            sessions.map(s => s.startedAt.toISOString().split('T')[0])
        )]

        res.json({ dates })
    })
)

export default router
