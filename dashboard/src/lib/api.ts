const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface FetchOptions extends RequestInit {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const config: RequestInit = {
      ...options,
      credentials: 'include', // Include cookies
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    if (options.body && typeof options.body !== 'string') {
      config.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body });
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const api = new ApiClient(API_BASE);

// Types for API responses
export interface User {
  id: string;
  username: string;
  avatar: string | null;
}

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
}

export interface AuthResponse {
  user: User;
  guilds: Guild[];
}

export interface GuildConfig {
  guildId: string;
  guildName: string;
  guildIcon: string | null;

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
  personalityOverrides: Record<string, unknown> | null;
  allowedChannelIds: string[];
  logChannelId: string | null;
}

export interface ActivityLog {
  id: string;
  guildId: string;
  channelId: string | null;
  userId: string | null;
  userName: string | null;
  type: string;
  severity: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  model: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  createdAt: string;
}

export interface MetricsSummary {
  messagesCount: number;
  commandsCount: number;
  voiceMinutes: number;
  aiRequestsCount: number;
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  errorsCount: number;
  avgLatencyMs: number | null;
}

// TTS/ElevenLabs Usage Types
export interface TtsSessionStats {
  totalCharacters: number;
  totalRequests: number;
  sessionCharacters: number;
  sessionRequests: number;
  lastRequestCharacters: number;
  lastRequestId: string | null;
  estimatedCostUsd: number;
}

export interface TtsSubscriptionInfo {
  characterCount: number;
  characterLimit: number;
  tier: string;
  canExtendCharacterLimit: boolean;
  nextCharacterCountResetUnix: number;
}

export interface TtsUsageResponse {
  enabled: boolean;
  session: TtsSessionStats;
  subscription: TtsSubscriptionInfo | null;
  timestamp: string;
}

export interface TtsVoice {
  voice_id: string;
  name: string;
}
