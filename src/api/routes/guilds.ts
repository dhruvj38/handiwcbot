import { Router, Response } from 'express';
import { requireAuth, requireGuildAccess, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { configService } from '../services/ConfigService';
import { botPersonality } from '../../config/personality';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/guilds
 * List guilds the user can manage
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  // Guilds already fetched by requireAuth + fetchUserGuilds if needed
  const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
    headers: { Authorization: `Bearer ${req.user!.accessToken}` },
  });

  if (!guildsRes.ok) {
    return res.status(500).json({ error: 'Failed to fetch guilds' });
  }

  const allGuilds = await guildsRes.json() as Array<{ id: string; name: string; icon: string | null; permissions: string }>;
  const manageableGuilds = allGuilds.filter((g) =>
    (parseInt(g.permissions) & 0x20) === 0x20
  );

  res.json({
    guilds: manageableGuilds.map((g: { id: string; name: string; icon: string | null }) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
    })),
  });
});

/**
 * GET /api/guilds/:guildId/config
 * Get guild configuration
 */
router.get('/:guildId/config', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;

  // Guild info is loaded by requireGuildAccess using Discord's API
  const guild = req.guilds?.find((g) => g.id === guildId);

  const config = await configService.getOrCreateGuildConfig(
    guildId,
    guild?.name || 'Unknown Guild',
    guild?.icon
  );

  // Include default personality for reference
  res.json({
    config,
    defaultPersonality: botPersonality,
  });
}));

/**
 * PATCH /api/guilds/:guildId/config
 * Update guild configuration
 */
router.patch('/:guildId/config', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const updates = req.body;
  console.log(`[API] PATCH config for guild ${guildId}`, { updates });

  // Validate updates - only allow certain fields
  const allowedFields = [
    // Feature toggles
    'learningEnabled',
    'voiceEnabled',
    'ttsEnabled',
    'autoJoinEnabled',
    'chimeInEnabled',
    // AI settings
    'aiModel',
    'aiModelAnalysis',
    'aiModelEmbeddings',
    'aiChatProvider',
    'aiAnalysisProvider',
    'aiEmbeddingsProvider',
    'aiTemperature',
    'aiMaxTokens',
    // Voice/TTS settings
    'ttsVoice',
    'ttsModel',
    'minMembersToJoin',
    'chimeInChance',
    'minSecondsBetweenChimes',
    'maxVoiceResponseLength',
    'voiceChunkDurationMs',
    'voiceSummaryIntervalMs',
    // Learning settings
    'learningBatchSize',
    'learningBatchTimeoutMs',
    'learningPersonalityUpdateMs',
    'learningConsolidationMs',
    // Memory settings
    'memoryRetentionDays',
    'maxMemoriesPerUser',
    'memoryRetrievalLimit',
    'maxContextMessages',
    // Bot behavior
    'botPrefix',
    'personalityOverrides',
    'allowedChannelIds',
    'logChannelId',
  ];

  const filteredUpdates: Record<string, unknown> = {};
  for (const key of Object.keys(updates)) {
    if (allowedFields.includes(key)) {
      filteredUpdates[key] = updates[key];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const config = await configService.updateGuildConfig(
    guildId,
    filteredUpdates,
    req.user!.id,
    req.user!.username
  );

  res.json({ config });
}));

/**
 * POST /api/guilds/:guildId/config/reset
 * Reset guild configuration to defaults
 */
router.post('/:guildId/config/reset', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;

  const config = await configService.resetGuildConfig(
    guildId,
    req.user!.id,
    req.user!.username
  );

  res.json({ config });
}));

/**
 * GET /api/guilds/:guildId/audit-log
 * Get configuration audit log
 */
router.get('/:guildId/audit-log', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  const auditLog = await configService.getAuditLog(guildId, limit, offset);

  res.json({ auditLog });
}));

/**
 * GET /api/guilds/:guildId/channels
 * Get Discord channels for this guild (for channel selectors)
 */
router.get('/:guildId/channels', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const botToken = process.env.DISCORD_TOKEN;

  if (!botToken) {
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  // Fetch channels using bot token (has access to all guild channels)
  const channelsRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!channelsRes.ok) {
    console.error('[API] Failed to fetch channels:', channelsRes.status);
    return res.status(channelsRes.status).json({ error: 'Failed to fetch channels' });
  }

  interface DiscordChannel {
    id: string;
    name: string;
    type: number;
    position: number;
    parent_id: string | null;
  }

  const allChannels = await channelsRes.json() as DiscordChannel[];

  // Filter to text channels only (type 0 = text, type 5 = announcement)
  // and sort by position
  const textChannels = allChannels
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type === 5 ? 'announcement' : 'text',
      parentId: c.parent_id,
    }));

  // Get category names for better organization
  const categories = allChannels
    .filter((c) => c.type === 4)
    .reduce((acc: Record<string, string>, c) => {
      acc[c.id] = c.name;
      return acc;
    }, {});

  res.json({
    channels: textChannels,
    categories,
  });
}));

export default router;
