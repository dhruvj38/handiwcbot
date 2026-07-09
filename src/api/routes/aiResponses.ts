import { Router, Response } from 'express'
import { requireAuth, requireGuildAccess, AuthenticatedRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/errorHandler'
import { getPrismaClient } from '../../db/client'

const router = Router()

router.use(requireAuth)

interface AiInteractionRow {
  id: string
  guildId: string
  channelId: string | null
  userId: string | null
  userName: string | null
  messageId: string | null
  botMessageId: string | null
  provider: string
  model: string
  type: string
  userMessage: string
  botResponse: string
  rating: string | null
  feedbackText: string | null
  tags: string[]
  metadata: Record<string, unknown> | null
  createdAt: Date
}

/**
 * GET /api/guilds/:guildId/ai-responses
 * Get recent AI interactions (what the AI said) for a guild
 * Query params:
 *   - channelId: filter by specific channel
 *   - minutes: time window (default 60)
 *   - limit: max results (default 100)
 *   - type: 'all' | 'voice' | 'chat' (default 'all')
 */
router.get(
  '/:guildId/ai-responses',
  requireGuildAccess(),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { guildId } = req.params
    const { channelId, minutes = '60', limit = '100', type = 'all' } = req.query

    const db = getPrismaClient()

    const minutesNumber = Math.min(Math.max(parseInt(minutes as string, 10) || 60, 1), 1440)
    const limitNumber = Math.min(parseInt(limit as string, 10) || 100, 500)
    const typeFilter = type as string

    const now = new Date()
    const startTime = new Date(now.getTime() - minutesNumber * 60 * 1000)

    // Use raw query since ai_interactions table was created manually
    let interactions: AiInteractionRow[]

    // Build query based on filters
    if (typeFilter === 'voice') {
      if (channelId && typeof channelId === 'string') {
        interactions = await db.$queryRaw<AiInteractionRow[]>`
          SELECT 
            id, "guildId", "channelId", "userId", "userName",
            "messageId", "botMessageId", provider, model, type,
            "userMessage", "botResponse", rating, "feedbackText",
            tags, metadata, "createdAt"
          FROM ai_interactions
          WHERE "guildId" = ${guildId}
            AND "channelId" = ${channelId}
            AND type = 'voice'
            AND "createdAt" >= ${startTime}
          ORDER BY "createdAt" ASC
          LIMIT ${limitNumber}
        `
      } else {
        interactions = await db.$queryRaw<AiInteractionRow[]>`
          SELECT 
            id, "guildId", "channelId", "userId", "userName",
            "messageId", "botMessageId", provider, model, type,
            "userMessage", "botResponse", rating, "feedbackText",
            tags, metadata, "createdAt"
          FROM ai_interactions
          WHERE "guildId" = ${guildId}
            AND type = 'voice'
            AND "createdAt" >= ${startTime}
          ORDER BY "createdAt" ASC
          LIMIT ${limitNumber}
        `
      }
    } else if (typeFilter === 'chat') {
      if (channelId && typeof channelId === 'string') {
        interactions = await db.$queryRaw<AiInteractionRow[]>`
          SELECT 
            id, "guildId", "channelId", "userId", "userName",
            "messageId", "botMessageId", provider, model, type,
            "userMessage", "botResponse", rating, "feedbackText",
            tags, metadata, "createdAt"
          FROM ai_interactions
          WHERE "guildId" = ${guildId}
            AND "channelId" = ${channelId}
            AND type = 'chat'
            AND "createdAt" >= ${startTime}
          ORDER BY "createdAt" ASC
          LIMIT ${limitNumber}
        `
      } else {
        interactions = await db.$queryRaw<AiInteractionRow[]>`
          SELECT 
            id, "guildId", "channelId", "userId", "userName",
            "messageId", "botMessageId", provider, model, type,
            "userMessage", "botResponse", rating, "feedbackText",
            tags, metadata, "createdAt"
          FROM ai_interactions
          WHERE "guildId" = ${guildId}
            AND type = 'chat'
            AND "createdAt" >= ${startTime}
          ORDER BY "createdAt" ASC
          LIMIT ${limitNumber}
        `
      }
    } else {
      // All types
      if (channelId && typeof channelId === 'string') {
        interactions = await db.$queryRaw<AiInteractionRow[]>`
          SELECT 
            id, "guildId", "channelId", "userId", "userName",
            "messageId", "botMessageId", provider, model, type,
            "userMessage", "botResponse", rating, "feedbackText",
            tags, metadata, "createdAt"
          FROM ai_interactions
          WHERE "guildId" = ${guildId}
            AND "channelId" = ${channelId}
            AND "createdAt" >= ${startTime}
          ORDER BY "createdAt" ASC
          LIMIT ${limitNumber}
        `
      } else {
        interactions = await db.$queryRaw<AiInteractionRow[]>`
          SELECT 
            id, "guildId", "channelId", "userId", "userName",
            "messageId", "botMessageId", provider, model, type,
            "userMessage", "botResponse", rating, "feedbackText",
            tags, metadata, "createdAt"
          FROM ai_interactions
          WHERE "guildId" = ${guildId}
            AND "createdAt" >= ${startTime}
          ORDER BY "createdAt" ASC
          LIMIT ${limitNumber}
        `
      }
    }

    res.json({
      interactions,
      windowMinutes: minutesNumber,
      limit: limitNumber,
      typeFilter,
      now,
    })
  })
)

export default router
