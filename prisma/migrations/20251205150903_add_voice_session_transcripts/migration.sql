-- AlterTable
ALTER TABLE "transcript_chunks" ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "voice_session_transcripts" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_session_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_session_transcripts_serverId_startedAt_idx" ON "voice_session_transcripts"("serverId", "startedAt");

-- CreateIndex
CREATE INDEX "voice_session_transcripts_serverId_isActive_idx" ON "voice_session_transcripts"("serverId", "isActive");

-- CreateIndex
CREATE INDEX "transcript_chunks_sessionId_idx" ON "transcript_chunks"("sessionId");

-- AddForeignKey
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "voice_session_transcripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
