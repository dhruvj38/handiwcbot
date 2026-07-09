import { runtimeConfig } from '../RuntimeConfigManager';
import { config as staticConfig } from '../../config';
import { logger } from '../../utils/logger';

export type ModelUsage = 'chat' | 'analysis' | 'embeddings' | 'voice_chat';

export interface ResolvedModelConfig {
    provider: 'google' | 'openai';
    model: string;
    temperature: number;
    maxTokens: number;
}

export class ModelRouter {
    async resolve(guildId: string | null | undefined, usage: ModelUsage): Promise<ResolvedModelConfig> {
        let provider: 'google' | 'openai';
        let model: string;
        let temperature: number;
        let maxTokens: number;

        if (guildId) {
            try {
                const cfg = await runtimeConfig.getGuildConfig(guildId);

                temperature = cfg.aiTemperature ?? staticConfig.ai.temperature;
                maxTokens = cfg.aiMaxTokens ?? staticConfig.ai.maxTokens;

                switch (usage) {
                    case 'chat':
                        provider = cfg.aiChatProvider ?? staticConfig.ai.providers.chat;
                        model = cfg.aiModel ?? staticConfig.ai.models.chat;
                        break;
                    case 'analysis':
                        provider = cfg.aiAnalysisProvider ?? cfg.aiChatProvider ?? staticConfig.ai.providers.chat;
                        model = cfg.aiModelAnalysis ?? staticConfig.ai.models.analysis;
                        break;
                    case 'embeddings':
                        provider = cfg.aiEmbeddingsProvider ?? 'google';
                        model = cfg.aiModelEmbeddings ?? staticConfig.ai.models.embeddings;
                        // Embeddings usually ignore temperature/maxTokens but we keep them consistent
                        break;
                    case 'voice_chat':
                        provider = cfg.aiChatProvider ?? staticConfig.ai.providers.chat;
                        model = cfg.aiModel ?? staticConfig.ai.models.chat;
                        break;
                }
            } catch (err) {
                logger.warn('ModelRouter fell back to static config due to error loading runtime config', err);
                return this.fallback(usage);
            }
        } else {
            return this.fallback(usage);
        }

        // Provider safety: if OpenAI selected but API key missing, fall back to Gemini
        if (provider === 'openai' && !staticConfig.ai.openaiApiKey) {
            logger.warn(`ModelRouter: OpenAI selected for ${usage} but OPENAI_API_KEY is missing. Falling back to Google.`);
            provider = 'google';
            if (usage === 'chat' || usage === 'voice_chat') {
                model = staticConfig.ai.models.chat;
            } else if (usage === 'analysis') {
                model = staticConfig.ai.models.analysis;
            } else {
                model = staticConfig.ai.models.embeddings;
            }
        }

        return { provider, model, temperature, maxTokens };
    }

    private fallback(usage: ModelUsage): ResolvedModelConfig {
        const temperature = staticConfig.ai.temperature;
        const maxTokens = staticConfig.ai.maxTokens;

        if (usage === 'analysis') {
            return {
                provider: staticConfig.ai.providers.chat,
                model: staticConfig.ai.models.analysis,
                temperature,
                maxTokens,
            };
        }

        if (usage === 'embeddings') {
            return {
                provider: 'google',
                model: staticConfig.ai.models.embeddings,
                temperature,
                maxTokens,
            };
        }

        // chat and voice_chat
        return {
            provider: staticConfig.ai.providers.chat,
            model: staticConfig.ai.models.chat,
            temperature,
            maxTokens,
        };
    }
}

export const modelRouter = new ModelRouter();
