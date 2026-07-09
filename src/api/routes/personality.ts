import { Router, Response } from 'express';
import { requireAuth, requireGuildAccess, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { configService } from '../services/ConfigService';
import { botPersonality } from '../../config/personality';
import { getPrismaClient } from '../../db/client';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/guilds/:guildId/personality
 * Get personality configuration (merged default + overrides)
 */
router.get('/:guildId/personality', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;

  const config = await configService.getGuildConfig(guildId);
  
  // Deep merge default personality with overrides
  const merged = deepMerge(
    JSON.parse(JSON.stringify(botPersonality)),
    config?.personalityOverrides || {}
  );

  res.json({
    personality: merged,
    defaults: botPersonality,
    overrides: config?.personalityOverrides || null,
  });
}));

/**
 * PATCH /api/guilds/:guildId/personality
 * Update personality overrides
 */
router.patch('/:guildId/personality', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const overrides = req.body;

  // Validate structure matches expected personality shape
  const validTopLevelKeys = [
    'name', 'role', 'vibe', 'summary',
    'slang', 'expressions', 'typingStyle',
    'emojis', 'forbidden', 'responseGuidelines',
    'traits', 'interests',
  ];

  const filteredOverrides: Record<string, unknown> = {};
  for (const key of Object.keys(overrides)) {
    if (validTopLevelKeys.includes(key)) {
      filteredOverrides[key] = overrides[key];
    }
  }

  const config = await configService.updateGuildConfig(
    guildId,
    { personalityOverrides: filteredOverrides },
    req.user!.id,
    req.user!.username
  );

  res.json({
    personality: deepMerge(
      JSON.parse(JSON.stringify(botPersonality)),
      config.personalityOverrides || {}
    ),
    overrides: config.personalityOverrides,
  });
}));

/**
 * DELETE /api/guilds/:guildId/personality
 * Reset personality to defaults
 */
router.delete('/:guildId/personality', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;

  await configService.updateGuildConfig(
    guildId,
    { personalityOverrides: null },
    req.user!.id,
    req.user!.username
  );

  res.json({
    personality: botPersonality,
    overrides: null,
  });
}));

/**
 * GET /api/guilds/:guildId/personality/server-bible
 * Get the server bible (learned personality) if it exists
 */
router.get('/:guildId/personality/server-bible', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;

  const db = getPrismaClient();
  const serverBible = await db.serverMemory.findFirst({
    where: {
      serverId: guildId,
      type: 'rule',
    },
    orderBy: { updatedAt: 'desc' },
  });

  res.json({
    serverBible: serverBible ? {
      id: serverBible.id,
      title: serverBible.title,
      content: serverBible.content,
      metadata: serverBible.metadata,
      updatedAt: serverBible.updatedAt,
    } : null,
  });
}));

/**
 * GET /api/guilds/:guildId/personality/user-profiles
 * Get learned user profiles
 */
router.get('/:guildId/personality/user-profiles', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const { limit = '50', offset = '0' } = req.query;

  const db = getPrismaClient();
  const profiles = await db.userProfile.findMany({
    where: { serverId: guildId },
    orderBy: { lastUpdated: 'desc' },
    take: parseInt(limit as string),
    skip: parseInt(offset as string),
    select: {
      id: true,
      userId: true,
      displayName: true,
      summary: true,
      tags: true,
      metadata: true,
      lastUpdated: true,
    },
  });

  const total = await db.userProfile.count({ where: { serverId: guildId } });

  res.json({ profiles, total });
}));

/**
 * GET /api/guilds/:guildId/personality/profiles
 * Alias for user-profiles for dashboard compatibility
 */
router.get('/:guildId/personality/profiles', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const { limit = '50', offset = '0' } = req.query;

  const db = getPrismaClient();
  const profiles = await db.userProfile.findMany({
    where: { serverId: guildId },
    orderBy: { lastUpdated: 'desc' },
    take: parseInt(limit as string),
    skip: parseInt(offset as string),
    select: {
      id: true,
      userId: true,
      displayName: true,
      summary: true,
      tags: true,
      metadata: true,
      lastUpdated: true,
    },
  });

  const total = await db.userProfile.count({ where: { serverId: guildId } });

  res.json({ profiles, total });
}));

/**
 * DELETE /api/guilds/:guildId/personality/user-profiles/:userId
 * Delete a user profile (privacy/GDPR)
 */
router.delete('/:guildId/personality/user-profiles/:userId', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId, userId } = req.params;

  const db = getPrismaClient();
  await db.userProfile.deleteMany({
    where: { serverId: guildId, userId },
  });

  res.json({ success: true });
}));

/**
 * GET /api/guilds/:guildId/personality/memories
 * Get server memories
 */
router.get('/:guildId/personality/memories', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId } = req.params;
  const { type, limit = '50', offset = '0' } = req.query;

  const db = getPrismaClient();
  const where: Record<string, unknown> = { serverId: guildId };
  
  if (type && typeof type === 'string') {
    where.type = type;
  }

  const memories = await db.serverMemory.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: parseInt(limit as string),
    skip: parseInt(offset as string),
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const total = await db.serverMemory.count({ where });

  res.json({ memories, total });
}));

/**
 * DELETE /api/guilds/:guildId/personality/memories/:memoryId
 * Delete a specific memory
 */
router.delete('/:guildId/personality/memories/:memoryId', requireGuildAccess(), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { guildId, memoryId } = req.params;

  const db = getPrismaClient();
  await db.serverMemory.deleteMany({
    where: { id: memoryId, serverId: guildId },
  });

  res.json({ success: true });
}));

// Helper function for deep merging objects
function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key as keyof T];
    
    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  
  return result;
}

export default router;
