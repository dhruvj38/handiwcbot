'use client'

import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, GuildConfig } from '@/lib/api'
import { useState, useEffect } from 'react'
import { Loader2, Save, Brain, Zap, Clock, Database, Wifi, WifiOff } from 'lucide-react'
import { useGuildConfigWebSocket } from '@/lib/useConfigWebSocket'

interface ConfigResponse {
  config: GuildConfig
}

export default function LearningSettingsPage() {
  const { guildId } = useParams()
  const queryClient = useQueryClient()
  
  const [settings, setSettings] = useState({
    learningEnabled: true,
    learningBatchSize: 20,
    learningBatchTimeoutMs: 60000,
    learningPersonalityUpdateMs: 300000,
    learningConsolidationMs: 3600000,
  })

  // WebSocket for real-time updates
  useGuildConfigWebSocket(guildId as string, {
    onConfigChange: (event) => {
      console.log('[Learning] Real-time config update:', event.field, '=', event.newValue)
      // Auto-update local state for learning toggle
      if (event.field === 'learningEnabled') {
        setSettings(prev => ({ ...prev, learningEnabled: event.newValue as boolean }))
      }
    },
  })

  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ['guild-config', guildId],
    queryFn: () => api.get(`/api/guilds/${guildId}/config`),
    refetchInterval: 30000,
  })

  const { data: envData } = useQuery<EnvResponse>({
    queryKey: ['env'],
    queryFn: () => api.get('/api/env'),
  })

  useEffect(() => {
    if (data?.config) {
      setSettings({
        learningEnabled: data.config.learningEnabled,
      })
    }
  }, [data])

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<GuildConfig>) =>
      api.patch(`/api/guilds/${guildId}/config`, updates),
    onSuccess: () => {
      console.log('[Learning] Config saved successfully')
      queryClient.invalidateQueries({ queryKey: ['guild-config', guildId] })
    },
    onError: (error) => {
      console.error('[Learning] Failed to save config:', error)
    },
  })

  const handleToggle = (field: keyof typeof settings, value: boolean) => {
    console.log(`[Learning] Toggling ${field}:`, value)
    setSettings({ ...settings, [field]: value })
    
    // Immediately save toggle changes
    updateMutation.mutate({ [field]: value })
  }

  const learningCategory = envData?.categories.find((c) => c.category === 'learning')

  const getNumberFromEnv = (key: string, fallback: number): number => {
    const variable = learningCategory?.variables.find((v) => v.key === key)
    if (!variable) return fallback
    const raw = variable.value ?? variable.defaultValue ?? String(fallback)
    const parsed = parseInt(raw, 10)
    return Number.isNaN(parsed) ? fallback : parsed
  }

  const batchSize = getNumberFromEnv('LEARNING_BATCH_SIZE', 20)
  const batchTimeoutMs = getNumberFromEnv('LEARNING_BATCH_TIMEOUT_MS', 60000)
  const consolidationMs = getNumberFromEnv('LEARNING_CONSOLIDATION_MS', 3600000)

  const batchTimeoutSeconds = Math.round(batchTimeoutMs / 1000)
  const consolidationHours = Math.round(consolidationMs / 3600000)

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Learning Settings</h1>
        <p className="text-muted-foreground">Configure how the bot learns from conversations</p>
      </div>

      {/* Learning Toggle */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg p-2 ${settings.learningEnabled ? 'bg-green-500/20' : 'bg-zinc-800'}`}>
              <Brain className={`h-5 w-5 ${settings.learningEnabled ? 'text-green-500' : 'text-zinc-500'}`} />
            </div>
            <div>
              <h2 className="font-semibold">Realtime Learning</h2>
              <p className="text-sm text-muted-foreground">
                Bot learns from ALL messages to build personality
              </p>
            </div>
          </div>
          
          <button
            onClick={() => handleToggle('learningEnabled', !settings.learningEnabled)}
            disabled={updateMutation.isPending}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              settings.learningEnabled ? 'bg-green-500' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                settings.learningEnabled ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Learning Info */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium">Batch Size</span>
          </div>
          <p className="text-2xl font-bold">{batchSize}</p>
          <p className="text-xs text-muted-foreground">Messages per batch</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-medium">Batch Timeout</span>
          </div>
          <p className="text-2xl font-bold">{batchTimeoutSeconds}s</p>
          <p className="text-xs text-muted-foreground">Max wait before processing</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-medium">Consolidation</span>
          </div>
          <p className="text-2xl font-bold">{consolidationHours}h</p>
          <p className="text-xs text-muted-foreground">Memory cleanup interval</p>
        </div>
      </div>

      {/* Learning Status */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-4 text-lg font-semibold">How Learning Works</h2>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-white">1. Message Collection:</strong> The bot observes all messages in the server
            (without responding to most of them).
          </p>
          <p>
            <strong className="text-white">2. Pattern Analysis:</strong> Messages are batched and analyzed to extract
            slang, phrases, inside jokes, and communication patterns.
          </p>
          <p>
            <strong className="text-white">3. Personality Building:</strong> The extracted patterns are used to update
            the bot&apos;s personality so it talks more like server members.
          </p>
          <p>
            <strong className="text-white">4. Memory Consolidation:</strong> Periodically, memories are cleaned up
            and consolidated to prevent database bloat.
          </p>
        </div>
      </div>

      {/* Note about global settings */}
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
        <p className="text-sm text-yellow-200">
          <strong>Note:</strong> Batch size, timeout, and consolidation intervals are configured in the .env file
          and require a bot restart to change. Visit the Environment page to modify these global settings.
        </p>
      </div>
    </div>
  )
}
