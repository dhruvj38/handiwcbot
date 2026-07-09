import { EventEmitter } from 'events';
import { getPrismaClient } from '../db/client';
import { config as staticConfig } from '../config';
import { botPersonality } from '../config/personality';
import { logger } from '../utils/logger';

/**
 * Runtime guild configuration that can be dynamically updated
 * All settings here can be changed via dashboard without restart
 */
export interface RuntimeGuildConfig {
  guildId: string;
  guildName: string;

  // Feature Toggles
  learningEnabled: boolean;
  voiceEnabled: boolean;
  ttsEnabled: boolean;
  autoJoinEnabled: boolean;
  chimeInEnabled: boolean;

  // AI Settings
  aiModel: string;
  aiModelAnalysis: string;
  aiModelEmbeddings: string;
  aiChatProvider: 'google' | 'openai';
  aiAnalysisProvider: 'google' | 'openai';
  aiEmbeddingsProvider: 'google' | 'openai';
  aiTemperature: number;
  aiMaxTokens: number;

  // Voice/TTS Settings
  ttsVoice: string;
  ttsModel: string;
  minMembersToJoin: number;
  chimeInChance: number;
  minSecondsBetweenChimes: number;
  maxVoiceResponseLength: number;
  voiceChunkDurationMs: number;
  voiceSummaryIntervalMs: number;

  // Learning Settings
  learningBatchSize: number;
  learningBatchTimeoutMs: number;
  learningPersonalityUpdateMs: number;
  learningConsolidationMs: number;

  // Memory Settings
  memoryRetentionDays: number;
  maxMemoriesPerUser: number;
  memoryRetrievalLimit: number;
  maxContextMessages: number;

  // Bot Behavior
  botPrefix: string;

  // Channel Settings
  allowedChannelIds: string[];
  logChannelId: string | null;

  // Personality
  personalityOverrides: typeof botPersonality | null;
}

/**
 * Default config values (from static .env config for initial values)
 */
function getDefaultConfig(): Omit<RuntimeGuildConfig, 'guildId' | 'guildName'> {
  return {
    // Feature toggles
    learningEnabled: staticConfig.learning.enabled,
    voiceEnabled: true,
    ttsEnabled: staticConfig.tts.enabled,
    autoJoinEnabled: staticConfig.voiceChat.autoJoinEnabled,
    chimeInEnabled: staticConfig.voiceChat.chimeInEnabled,

    // AI settings
    aiModel: staticConfig.ai.models.chat,
    aiModelAnalysis: staticConfig.ai.models.analysis,
    aiModelEmbeddings: staticConfig.ai.models.embeddings,
    aiChatProvider: staticConfig.ai.providers.chat,
    aiAnalysisProvider: staticConfig.ai.providers.chat,
    aiEmbeddingsProvider: 'google',
    aiTemperature: staticConfig.ai.temperature,
    aiMaxTokens: staticConfig.ai.maxTokens,

    // Voice/TTS settings
    ttsVoice: staticConfig.tts.voiceId,
    ttsModel: staticConfig.tts.model,
    minMembersToJoin: staticConfig.voiceChat.minMembersToJoin,
    chimeInChance: staticConfig.voiceChat.chimeInChance,
    minSecondsBetweenChimes: staticConfig.voiceChat.minSecondsBetweenChimes,
    maxVoiceResponseLength: staticConfig.voiceChat.maxResponseLength,
    voiceChunkDurationMs: staticConfig.bot.voiceChunkDurationMs,
    voiceSummaryIntervalMs: staticConfig.bot.voiceSummaryIntervalMs,

    // Learning settings
    learningBatchSize: staticConfig.learning.batchSize,
    learningBatchTimeoutMs: staticConfig.learning.batchTimeoutMs,
    learningPersonalityUpdateMs: staticConfig.learning.personalityUpdateIntervalMs,
    learningConsolidationMs: staticConfig.learning.consolidationIntervalMs,

    // Memory settings
    memoryRetentionDays: 30,
    maxMemoriesPerUser: 100,
    memoryRetrievalLimit: staticConfig.bot.memoryRetrievalLimit,
    maxContextMessages: staticConfig.bot.maxContextMessages,

    // Bot behavior
    botPrefix: staticConfig.bot.prefix,

    // Channel settings
    allowedChannelIds: [],
    logChannelId: null,
    personalityOverrides: null,
  };
}

interface CachedConfig {
  config: RuntimeGuildConfig;
  cachedAt: number;
}

const CACHE_TTL_MS = 5000; // 5 second cache for hot path performance

/**
 * RuntimeConfigManager - Singleton for dynamic guild configuration
 * 
 * Features:
 * - Loads config from database on-demand
 * - Caches config with short TTL for performance
 * - Emits events when config changes
 * - Falls back to static config if DB unavailable
 */
class RuntimeConfigManagerClass extends EventEmitter {
  private cache: Map<string, CachedConfig> = new Map();
  private db = getPrismaClient();

  constructor() {
    super();
    logger.debug('[RuntimeConfig] Manager initialized');
  }

  /**
   * Get guild configuration - checks cache first, then DB
   */
  async getGuildConfig(guildId: string): Promise<RuntimeGuildConfig> {
    // Check cache
    const cached = this.cache.get(guildId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.config;
    }

    try {
      const dbConfig = await this.db.guildConfig.findUnique({
        where: { guildId },
      });

      if (dbConfig) {
        const config: RuntimeGuildConfig = {
          guildId: dbConfig.guildId,
          guildName: dbConfig.guildName,

          // Feature toggles
          learningEnabled: dbConfig.learningEnabled,
          voiceEnabled: dbConfig.voiceEnabled,
          ttsEnabled: dbConfig.ttsEnabled,
          autoJoinEnabled: dbConfig.autoJoinEnabled,
          chimeInEnabled: dbConfig.chimeInEnabled,

          // AI settings
          aiModel: dbConfig.aiModel,
          aiModelAnalysis: dbConfig.aiModelAnalysis,
          aiModelEmbeddings: dbConfig.aiModelEmbeddings,
          aiChatProvider: dbConfig.aiChatProvider as 'google' | 'openai',
          aiAnalysisProvider: dbConfig.aiAnalysisProvider as 'google' | 'openai',
          aiEmbeddingsProvider: dbConfig.aiEmbeddingsProvider as 'google' | 'openai',
          aiTemperature: dbConfig.aiTemperature,
          aiMaxTokens: dbConfig.aiMaxTokens,

          // Voice/TTS settings
          ttsVoice: dbConfig.ttsVoice,
          ttsModel: dbConfig.ttsModel,
          minMembersToJoin: dbConfig.minMembersToJoin,
          chimeInChance: dbConfig.chimeInChance,
          minSecondsBetweenChimes: dbConfig.minSecondsBetweenChimes,
          maxVoiceResponseLength: dbConfig.maxVoiceResponseLength,
          voiceChunkDurationMs: dbConfig.voiceChunkDurationMs,
          voiceSummaryIntervalMs: dbConfig.voiceSummaryIntervalMs,

          // Learning settings
          learningBatchSize: dbConfig.learningBatchSize,
          learningBatchTimeoutMs: dbConfig.learningBatchTimeoutMs,
          learningPersonalityUpdateMs: dbConfig.learningPersonalityUpdateMs,
          learningConsolidationMs: dbConfig.learningConsolidationMs,

          // Memory settings
          memoryRetentionDays: dbConfig.memoryRetentionDays,
          maxMemoriesPerUser: dbConfig.maxMemoriesPerUser,
          memoryRetrievalLimit: dbConfig.memoryRetrievalLimit,
          maxContextMessages: dbConfig.maxContextMessages,

          // Bot behavior
          botPrefix: dbConfig.botPrefix,

          // Channel settings
          allowedChannelIds: dbConfig.allowedChannelIds,
          logChannelId: dbConfig.logChannelId,
          personalityOverrides: dbConfig.personalityOverrides as typeof botPersonality | null,
        };

        this.cache.set(guildId, { config, cachedAt: Date.now() });
        return config;
      }

      // Return default config if not in DB
      const defaultConfig: RuntimeGuildConfig = {
        guildId,
        guildName: 'Unknown',
        ...getDefaultConfig(),
      };
      return defaultConfig;

    } catch (error) {
      console.error(`[RuntimeConfig] Failed to load config for guild ${guildId}:`, error);
      // Return default on error
      return {
        guildId,
        guildName: 'Unknown',
        ...getDefaultConfig(),
      };
    }
  }

  /**
   * Get specific config value for a guild
   */
  async getValue<K extends keyof RuntimeGuildConfig>(
    guildId: string,
    key: K
  ): Promise<RuntimeGuildConfig[K]> {
    const config = await this.getGuildConfig(guildId);
    return config[key];
  }

  /**
   * Invalidate cache for a guild (called after config update)
   */
  invalidateCache(guildId: string): void {
    this.cache.delete(guildId);
    logger.debug(`[RuntimeConfig] Cache invalidated for guild ${guildId}`);
  }

  /**
   * Clear all cached configs
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('[RuntimeConfig] All cache cleared');
  }

  /**
   * Notify that config changed - triggers event for listeners
   */
  notifyConfigChange(
    guildId: string,
    field: string,
    oldValue: unknown,
    newValue: unknown,
    actor: string
  ): void {
    // Invalidate cache first
    this.invalidateCache(guildId);

    // Log the change
    logger.info(`[CONFIG][${guildId}] ${field} changed: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)} (by ${actor})`);

    // Emit event for bot services to react
    this.emit('configChange', {
      guildId,
      field,
      oldValue,
      newValue,
      actor,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Subscribe to config changes
   */
  onConfigChange(callback: (change: {
    guildId: string;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    actor: string;
    timestamp: string;
  }) => void): void {
    this.on('configChange', callback);
  }

  /**
   * Get merged personality for a guild (base + overrides)
   */
  async getGuildPersonality(guildId: string): Promise<typeof botPersonality> {
    const config = await this.getGuildConfig(guildId);

    if (!config.personalityOverrides) {
      return botPersonality;
    }

    // Deep merge base personality with overrides
    return this.deepMerge(
      JSON.parse(JSON.stringify(botPersonality)),
      config.personalityOverrides
    );
  }

  /**
   * Deep merge helper
   */
  private deepMerge<T extends Record<string, unknown>>(base: T, overrides: Partial<T>): T {
    const result = { ...base };

    for (const key of Object.keys(overrides) as Array<keyof T>) {
      const overrideValue = overrides[key];
      const baseValue = base[key];

      if (
        overrideValue !== null &&
        typeof overrideValue === 'object' &&
        !Array.isArray(overrideValue) &&
        baseValue !== null &&
        typeof baseValue === 'object' &&
        !Array.isArray(baseValue)
      ) {
        result[key] = this.deepMerge(
          baseValue as Record<string, unknown>,
          overrideValue as Record<string, unknown>
        ) as T[keyof T];
      } else if (overrideValue !== undefined) {
        result[key] = overrideValue as T[keyof T];
      }
    }

    return result;
  }
}

// Singleton export
export const runtimeConfig = new RuntimeConfigManagerClass();
