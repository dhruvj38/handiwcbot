

export interface ServerMemoryData {
    id: string;
    serverId: string;
    type: 'event' | 'meme' | 'rule' | 'habit' | 'plan';
    title: string;
    content: string;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserProfileData {
    id: string;
    serverId: string;
    userId: string;
    displayName: string;
    preferredNickname?: string | null; // User's preferred nickname (bot learns/user sets)
    summary: string;
    tags: string[];
    embedding?: number[];
    metadata?: Record<string, unknown>;
    lastUpdated: Date;
    createdAt: Date;
}

export interface TranscriptChunkData {
    id: string;
    serverId: string;
    channelId: string;
    userId: string | null;
    startedAt: Date;
    endedAt: Date;
    rawText: string;
    metadata?: Record<string, unknown>;
    createdAt: Date;
    sessionId?: string | null;
}

export interface VoiceSessionTranscriptData {
    id: string;
    serverId: string;
    channelId: string;
    channelName?: string | null;
    startedAt: Date;
    endedAt?: Date | null;
    isActive: boolean;
    participantCount: number;
    totalMessages: number;
    createdAt: Date;
    updatedAt: Date;
    transcriptChunks?: TranscriptChunkData[];
}

export interface SessionSummaryData {
    id: string;
    serverId: string;
    channelId: string;
    timeRangeStart: Date;
    timeRangeEnd: Date;
    summaryText: string;
    embedding?: number[];
    metadata?: SessionSummaryMetadata;
    createdAt: Date;
}

export interface SessionSummaryMetadata {
    events?: string[];
    plans?: string[];
    memes?: string[];
    userInsights?: Record<string, string>;
}

export interface ChatContext {
    serverId: string;
    channelId: string;
    userMessage: string;
    userId: string;
    userName: string;
    recentMessages: {
        userId: string;
        userName: string;
        content: string;
        timestamp: Date;
    }[];
    serverMemories: ServerMemoryData[];
    userProfiles: UserProfileData[];
    sessionSummaries: SessionSummaryData[];
    instructions?: string;
    /** Realtime learning context - trending slang, phrases, style notes */
    realtimeContext?: string;
    /** Users mentioned in the message (potential roast targets) */
    mentionedUsers?: {
        userId: string;
        userName: string;
        displayName?: string;
    }[];
    /** Image/attachment URLs in the message for vision analysis */
    imageUrls?: string[];
    temporalSummary?: {
        label: string;
        start: Date;
        end: Date;
        summary: string;
    };
}

export interface SessionSummaryDraft {
    highLevelSummary: string;
    events: string[];
    plans: string[];
    memes: string[];
    userInsights: Record<string, string>;
}

export interface VoiceSession {
    serverId: string;
    channelId: string;
    startedAt: Date;
    isActive: boolean;
    lastSummaryAt: Date;
    activeUntil?: Date;
    // Add other properties if needed by VoiceSessionManager
}

export interface AudioChunk {
    userId: string;
    buffer: Buffer;
    startedAt: Date;
    endedAt: Date;
}

export interface TranscriptionResult {
    text: string;
    confidence?: number;
}
