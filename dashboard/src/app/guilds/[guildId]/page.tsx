'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, GuildConfig, MetricsSummary, TtsUsageResponse } from '@/lib/api'
import React, { useEffect, useRef, useMemo } from 'react'
import { 
  Loader2, MessageSquare, Mic, Brain, 
  AlertTriangle, Clock, Coins, Volume2, Wifi, WifiOff
} from 'lucide-react'
import { useGuildConfigWebSocket } from '@/lib/useConfigWebSocket'
import { STALE_TIMES, DEFAULT_REFRESH_INTERVALS } from '@/lib/queryConfig'

interface ConfigResponse {
  config: GuildConfig
}

interface MetricsResponse {
  metrics: MetricsSummary
}

export default function GuildOverviewPage() {
  const { guildId } = useParams()

  const { isConnected } = useGuildConfigWebSocket(guildId as string)

  // Guild config - real-time via WebSocket, polling disabled when connected
  const { data: configData, isLoading: configLoading } = useQuery<ConfigResponse>({
    queryKey: ['guild-config', guildId],
    queryFn: () => api.get(`/api/guilds/${guildId}/config`),
    staleTime: STALE_TIMES.config,
    refetchInterval: isConnected ? false : DEFAULT_REFRESH_INTERVALS.config,
    placeholderData: (prev) => prev, // Keep old data while fetching
  })

  // Metrics - polling at configured interval
  const { data: metricsData, isLoading: metricsLoading } = useQuery<MetricsResponse>({
    queryKey: ['guild-metrics', guildId],
    queryFn: () => api.get(`/api/guilds/${guildId}/metrics?period=7d`),
    staleTime: STALE_TIMES.metrics,
    refetchInterval: DEFAULT_REFRESH_INTERVALS.metrics,
    placeholderData: (prev) => prev,
  })

  // TTS usage - fast polling for live updates
  const { data: ttsUsage } = useQuery<TtsUsageResponse>({
    queryKey: ['tts-usage'],
    queryFn: () => api.get('/api/tts/usage'),
    staleTime: STALE_TIMES.ttsUsage,
    refetchInterval: DEFAULT_REFRESH_INTERVALS.ttsUsage,
    placeholderData: (prev) => prev,
  })

  const previousConfigRef = useRef<GuildConfig | null>(null)
  const previousMetricsRef = useRef<MetricsSummary | null>(null)

  useEffect(() => {
    if (!configData?.config) return

    const prev = previousConfigRef.current
    const next = configData.config

    if (prev) {
      const changed: Record<string, { from: unknown; to: unknown }> = {}

      const keys: Array<keyof GuildConfig> = [
        'learningEnabled',
        'voiceEnabled',
        'ttsEnabled',
        'autoJoinEnabled',
        'chimeInEnabled',
        'aiModel',
        'aiTemperature',
        'aiMaxTokens',
        'ttsVoice',
        'minMembersToJoin',
        'chimeInChance',
      ]

      for (const key of keys) {
        if (prev[key] !== next[key]) {
          changed[key] = { from: prev[key], to: next[key] }
        }
      }

      if (Object.keys(changed).length > 0) {
        console.log('[Dashboard][Overview] Config changed', { guildId, changed })
      }
    }

    previousConfigRef.current = next
  }, [configData?.config, guildId])

  useEffect(() => {
    if (!metricsData?.metrics) return

    const prev = previousMetricsRef.current
    const next = metricsData.metrics

    if (prev) {
      const changed: Record<string, { from: number | null; to: number | null }> = {}

      const keys: Array<keyof MetricsSummary> = [
        'messagesCount',
        'aiRequestsCount',
        'errorsCount',
        'promptTokens',
        'outputTokens',
        'estimatedCostUsd',
      ]

      for (const key of keys) {
        if (prev[key] !== next[key]) {
          changed[key] = { from: prev[key] ?? null, to: next[key] ?? null }
        }
      }

      if (Object.keys(changed).length > 0) {
        console.log('[Dashboard][Overview] Metrics changed', { guildId, changed })
      }
    }

    previousMetricsRef.current = next
  }, [metricsData?.metrics, guildId])

  if (configLoading || metricsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const config = configData?.config
  const metrics = metricsData?.metrics

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{config?.guildName || 'Server'}</h1>
        <p className="text-muted-foreground">Overview and quick stats</p>
      </div>

      {/* Feature Status (read-only overview - edit on dedicated pages) */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatusCard
          title="Learning"
          enabled={config?.learningEnabled ?? true}
          icon={Brain}
          href="learning"
        />
        <StatusCard
          title="Voice"
          enabled={config?.voiceEnabled ?? true}
          icon={Mic}
          href="voice"
        />
        <StatusCard
          title="TTS"
          enabled={config?.ttsEnabled ?? false}
          icon={MessageSquare}
          href="voice"
        />
        <StatusCard
          title="Auto-Join"
          enabled={config?.autoJoinEnabled ?? true}
          icon={Mic}
          href="voice"
        />
      </div>

      {/* Metrics */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Last 7 Days</h2>
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard
            title="Messages"
            value={metrics?.messagesCount ?? 0}
            icon={MessageSquare}
          />
          <MetricCard
            title="AI Requests"
            value={metrics?.aiRequestsCount ?? 0}
            icon={Brain}
          />
          <MetricCard
            title="Errors"
            value={metrics?.errorsCount ?? 0}
            icon={AlertTriangle}
            variant={metrics?.errorsCount && metrics.errorsCount > 0 ? 'warning' : 'default'}
          />
          <MetricCard
            title="Avg Latency"
            value={metrics?.avgLatencyMs ? `${Math.round(metrics.avgLatencyMs)}ms` : 'N/A'}
            icon={Clock}
          />
        </div>
      </div>

      {/* Token Usage */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Token Usage</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            title="Prompt Tokens"
            value={metrics?.promptTokens?.toLocaleString() ?? 0}
            icon={Brain}
          />
          <MetricCard
            title="Output Tokens"
            value={metrics?.outputTokens?.toLocaleString() ?? 0}
            icon={Brain}
          />
          <MetricCard
            title="Est. Cost"
            value={`$${(metrics?.estimatedCostUsd ?? 0).toFixed(4)}`}
            icon={Coins}
          />
        </div>
      </div>

      {/* TTS Usage (ElevenLabs) */}
      {ttsUsage?.enabled && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">ElevenLabs TTS Usage</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard
              title="Session Requests"
              value={ttsUsage.session.sessionRequests}
              icon={Volume2}
            />
            <MetricCard
              title="Characters Used"
              value={ttsUsage.session.sessionCharacters.toLocaleString()}
              icon={Volume2}
            />
            <MetricCard
              title="Session Cost"
              value={`$${ttsUsage.session.estimatedCostUsd.toFixed(4)}`}
              icon={Coins}
            />
            {ttsUsage.subscription && (
              <MetricCard
                title="Monthly Quota"
                value={`${((ttsUsage.subscription.characterCount / ttsUsage.subscription.characterLimit) * 100).toFixed(0)}%`}
                icon={Volume2}
                variant={(ttsUsage.subscription.characterCount / ttsUsage.subscription.characterLimit) > 0.8 ? 'warning' : 'default'}
              />
            )}
          </div>
        </div>
      )}

      {/* Config Summary */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Current Configuration</h2>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <dl className="grid gap-4 md:grid-cols-2">
            <ConfigItem label="AI Model" value={config?.aiModel ?? 'gemini-2.0-flash'} />
            <ConfigItem label="Temperature" value={String(config?.aiTemperature ?? 0.7)} />
            <ConfigItem label="Max Tokens" value={String(config?.aiMaxTokens ?? 2000)} />
            <ConfigItem label="TTS Voice" value={config?.ttsVoice ?? 'Kore'} />
            <ConfigItem label="Chime-in Chance" value={`${((config?.chimeInChance ?? 0.15) * 100).toFixed(0)}%`} />
            <ConfigItem label="Min Members to Join" value={String(config?.minMembersToJoin ?? 2)} />
          </dl>
        </div>
      </div>
    </div>
  )
}

function StatusCard({ title, enabled, icon: Icon, href }: { 
  title: string
  enabled: boolean
  icon: React.ElementType
  href?: string
}) {
  const content = (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">{title}</span>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium border ${
            enabled 
              ? 'border-green-500/40 bg-green-500/10 text-green-500' 
              : 'border-zinc-600 bg-zinc-800 text-zinc-400'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </div>
    </div>
  )
  
  if (href) {
    return <a href={href}>{content}</a>
  }
  return content
}

function MetricCard({ title, value, icon: Icon, variant = 'default' }: {
  title: string
  value: string | number
  icon: React.ElementType
  variant?: 'default' | 'warning'
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Icon className={`h-4 w-4 ${variant === 'warning' ? 'text-yellow-500' : ''}`} />
        <span className="text-sm">{title}</span>
      </div>
      <p className={`mt-2 text-2xl font-semibold ${variant === 'warning' ? 'text-yellow-500' : ''}`}>
        {value}
      </p>
    </div>
  )
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
