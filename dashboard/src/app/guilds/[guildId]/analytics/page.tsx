'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, MetricsSummary } from '@/lib/api'
import { useState, useEffect, useRef } from 'react'
import { Loader2, TrendingUp, Users, Brain, MessageSquare, Mic, AlertTriangle } from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts'

interface MetricsResponse {
  metrics: MetricsSummary
}

interface TimeSeriesResponse {
  timeseries: Array<{
    date: string
    messagesCount: number
    aiRequestsCount: number
    errorsCount: number
    promptTokens: number
    outputTokens: number
  }>
}

interface TopUsersResponse {
  users: Array<{
    userId: string
    userName: string
    count: number
  }>
}

const PERIODS = [
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
]

export default function AnalyticsPage() {
  const { guildId } = useParams()
  const [period, setPeriod] = useState('7d')

  const { data: metricsData, isLoading: metricsLoading } = useQuery<MetricsResponse>({
    queryKey: ['metrics', guildId, period],
    queryFn: () => api.get(`/api/guilds/${guildId}/metrics?period=${period}`),
    refetchInterval: 15000,
  })

  const { data: timeseriesData, isLoading: timeseriesLoading } = useQuery<TimeSeriesResponse>({
    queryKey: ['timeseries', guildId, period],
    queryFn: () => api.get(`/api/guilds/${guildId}/metrics/timeseries?period=${period}`),
    refetchInterval: 30000,
  })

  const { data: topUsersData } = useQuery<TopUsersResponse>({
    queryKey: ['top-users', guildId, period],
    queryFn: () => api.get(`/api/guilds/${guildId}/metrics/top-users?period=${period}&limit=10`),
    refetchInterval: 45000,
  })

  const previousMetricsRef = useRef<MetricsSummary | null>(null)
  const previousTimeseriesRef = useRef<TimeSeriesResponse['timeseries']>([])
  const previousTopUsersRef = useRef<TopUsersResponse['users']>([])

  useEffect(() => {
    if (!metricsData?.metrics) return

    const prev = previousMetricsRef.current
    const next = metricsData.metrics

    if (prev) {
      const changed: Record<string, { from: number | null; to: number | null }> = {}

      const keys: Array<keyof MetricsSummary> = [
        'messagesCount',
        'aiRequestsCount',
        'voiceMinutes',
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
        console.log('[Dashboard][Analytics] Metrics changed', { guildId, period, changed })
      }
    }

    previousMetricsRef.current = next
  }, [metricsData?.metrics, guildId, period])

  useEffect(() => {
    const current = timeseriesData?.timeseries ?? []
    const prev = previousTimeseriesRef.current

    if (prev.length > 0 && current.length >= prev.length) {
      const lastPrev = prev[prev.length - 1]
      const lastCurr = current[current.length - 1]

      const changed =
        !lastCurr ||
        lastPrev.date !== lastCurr.date ||
        lastPrev.messagesCount !== lastCurr.messagesCount ||
        lastPrev.aiRequestsCount !== lastCurr.aiRequestsCount ||
        lastPrev.errorsCount !== lastCurr.errorsCount ||
        lastPrev.promptTokens !== lastCurr.promptTokens ||
        lastPrev.outputTokens !== lastCurr.outputTokens

      if (changed) {
        console.log('[Dashboard][Analytics] Timeseries updated', {
          guildId,
          period,
          points: current.length,
          lastPoint: lastCurr,
        })
      }
    }

    previousTimeseriesRef.current = current
  }, [timeseriesData?.timeseries, guildId, period])

  useEffect(() => {
    const current = topUsersData?.users ?? []
    const prev = previousTopUsersRef.current

    if (prev.length > 0 || current.length > 0) {
      const prevSignature = prev.map((u) => `${u.userId}:${u.count}`).join(',')
      const currSignature = current.map((u) => `${u.userId}:${u.count}`).join(',')

      if (prevSignature !== currSignature) {
        console.log('[Dashboard][Analytics] Top users changed', {
          guildId,
          period,
          users: current,
        })
      }
    }

    previousTopUsersRef.current = current
  }, [topUsersData?.users, guildId, period])

  if (metricsLoading || timeseriesLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const metrics = metricsData?.metrics
  const timeseries = timeseriesData?.timeseries ?? []
  const topUsers = topUsersData?.users ?? []

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">Usage statistics and trends</p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="Messages"
          value={metrics?.messagesCount ?? 0}
          icon={MessageSquare}
          color="blue"
        />
        <MetricCard
          title="AI Requests"
          value={metrics?.aiRequestsCount ?? 0}
          icon={Brain}
          color="purple"
        />
        <MetricCard
          title="Voice Minutes"
          value={Math.round(metrics?.voiceMinutes ?? 0)}
          icon={Mic}
          color="green"
        />
        <MetricCard
          title="Errors"
          value={metrics?.errorsCount ?? 0}
          icon={AlertTriangle}
          color="red"
        />
      </div>

      {/* Token Usage */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm text-muted-foreground">Prompt Tokens</h3>
          <p className="mt-1 text-2xl font-semibold">{(metrics?.promptTokens ?? 0).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm text-muted-foreground">Output Tokens</h3>
          <p className="mt-1 text-2xl font-semibold">{(metrics?.outputTokens ?? 0).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm text-muted-foreground">Estimated Cost</h3>
          <p className="mt-1 text-2xl font-semibold">${(metrics?.estimatedCostUsd ?? 0).toFixed(4)}</p>
        </div>
      </div>

      {/* Activity Chart */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-4 text-lg font-semibold">Activity Over Time</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timeseries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis 
                dataKey="date" 
                stroke="#71717a" 
                fontSize={12}
                tickFormatter={(value) => new Date(value).toLocaleDateString()}
              />
              <YAxis stroke="#71717a" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #27272a',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#a1a1aa' }}
              />
              <Line
                type="monotone"
                dataKey="messagesCount"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Messages"
              />
              <Line
                type="monotone"
                dataKey="aiRequestsCount"
                stroke="#a855f7"
                strokeWidth={2}
                dot={false}
                name="AI Requests"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Token Usage Chart */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-4 text-lg font-semibold">Token Usage Over Time</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeseries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis 
                dataKey="date" 
                stroke="#71717a" 
                fontSize={12}
                tickFormatter={(value) => new Date(value).toLocaleDateString()}
              />
              <YAxis stroke="#71717a" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #27272a',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#a1a1aa' }}
              />
              <Bar dataKey="promptTokens" fill="#3b82f6" name="Prompt Tokens" />
              <Bar dataKey="outputTokens" fill="#a855f7" name="Output Tokens" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Users */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5" />
          Top Users
        </h2>
        <div className="space-y-3">
          {topUsers.map((user, index) => (
            <div key={user.userId} className="flex items-center gap-4">
              <span className="w-6 text-sm text-muted-foreground">#{index + 1}</span>
              <div className="flex-1">
                <p className="font-medium">{user.userName}</p>
                <p className="text-sm text-muted-foreground">{user.count} interactions</p>
              </div>
              <div className="h-2 w-32 rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(user.count / (topUsers[0]?.count || 1)) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {topUsers.length === 0 && (
            <p className="text-center text-muted-foreground">No user data available</p>
          )}
        </div>
      </div>
    </div>
  )
}

function MetricCard({ title, value, icon: Icon, color }: {
  title: string
  value: number
  icon: React.ElementType
  color: 'blue' | 'purple' | 'green' | 'red'
}) {
  const colors = {
    blue: 'text-blue-500 bg-blue-500/10',
    purple: 'text-purple-500 bg-purple-500/10',
    green: 'text-green-500 bg-green-500/10',
    red: 'text-red-500 bg-red-500/10',
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="flex items-center gap-3">
        <div className={`rounded-lg p-2 ${colors[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
        </div>
      </div>
    </div>
  )
}
