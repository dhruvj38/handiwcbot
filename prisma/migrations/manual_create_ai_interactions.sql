-- Manual migration to create ai_interactions table for logging AI requests/responses
-- Run this SQL against your PostgreSQL database once to enable AiInteractionRepository.

CREATE TABLE IF NOT EXISTS ai_interactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "guildId"      text    NOT NULL,
    "channelId"    text,
    "userId"       text,
    "userName"     text,
    "messageId"    text,
    "botMessageId" text,
    provider        text    NOT NULL,
    model           text    NOT NULL,
    type            text    NOT NULL,
    "userMessage"  text    NOT NULL,
    "botResponse"  text    NOT NULL,
    rating          text,
    "feedbackText" text,
    tags            text[]  NOT NULL DEFAULT ARRAY[]::text[],
    metadata        jsonb,
    "createdAt"    timestamptz NOT NULL DEFAULT now(),
    "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

-- Indexes matching prisma.schema (@@index mappings)
CREATE INDEX IF NOT EXISTS "ai_interactions_guildId_createdAt_idx"
    ON ai_interactions ("guildId", "createdAt");

CREATE INDEX IF NOT EXISTS "ai_interactions_guildId_channelId_createdAt_idx"
    ON ai_interactions ("guildId", "channelId", "createdAt");
