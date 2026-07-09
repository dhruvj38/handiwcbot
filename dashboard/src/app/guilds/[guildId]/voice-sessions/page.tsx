'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import styles from './voice-sessions.module.css'

interface VoiceSession {
    id: string
    serverId: string
    channelId: string
    channelName: string | null
    startedAt: string
    endedAt: string | null
    isActive: boolean
    participantCount: number
    totalMessages: number
}

interface TranscriptChunk {
    id: string
    userId: string | null
    userName: string | null
    startedAt: string
    endedAt: string
    rawText: string
}

interface SessionsByDay {
    byDay: Record<string, VoiceSession[]>
    totalSessions: number
    daysRange: number
}

async function fetchSessionsByDay(guildId: string, days = 30): Promise<SessionsByDay> {
    const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/guilds/${guildId}/voice-sessions/by-day?days=${days}`,
        { credentials: 'include' }
    )
    if (!res.ok) throw new Error('Failed to fetch sessions')
    return res.json()
}

async function fetchSessionDetails(guildId: string, sessionId: string): Promise<{ session: VoiceSession & { transcriptChunks: TranscriptChunk[] } }> {
    const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/guilds/${guildId}/voice-sessions/${sessionId}`,
        { credentials: 'include' }
    )
    if (!res.ok) throw new Error('Failed to fetch session details')
    return res.json()
}

function formatDuration(startedAt: string, endedAt: string | null): string {
    const start = new Date(startedAt).getTime()
    const end = endedAt ? new Date(endedAt).getTime() : Date.now()
    const durationMs = end - start

    const seconds = Math.floor(durationMs / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`
    }
    return `${seconds}s`
}

function formatTime(dateStr: string): string {
    const date = new Date(dateStr)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
        return 'Today'
    }
    if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday'
    }

    return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function VoiceSessionsPage() {
    const params = useParams()
    const guildId = params.guildId as string
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
    const [daysRange, setDaysRange] = useState(30)

    const { data: sessionsData, isLoading } = useQuery({
        queryKey: ['voice-sessions', guildId, daysRange],
        queryFn: () => fetchSessionsByDay(guildId, daysRange),
        refetchInterval: 30000, // Refresh every 30 seconds
    })

    const { data: sessionDetails, isLoading: isLoadingDetails } = useQuery({
        queryKey: ['voice-session-details', guildId, selectedSessionId],
        queryFn: () => selectedSessionId ? fetchSessionDetails(guildId, selectedSessionId) : null,
        enabled: !!selectedSessionId,
    })

    const sortedDays = useMemo(() => {
        if (!sessionsData?.byDay) return []
        return Object.keys(sessionsData.byDay).sort((a, b) =>
            new Date(b).getTime() - new Date(a).getTime()
        )
    }, [sessionsData])

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loading}>Loading voice sessions...</div>
            </div>
        )
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.titleSection}>
                    <h1 className={styles.title}>Voice Session Transcripts</h1>
                    <p className={styles.subtitle}>
                        {sessionsData?.totalSessions || 0} sessions in the last {daysRange} days
                    </p>
                </div>
                <div className={styles.controls}>
                    <select
                        value={daysRange}
                        onChange={(e) => setDaysRange(parseInt(e.target.value))}
                        className={styles.daySelector}
                    >
                        <option value={7}>Last 7 days</option>
                        <option value={14}>Last 14 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={60}>Last 60 days</option>
                        <option value={90}>Last 90 days</option>
                    </select>
                </div>
            </header>

            <div className={styles.content}>
                {/* Session List */}
                <div className={styles.sessionList}>
                    {sortedDays.length === 0 ? (
                        <div className={styles.empty}>
                            <span className={styles.emptyIcon}>🎙️</span>
                            <p>No voice sessions recorded yet</p>
                            <p className={styles.emptyHint}>Sessions will appear here when the bot joins a voice channel</p>
                        </div>
                    ) : (
                        sortedDays.map(dateKey => (
                            <div key={dateKey} className={styles.dayGroup}>
                                <h2 className={styles.dayHeader}>{formatDate(dateKey)}</h2>
                                <div className={styles.sessions}>
                                    {sessionsData?.byDay[dateKey]?.map(session => (
                                        <button
                                            key={session.id}
                                            className={`${styles.sessionCard} ${selectedSessionId === session.id ? styles.selected : ''} ${session.isActive ? styles.active : ''}`}
                                            onClick={() => setSelectedSessionId(session.id)}
                                        >
                                            <div className={styles.sessionHeader}>
                                                <span className={styles.channelName}>
                                                    🔊 {session.channelName || 'Unknown Channel'}
                                                </span>
                                                {session.isActive && (
                                                    <span className={styles.liveIndicator}>🔴 LIVE</span>
                                                )}
                                            </div>
                                            <div className={styles.sessionMeta}>
                                                <span className={styles.time}>
                                                    {formatTime(session.startedAt)}
                                                    {session.endedAt && ` - ${formatTime(session.endedAt)}`}
                                                </span>
                                                <span className={styles.duration}>
                                                    ⏱️ {formatDuration(session.startedAt, session.endedAt)}
                                                </span>
                                            </div>
                                            <div className={styles.sessionStats}>
                                                <span>👥 {session.participantCount} participants</span>
                                                <span>💬 {session.totalMessages} messages</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Session Detail View */}
                <div className={styles.detailPanel}>
                    {!selectedSessionId ? (
                        <div className={styles.noSelection}>
                            <span className={styles.noSelectionIcon}>👈</span>
                            <p>Select a session to view the transcript</p>
                        </div>
                    ) : isLoadingDetails ? (
                        <div className={styles.loading}>Loading transcript...</div>
                    ) : sessionDetails?.session ? (
                        <div className={styles.transcriptView}>
                            <div className={styles.transcriptHeader}>
                                <h2>
                                    🔊 {sessionDetails.session.channelName || 'Voice Session'}
                                    {sessionDetails.session.isActive && (
                                        <span className={styles.liveIndicator}>🔴 LIVE</span>
                                    )}
                                </h2>
                                <p className={styles.sessionInfo}>
                                    {new Date(sessionDetails.session.startedAt).toLocaleString()}
                                    {' • '}
                                    {formatDuration(sessionDetails.session.startedAt, sessionDetails.session.endedAt)}
                                    {' • '}
                                    {sessionDetails.session.transcriptChunks.length} transcript segments
                                </p>
                            </div>
                            <div className={styles.transcriptContent}>
                                {sessionDetails.session.transcriptChunks.length === 0 ? (
                                    <p className={styles.noTranscripts}>No transcripts available for this session</p>
                                ) : (
                                    sessionDetails.session.transcriptChunks.map(chunk => (
                                        <div key={chunk.id} className={styles.transcriptChunk}>
                                            <div className={styles.chunkHeader}>
                                                <span className={styles.userName}>
                                                    {chunk.userName || `User ${chunk.userId?.slice(0, 8)}` || 'Unknown'}
                                                </span>
                                                <span className={styles.chunkTime}>
                                                    {formatTime(chunk.startedAt)}
                                                </span>
                                            </div>
                                            <p className={styles.chunkText}>{chunk.rawText}</p>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className={styles.error}>Failed to load session details</div>
                    )}
                </div>
            </div>
        </div>
    )
}
