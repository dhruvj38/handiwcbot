-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "server_memories" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(768),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "preferredNickname" TEXT,
    "summary" TEXT NOT NULL,
    "tags" TEXT[],
    "embedding" vector(768),
    "metadata" JSONB,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_chunks" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "rawText" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_summaries" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "timeRangeStart" TIMESTAMP(3) NOT NULL,
    "timeRangeEnd" TIMESTAMP(3) NOT NULL,
    "summaryText" TEXT NOT NULL,
    "embedding" vector(768),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_interactions" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "messageId" TEXT,
    "botMessageId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "botResponse" TEXT NOT NULL,
    "rating" TEXT,
    "feedbackText" TEXT,
    "tags" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_sessions" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_configs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "guildName" TEXT NOT NULL,
    "guildIcon" TEXT,
    "learningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "voiceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ttsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoJoinEnabled" BOOLEAN NOT NULL DEFAULT true,
    "chimeInEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiModel" TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    "aiModelAnalysis" TEXT NOT NULL DEFAULT 'gemini-2.5-pro-preview-06-05',
    "aiModelEmbeddings" TEXT NOT NULL DEFAULT 'text-embedding-004',
    "aiChatProvider" TEXT NOT NULL DEFAULT 'google',
    "aiAnalysisProvider" TEXT NOT NULL DEFAULT 'google',
    "aiEmbeddingsProvider" TEXT NOT NULL DEFAULT 'google',
    "aiTemperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "aiMaxTokens" INTEGER NOT NULL DEFAULT 2000,
    "ttsVoice" TEXT NOT NULL DEFAULT 'JBFqnCBsd6RMkjVDRZzb',
    "ttsModel" TEXT NOT NULL DEFAULT 'eleven_flash_v2_5',
    "minMembersToJoin" INTEGER NOT NULL DEFAULT 2,
    "chimeInChance" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "minSecondsBetweenChimes" INTEGER NOT NULL DEFAULT 60,
    "maxVoiceResponseLength" INTEGER NOT NULL DEFAULT 200,
    "voiceChunkDurationMs" INTEGER NOT NULL DEFAULT 30000,
    "voiceSummaryIntervalMs" INTEGER NOT NULL DEFAULT 300000,
    "learningBatchSize" INTEGER NOT NULL DEFAULT 20,
    "learningBatchTimeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "learningPersonalityUpdateMs" INTEGER NOT NULL DEFAULT 300000,
    "learningConsolidationMs" INTEGER NOT NULL DEFAULT 3600000,
    "memoryRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "maxMemoriesPerUser" INTEGER NOT NULL DEFAULT 100,
    "memoryRetrievalLimit" INTEGER NOT NULL DEFAULT 10,
    "maxContextMessages" INTEGER NOT NULL DEFAULT 50,
    "botPrefix" TEXT NOT NULL DEFAULT '!',
    "personalityOverrides" JSONB,
    "allowedChannelIds" TEXT[],
    "logChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_audit_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "model" TEXT,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "errorCode" TEXT,
    "stackTrace" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics_snapshots" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "messagesCount" INTEGER NOT NULL DEFAULT 0,
    "commandsCount" INTEGER NOT NULL DEFAULT 0,
    "voiceMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aiRequestsCount" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorsCount" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "logMessageId" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_overrides" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "overrideText" TEXT NOT NULL,
    "learnedRule" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "server_memories_serverId_idx" ON "server_memories"("serverId");

-- CreateIndex
CREATE INDEX "server_memories_type_idx" ON "server_memories"("type");

-- CreateIndex
CREATE INDEX "user_profiles_serverId_idx" ON "user_profiles"("serverId");

-- CreateIndex
CREATE INDEX "user_profiles_userId_idx" ON "user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_serverId_userId_key" ON "user_profiles"("serverId", "userId");

-- CreateIndex
CREATE INDEX "transcript_chunks_serverId_channelId_startedAt_idx" ON "transcript_chunks"("serverId", "channelId", "startedAt");

-- CreateIndex
CREATE INDEX "transcript_chunks_userId_idx" ON "transcript_chunks"("userId");

-- CreateIndex
CREATE INDEX "session_summaries_serverId_channelId_timeRangeStart_idx" ON "session_summaries"("serverId", "channelId", "timeRangeStart");

-- CreateIndex
CREATE INDEX "ai_interactions_guildId_createdAt_idx" ON "ai_interactions"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_interactions_guildId_channelId_createdAt_idx" ON "ai_interactions"("guildId", "channelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_sessions_discordId_key" ON "dashboard_sessions"("discordId");

-- CreateIndex
CREATE INDEX "dashboard_sessions_discordId_idx" ON "dashboard_sessions"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "guild_configs_guildId_key" ON "guild_configs"("guildId");

-- CreateIndex
CREATE INDEX "config_audit_logs_guildId_idx" ON "config_audit_logs"("guildId");

-- CreateIndex
CREATE INDEX "config_audit_logs_createdAt_idx" ON "config_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_guildId_createdAt_idx" ON "activity_logs"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_type_idx" ON "activity_logs"("type");

-- CreateIndex
CREATE INDEX "activity_logs_severity_idx" ON "activity_logs"("severity");

-- CreateIndex
CREATE INDEX "activity_logs_correlationId_idx" ON "activity_logs"("correlationId");

-- CreateIndex
CREATE INDEX "metrics_snapshots_guildId_periodStart_idx" ON "metrics_snapshots"("guildId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_snapshots_guildId_periodStart_key" ON "metrics_snapshots"("guildId", "periodStart");

-- CreateIndex
CREATE INDEX "prompt_logs_guildId_createdAt_idx" ON "prompt_logs"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "prompt_logs_logMessageId_idx" ON "prompt_logs"("logMessageId");

-- CreateIndex
CREATE INDEX "prompt_overrides_guildId_section_idx" ON "prompt_overrides"("guildId", "section");

-- CreateIndex
CREATE INDEX "prompt_overrides_guildId_isActive_idx" ON "prompt_overrides"("guildId", "isActive");
