-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "server_memories" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tags" TEXT[],
    "embedding" vector(1536),
    "metadata" JSONB,
    "last_updated" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_chunks" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "user_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "raw_text" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_summaries" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "time_range_start" TIMESTAMP(3) NOT NULL,
    "time_range_end" TIMESTAMP(3) NOT NULL,
    "summary_text" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "server_memories_server_id_idx" ON "server_memories"("server_id");

-- CreateIndex
CREATE INDEX "server_memories_type_idx" ON "server_memories"("type");

-- CreateIndex
CREATE INDEX "user_profiles_server_id_idx" ON "user_profiles"("server_id");

-- CreateIndex
CREATE INDEX "user_profiles_user_id_idx" ON "user_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_server_id_user_id_key" ON "user_profiles"("server_id", "user_id");

-- CreateIndex
CREATE INDEX "transcript_chunks_server_id_channel_id_started_at_idx" ON "transcript_chunks"("server_id", "channel_id", "started_at");

-- CreateIndex
CREATE INDEX "transcript_chunks_user_id_idx" ON "transcript_chunks"("user_id");

-- CreateIndex
CREATE INDEX "session_summaries_server_id_channel_id_time_range_start_idx" ON "session_summaries"("server_id", "channel_id", "time_range_start");
