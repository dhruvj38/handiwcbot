'use client'

import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Loader2, Mic, Clock, User, AlertCircle, Wifi, WifiOff, Zap } from 'lucide-react'
import { useGuildConfigWebSocket, ConfigChangeEvent } from '@/lib/useConfigWebSocket'
import { STALE_TIMES } from '@/lib/queryConfig'

interface TranscriptChunk {
  id: string
  serverId: string
  channelId: string
  userId: string | null
  userName?: string | null
  startedAt: string
  endedAt: string
  rawText: string
  metadata?: Record<string, unknown> | null
  createdAt: string
}

interface TranscriptResponse {
  transcripts: TranscriptChunk[]
  windowMinutes: number
}

export default function TranscriptPage() {
  const { guildId } = useParams()
  const queryClient = useQueryClient()
  const [channelId, setChannelId] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [autoScroll, setAutoScroll] = useState(true)
  const [realtimeCount, setRealtimeCount] = useState(0)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Handle real-time transcript updates via WebSocket
  const handleTranscript = useCallback((event: ConfigChangeEvent) => {
    if (event.transcript) {
      setRealtimeCount(c => c + 1)
      // Flash effect handled by CSS
    }
  }, [])

  // WebSocket for instant transcript updates
  const { isConnected } = useGuildConfigWebSocket(guildId as string, {
    onTranscript: handleTranscript,
  })

  const queryKey = useMemo(() =>
    ['transcripts', guildId, channelId, minutes],
    [guildId, channelId, minutes]
  )

  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery<TranscriptResponse>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({
        minutes: String(minutes),
        limit: '200',
      })
      if (channelId.trim()) {
        params.set('channelId', channelId.trim())
      }
      return api.get(`/api/guilds/${guildId}/transcripts?${params.toString()}`)
    },
    // Short stale time - WebSocket triggers refetch on new transcripts
    staleTime: STALE_TIMES.transcripts,
    // Fallback polling at 5s if WebSocket disconnects
    refetchInterval: isConnected ? false : 5000,
    // Keep previous data while fetching new
    placeholderData: (prev) => prev,
  })

  // Auto-scroll on new data
  useEffect(() => {
    if (!autoScroll || !bottomRef.current) return

    // Use requestAnimationFrame for smooth scrolling
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
  }, [dataUpdatedAt, autoScroll])

  // Memoize transcripts to prevent unnecessary re-renders
  const transcripts = useMemo(() => data?.transcripts ?? [], [data?.transcripts])

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Voice Transcript</h1>
            <span title={isConnected ? "Real-time updates active" : "Polling mode (WebSocket disconnected)"}>
              {isConnected ? (
                <Wifi className="h-4 w-4 text-green-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-zinc-500" />
              )}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Live view of what the bot is hearing and transcribing
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Real-time indicator */}
          <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${isConnected
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}>
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-zinc-500'}`} />
            {isConnected ? 'Real-time' : 'Polling'}
          </div>
          {isFetching && !isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Channel ID (optional)</label>
          <input
            type="text"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="Leave blank for all channels"
            className="w-64 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none transition-colors"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Window (minutes)</label>
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(parseInt(e.target.value) || 1)}
            className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none transition-colors"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {transcripts.length} entries
          </span>
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`rounded-lg border px-3 py-2 text-xs transition-colors ${autoScroll
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-zinc-700 text-muted-foreground hover:bg-zinc-800'
              }`}
          >
            {autoScroll ? 'Auto-Scroll On' : 'Auto-Scroll Off'}
          </button>
        </div>
      </div>

      {/* Transcript list */}
      {transcripts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <AlertCircle className="h-6 w-6 text-zinc-500" />
          <p className="text-sm text-muted-foreground">
            No transcripts found for the selected window.
            Make sure the bot is connected to a voice channel.
          </p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="max-h-[560px] space-y-2 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm scroll-smooth"
        >
          {transcripts.map((chunk, index) => {
            const started = new Date(chunk.startedAt)
            const timeLabel = started.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
            const isNew = index === transcripts.length - 1 && realtimeCount > 0

            return (
              <div
                key={chunk.id}
                className={`flex items-start gap-3 rounded-lg px-3 py-2 transition-all duration-300 ${isNew
                    ? 'bg-primary/10 border border-primary/20 animate-slide-up'
                    : 'bg-zinc-900/70 hover:bg-zinc-800/50'
                  }`}
              >
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                  <Mic className="h-4 w-4 text-zinc-300" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeLabel}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {chunk.userName || chunk.userId || 'Unknown'}
                    </span>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                      {chunk.channelId.slice(-6)}
                    </span>
                    {isNew && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Zap className="h-3 w-3" />
                        New
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-100 break-words">
                    {chunk.rawText}
                  </p>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Real-time info */}
      {isConnected && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-300/80">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-green-400" />
            <span>Real-time mode active — transcripts appear instantly via WebSocket</span>
          </div>
        </div>
      )}
    </div>
  )
}
