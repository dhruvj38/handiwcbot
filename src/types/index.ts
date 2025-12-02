

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
