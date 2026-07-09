import { getPrismaClient } from '../../db/client';
import { logger } from '../../utils/logger';

export type AiInteractionType = 'chat' | 'voice';

interface CreateInteractionData {
    guildId: string;
    channelId?: string;
    userId?: string;
    userName?: string;
    messageId?: string;
    botMessageId?: string;
    provider: string;
    model: string;
    type: AiInteractionType | string;
    userMessage: string;
    botResponse: string;
    metadata?: Record<string, unknown>;
}

export class AiInteractionRepository {
    private db = getPrismaClient();

    async createInteraction(data: CreateInteractionData): Promise<void> {
        try {
            await this.db.$executeRaw`
                INSERT INTO ai_interactions (
                    id,
                    "guildId",
                    "channelId",
                    "userId",
                    "userName",
                    "messageId",
                    "botMessageId",
                    provider,
                    model,
                    type,
                    "userMessage",
                    "botResponse",
                    rating,
                    "feedbackText",
                    tags,
                    metadata,
                    "createdAt",
                    "updatedAt"
                ) VALUES (
                    gen_random_uuid(),
                    ${data.guildId},
                    ${data.channelId ?? null},
                    ${data.userId ?? null},
                    ${data.userName ?? null},
                    ${data.messageId ?? null},
                    ${data.botMessageId ?? null},
                    ${data.provider},
                    ${data.model},
                    ${data.type},
                    ${data.userMessage},
                    ${data.botResponse},
                    null,
                    null,
                    ARRAY[]::text[],
                    ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb,
                    NOW(),
                    NOW()
                )
            `;
        } catch (error) {
            logger.error('Failed to create AI interaction:', error);
        }
    }
}

export const aiInteractionRepository = new AiInteractionRepository();
