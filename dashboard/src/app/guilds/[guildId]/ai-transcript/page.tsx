'use client'

import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
    Loader2, Bot, User, Clock, Sparkles,
    Wifi, WifiOff, Zap, MessageSquare, RefreshCw,
    ArrowDown, Mic, MessageCircle
} from 'lucide-react'
import { useGuildConfigWebSocket, ConfigChangeEvent } from '@/lib/useConfigWebSocket'
import { STALE_TIMES } from '@/lib/queryConfig'

interface AiInteraction {
    id: string
    guildId: string
    channelId: string | null
    userId: string | null
    userName: string | null
    messageId: string | null
    botMessageId: string | null
    provider: string
    model: string
    type: string
    userMessage: string
    botResponse: string
    rating: string | null
    feedbackText: string | null
    tags: string[]
    metadata: Record<string, unknown> | null
    createdAt: string
}

interface AiResponsesResponse {
    interactions: AiInteraction[]
    windowMinutes: number
    typeFilter: string
}

type ResponseType = 'all' | 'voice' | 'chat'

export default function AiTranscriptPage() {
    const { guildId } = useParams()
    const queryClient = useQueryClient()
    const [minutes, setMinutes] = useState(60)
    const [responseType, setResponseType] = useState<ResponseType>('all')
    const [autoScroll, setAutoScroll] = useState(true)
    const [realtimeCount, setRealtimeCount] = useState(0)
    const [showScrollButton, setShowScrollButton] = useState(false)
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)

    // Handle real-time updates via WebSocket
    const handleLog = useCallback((event: ConfigChangeEvent) => {
        // Refresh on any log event (AI responses are logged)
        if (event.type === 'log:created') {
            setRealtimeCount(c => c + 1)
            queryClient.invalidateQueries({
                queryKey: ['ai-responses', guildId],
                refetchType: 'active',
            })
        }
    }, [guildId, queryClient])

    // WebSocket for instant updates
    const { isConnected } = useGuildConfigWebSocket(guildId as string, {
        onLog: handleLog,
    })

    const queryKey = useMemo(() =>
        ['ai-responses', guildId, minutes, responseType],
        [guildId, minutes, responseType]
    )

    const { data, isLoading, isFetching, dataUpdatedAt } = useQuery<AiResponsesResponse>({
        queryKey,
        queryFn: () => {
            const params = new URLSearchParams({
                minutes: String(minutes),
                limit: '100',
                type: responseType,
            })
            return api.get(`/api/guilds/${guildId}/ai-responses?${params.toString()}`)
        },
        staleTime: STALE_TIMES.transcripts,
        refetchInterval: isConnected ? 30000 : 10000, // Slower polling when connected
        placeholderData: (prev) => prev,
    })

    // Handle scroll detection
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
            setShowScrollButton(!isNearBottom)
            if (isNearBottom) setAutoScroll(true)
        }

        container.addEventListener('scroll', handleScroll)
        return () => container.removeEventListener('scroll', handleScroll)
    }, [])

    // Auto-scroll on new data
    useEffect(() => {
        if (!autoScroll || !bottomRef.current) return

        requestAnimationFrame(() => {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
        })
    }, [dataUpdatedAt, autoScroll])

    const scrollToBottom = () => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
        setAutoScroll(true)
    }

    // Memoize interactions to prevent unnecessary re-renders
    const interactions = useMemo(() => data?.interactions ?? [], [data?.interactions])

    // Count by type for display
    const typeCounts = useMemo(() => {
        const counts = { all: 0, voice: 0, chat: 0 }
        for (const i of interactions) {
            counts.all++
            if (i.type === 'voice') counts.voice++
            else if (i.type === 'chat') counts.chat++
        }
        return counts
    }, [interactions])

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
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-purple-500/20">
                            <Bot className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">AI Transcript</h1>
                            <p className="text-sm text-muted-foreground">
                                Live view of AI conversations and responses
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {/* Real-time indicator */}
                    <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${isConnected
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                        }`}>
                        <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-zinc-500'}`} />
                        {isConnected ? 'Live' : 'Polling'}
                    </div>
                    {isFetching && !isLoading && (
                        <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                    )}
                </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 backdrop-blur-sm">
                {/* Type Filter - Segmented Control */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">Response Type</label>
                    <div className="flex rounded-lg border border-zinc-700 bg-zinc-800/50 p-1">
                        <button
                            onClick={() => setResponseType('all')}
                            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${responseType === 'all'
                                    ? 'bg-primary text-white shadow-sm'
                                    : 'text-zinc-400 hover:text-zinc-200'
                                }`}
                        >
                            <MessageSquare className="h-4 w-4" />
                            All
                        </button>
                        <button
                            onClick={() => setResponseType('voice')}
                            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${responseType === 'voice'
                                    ? 'bg-green-500 text-white shadow-sm'
                                    : 'text-zinc-400 hover:text-zinc-200'
                                }`}
                        >
                            <Mic className="h-4 w-4" />
                            Voice
                        </button>
                        <button
                            onClick={() => setResponseType('chat')}
                            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${responseType === 'chat'
                                    ? 'bg-blue-500 text-white shadow-sm'
                                    : 'text-zinc-400 hover:text-zinc-200'
                                }`}
                        >
                            <MessageCircle className="h-4 w-4" />
                            Text
                        </button>
                    </div>
                </div>

                {/* Time Window */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">Time Window</label>
                    <select
                        value={minutes}
                        onChange={(e) => setMinutes(parseInt(e.target.value))}
                        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none transition-colors"
                    >
                        <option value={30}>Last 30 min</option>
                        <option value={60}>Last 1 hour</option>
                        <option value={180}>Last 3 hours</option>
                        <option value={720}>Last 12 hours</option>
                        <option value={1440}>Last 24 hours</option>
                    </select>
                </div>

                <div className="ml-auto flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                        {interactions.length} conversation{interactions.length !== 1 ? 's' : ''}
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
            {interactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800/50">
                        {responseType === 'voice' ? (
                            <Mic className="h-8 w-8 text-zinc-500" />
                        ) : responseType === 'chat' ? (
                            <MessageCircle className="h-8 w-8 text-zinc-500" />
                        ) : (
                            <MessageSquare className="h-8 w-8 text-zinc-500" />
                        )}
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-300">
                            No {responseType === 'voice' ? 'Voice' : responseType === 'chat' ? 'Text' : 'AI'} Conversations Yet
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground max-w-md">
                            {responseType === 'voice'
                                ? 'When the bot speaks in voice channels, the conversations will appear here.'
                                : responseType === 'chat'
                                    ? 'When the bot responds to text messages, the conversations will appear here.'
                                    : 'When the bot responds to messages or speaks in voice chat, the conversations will appear here in real-time.'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="relative">
                    <div
                        ref={containerRef}
                        className="max-h-[600px] space-y-4 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 scroll-smooth"
                    >
                        {interactions.map((interaction, index) => {
                            const createdAt = new Date(interaction.createdAt)
                            const timeLabel = createdAt.toLocaleTimeString(undefined, {
                                hour: '2-digit',
                                minute: '2-digit',
                            })
                            const isNew = index === interactions.length - 1 && realtimeCount > 0
                            const isVoice = interaction.type === 'voice'

                            return (
                                <div
                                    key={interaction.id}
                                    className={`space-y-3 rounded-xl p-4 transition-all duration-300 ${isNew
                                        ? 'bg-primary/5 border border-primary/20 animate-slide-up'
                                        : 'bg-zinc-900/70 border border-zinc-800/50 hover:border-zinc-700/50'
                                        }`}
                                >
                                    {/* User message */}
                                    <div className="flex gap-3">
                                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isVoice ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
                                            }`}>
                                            {isVoice ? <Mic className="h-4 w-4" /> : <User className="h-4 w-4" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm font-medium text-zinc-200">
                                                    {interaction.userName || 'User'}
                                                </span>
                                                <span className="text-xs text-zinc-500">{timeLabel}</span>
                                                {/* Type badge */}
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${isVoice
                                                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                                        : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                    }`}>
                                                    {isVoice ? 'Voice' : 'Text'}
                                                </span>
                                                {isNew && (
                                                    <span className="inline-flex items-center gap-1 text-xs text-primary">
                                                        <Zap className="h-3 w-3" />
                                                        New
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-zinc-300 break-words whitespace-pre-wrap">
                                                {interaction.userMessage}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Divider */}
                                    <div className="flex items-center gap-2 px-11">
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-zinc-700 to-transparent" />
                                    </div>

                                    {/* AI Response */}
                                    <div className="flex gap-3">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/30 to-purple-600/30 text-purple-400">
                                            <Sparkles className="h-4 w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm font-medium bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">
                                                    Mr. Handi WC
                                                </span>
                                                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
                                                    {interaction.model}
                                                </span>
                                            </div>
                                            <p className="text-sm text-zinc-100 break-words whitespace-pre-wrap leading-relaxed">
                                                {interaction.botResponse}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                        <div ref={bottomRef} />
                    </div>

                    {/* Scroll to bottom button */}
                    {showScrollButton && (
                        <button
                            onClick={scrollToBottom}
                            className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 hover:shadow-xl"
                        >
                            <ArrowDown className="h-4 w-4" />
                            Scroll to latest
                        </button>
                    )}
                </div>
            )}

            {/* Status bar */}
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-zinc-400">
                        <Clock className="h-4 w-4" />
                        <span>Showing last {minutes} minutes</span>
                    </div>
                    <div className="h-4 w-px bg-zinc-700" />
                    <div className="flex items-center gap-3 text-xs">
                        <span className={`flex items-center gap-1.5 ${responseType === 'all' ? 'text-primary' : 'text-zinc-500'}`}>
                            <MessageSquare className="h-3.5 w-3.5" />
                            All
                        </span>
                        <span className={`flex items-center gap-1.5 ${responseType === 'voice' ? 'text-green-400' : 'text-zinc-500'}`}>
                            <Mic className="h-3.5 w-3.5" />
                            Voice
                        </span>
                        <span className={`flex items-center gap-1.5 ${responseType === 'chat' ? 'text-blue-400' : 'text-zinc-500'}`}>
                            <MessageCircle className="h-3.5 w-3.5" />
                            Text
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isConnected ? (
                        <div className="flex items-center gap-2 text-green-400">
                            <Wifi className="h-4 w-4" />
                            <span>Connected</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-zinc-500">
                            <WifiOff className="h-4 w-4" />
                            <span>Reconnecting...</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
