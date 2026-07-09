/**
 * React Query configuration for optimal performance
 * - Aggressive caching for fast page loads
 * - Optimistic updates for instant UI feedback
 * - Configurable refresh intervals
 */

import { QueryClient } from '@tanstack/react-query'

// Default refresh intervals (in ms) - can be overridden per-guild
export const DEFAULT_REFRESH_INTERVALS = {
  config: 60000,        // Guild config - 1 min (real-time via WebSocket anyway)
  metrics: 30000,       // Metrics - 30 sec
  logs: 10000,          // Activity logs - 10 sec
  transcripts: 0,       // Transcripts - real-time via WebSocket (0 = disabled)
  analytics: 60000,     // Analytics - 1 min
  ttsUsage: 15000,      // TTS usage - 15 sec
  voices: 300000,       // TTS voices list - 5 min (rarely changes)
  channels: 300000,     // Discord channels - 5 min
  env: 0,               // Env vars - only on demand
} as const

// Stale times - how long data is considered fresh
export const STALE_TIMES = {
  config: 5000,         // Config fresh for 5 sec
  metrics: 10000,       // Metrics fresh for 10 sec
  logs: 5000,           // Logs fresh for 5 sec
  transcripts: 1000,    // Transcripts fresh for 1 sec
  analytics: 30000,     // Analytics fresh for 30 sec
  ttsUsage: 5000,       // TTS usage fresh for 5 sec
  voices: 300000,       // Voices fresh for 5 min
  channels: 60000,      // Channels fresh for 1 min
  env: 60000,           // Env fresh for 1 min
} as const

// Create optimized query client
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Keep data in cache for 5 minutes
        gcTime: 5 * 60 * 1000,
        // Data is fresh for 30 seconds by default
        staleTime: 30 * 1000,
        // Retry failed requests 2 times
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
        // Refetch on window focus for fresh data
        refetchOnWindowFocus: true,
        // Don't refetch on reconnect (WebSocket handles this)
        refetchOnReconnect: false,
      },
      mutations: {
        // Retry mutations once
        retry: 1,
      },
    },
  })
}

// Storage key for user preferences
const REFRESH_PREFS_KEY = 'dashboard_refresh_intervals'

// Get user's preferred refresh intervals
export function getRefreshIntervals(): typeof DEFAULT_REFRESH_INTERVALS {
  if (typeof window === 'undefined') return DEFAULT_REFRESH_INTERVALS
  
  try {
    const stored = localStorage.getItem(REFRESH_PREFS_KEY)
    if (stored) {
      return { ...DEFAULT_REFRESH_INTERVALS, ...JSON.parse(stored) }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_REFRESH_INTERVALS
}

// Save user's preferred refresh intervals
export function setRefreshIntervals(intervals: Partial<typeof DEFAULT_REFRESH_INTERVALS>): void {
  if (typeof window === 'undefined') return
  
  try {
    const current = getRefreshIntervals()
    localStorage.setItem(REFRESH_PREFS_KEY, JSON.stringify({ ...current, ...intervals }))
  } catch {
    // Ignore storage errors
  }
}

// Query key factories for consistent keys
export const queryKeys = {
  // Guild queries
  guildConfig: (guildId: string) => ['guild-config', guildId] as const,
  guildMetrics: (guildId: string, period?: string) => ['guild-metrics', guildId, period] as const,
  guildLogs: (guildId: string, filters?: string) => ['logs', guildId, filters] as const,
  guildTranscripts: (guildId: string, channelId?: string, minutes?: number) => 
    ['transcripts', guildId, channelId, minutes] as const,
  guildChannels: (guildId: string) => ['guild-channels', guildId] as const,
  guildAnalytics: (guildId: string) => ['analytics', guildId] as const,
  
  // Global queries
  env: () => ['env'] as const,
  ttsVoices: () => ['tts-voices'] as const,
  ttsUsage: () => ['tts-usage'] as const,
  guilds: () => ['guilds'] as const,
}

// Prefetch functions for navigation
export async function prefetchGuildData(queryClient: QueryClient, guildId: string): Promise<void> {
  const intervals = getRefreshIntervals()
  
  // Prefetch config (most important)
  await queryClient.prefetchQuery({
    queryKey: queryKeys.guildConfig(guildId),
    staleTime: STALE_TIMES.config,
  })
  
  // Prefetch channels for settings
  await queryClient.prefetchQuery({
    queryKey: queryKeys.guildChannels(guildId),
    staleTime: STALE_TIMES.channels,
  })
}
