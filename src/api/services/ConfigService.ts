import { getPrismaClient } from '../../db/client';
import { activityLogger } from './ActivityLogger';
import { botPersonality } from '../../config/personality';
import { configWebSocket } from '../websocket';
import { runtimeConfig } from '../../services/RuntimeConfigManager';
import { config as staticConfig } from '../../config';

export interface GuildConfigData {
  guildId: string;
  guildName: string;
  guildIcon?: string | null;
  
  // Feature toggles
  learningEnabled: boolean;
  voiceEnabled: boolean;
  ttsEnabled: boolean;
  autoJoinEnabled: boolean;
  chimeInEnabled: boolean;
  
  // AI settings
  aiModel: string;
  aiModelAnalysis: string;
  aiModelEmbeddings: string;
  aiChatProvider: 'google' | 'openai';
  aiAnalysisProvider: 'google' | 'openai';
  aiEmbeddingsProvider: 'google' | 'openai';
  aiTemperature: number;
  aiMaxTokens: number;
  
  // Voice/TTS settings
  ttsVoice: string;
  ttsModel: string;
  minMembersToJoin: number;
  chimeInChance: number;
  minSecondsBetweenChimes: number;
  maxVoiceResponseLength: number;
  voiceChunkDurationMs: number;
  voiceSummaryIntervalMs: number;
  
  // Learning settings
  learningBatchSize: number;
  learningBatchTimeoutMs: number;
  learningPersonalityUpdateMs: number;
  learningConsolidationMs: number;
  
  // Memory settings
  memoryRetentionDays: number;
  maxMemoriesPerUser: number;
  memoryRetrievalLimit: number;
  maxContextMessages: number;
  
  // Bot behavior
  botPrefix: string;
  personalityOverrides: typeof botPersonality | null;
  allowedChannelIds: string[];
  logChannelId?: string | null;
}

// In-memory cache for hot config reads
const configCache = new Map<string, { config: GuildConfigData; cachedAt: number }>();
const CACHE_TTL_MS = 60000; // 1 minute

export class ConfigService {
  private db = getPrismaClient();

  async getGuildConfig(guildId: string): Promise<GuildConfigData | null> {
    // Check cache
    const cached = configCache.get(guildId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.config;
    }

    const config = await this.db.guildConfig.findUnique({
      where: { guildId },
    });

    if (config) {
      const configData: GuildConfigData = {
        ...config,
        aiChatProvider: (config.aiChatProvider as 'google' | 'openai') ?? 'google',
        aiAnalysisProvider: (config.aiAnalysisProvider as 'google' | 'openai') ?? 'google',
        aiEmbeddingsProvider: (config.aiEmbeddingsProvider as 'google' | 'openai') ?? 'google',
        personalityOverrides: config.personalityOverrides as typeof botPersonality | null,
      };
      configCache.set(guildId, { config: configData, cachedAt: Date.now() });
      return configData;
    }

    return null;
  }

  async getOrCreateGuildConfig(guildId: string, guildName: string, guildIcon?: string | null): Promise<GuildConfigData> {
    let config = await this.getGuildConfig(guildId);
    
    if (!config) {
      const created = await this.db.guildConfig.create({
        data: {
          guildId,
          guildName,
          guildIcon,
        },
      });
      config = {
        ...created,
        personalityOverrides: null,
      };
      configCache.set(guildId, { config, cachedAt: Date.now() });
    }

    return config;
  }

  async updateGuildConfig(
    guildId: string,
    updates: Partial<GuildConfigData>,
    actorId: string,
    actorName: string
  ): Promise<GuildConfigData> {
    const current = await this.getGuildConfig(guildId);
    
    // Log each field change
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'guildId') continue;
      
      const oldValue = current ? (current as Record<string, unknown>)[key] : undefined;
      if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
        await this.db.configAuditLog.create({
          data: {
            guildId,
            actorId,
            actorName,
            changeType: 'update',
            field: key,
            oldValue: oldValue !== undefined ? JSON.stringify(oldValue) : null,
            newValue: value !== undefined ? JSON.stringify(value) : null,
          },
        });

        activityLogger.info(guildId, 'config_change', `${actorName} updated ${key}`, {
          userId: actorId,
          userName: actorName,
          metadata: { field: key, oldValue, newValue: value },
        });

        // Notify RuntimeConfigManager for bot services
        runtimeConfig.notifyConfigChange(guildId, key, oldValue, value, actorName);

        // Broadcast to dashboard clients via WebSocket
        configWebSocket.broadcast(guildId, {
          type: 'config:updated',
          field: key,
          oldValue,
          newValue: value,
          actor: actorName,
        });
      }
    }

    const updated = await this.db.guildConfig.update({
      where: { guildId },
      data: updates,
    });

    const configData: GuildConfigData = {
      ...updated,
      personalityOverrides: updated.personalityOverrides as typeof botPersonality | null,
    };

    // Invalidate cache
    configCache.delete(guildId);
    configCache.set(guildId, { config: configData, cachedAt: Date.now() });

    return configData;
  }

  async getAuditLog(guildId: string, limit = 50, offset = 0) {
    return this.db.configAuditLog.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async resetGuildConfig(guildId: string, actorId: string, actorName: string): Promise<GuildConfigData> {
    const current = await this.getGuildConfig(guildId);
    if (!current) throw new Error('Guild config not found');

    await this.db.configAuditLog.create({
      data: {
        guildId,
        actorId,
        actorName,
        changeType: 'reset',
        field: 'all',
        oldValue: JSON.stringify(current),
        newValue: null,
      },
    });

    const reset = await this.db.guildConfig.update({
      where: { guildId },
      data: {
        learningEnabled: true,
        voiceEnabled: true,
        ttsEnabled: false,
        autoJoinEnabled: true,
        aiModel: staticConfig.ai.models.chat,
        aiModelAnalysis: staticConfig.ai.models.analysis,
        aiModelEmbeddings: staticConfig.ai.models.embeddings,
        aiChatProvider: 'google',
        aiAnalysisProvider: 'google',
        aiEmbeddingsProvider: 'google',
        aiTemperature: 0.7,
        aiMaxTokens: 2000,
        ttsVoice: 'Kore',
        ttsSpeakingRate: 1.0,
        minMembersToJoin: 2,
        chimeInChance: 0.15,
        memoryRetentionDays: 30,
        maxMemoriesPerUser: 100,
        personalityOverrides: null,
        allowedChannelIds: [],
        logChannelId: null,
      },
    });

    configCache.delete(guildId);
    
    return {
      ...reset,
      personalityOverrides: null,
    };
  }

  invalidateCache(guildId: string) {
    configCache.delete(guildId);
  }

  clearCache() {
    configCache.clear();
  }
}

export const configService = new ConfigService();
