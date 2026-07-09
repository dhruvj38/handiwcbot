'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, GuildConfig } from '@/lib/api'
import { useState, useEffect, useMemo } from 'react'
import { Loader2, Save, Wifi, WifiOff, CheckCircle2, Sparkles, Zap, Brain, DollarSign, Cpu } from 'lucide-react'
import { useGuildConfigWebSocket } from '@/lib/useConfigWebSocket'
import { useOptimisticConfigMutation } from '@/lib/useOptimisticMutation'
import { STALE_TIMES } from '@/lib/queryConfig'

interface ConfigResponse {
  config: GuildConfig
}

// Model definitions with metadata
interface ModelInfo {
  value: string
  label: string
  description: string
  tier: 'budget' | 'standard' | 'premium'
  speed: 'fast' | 'medium' | 'slow'
}

const GEMINI_MODELS: ModelInfo[] = [
  { value: 'gemini-3-pro-preview', label: 'Gemini 3.0 Pro Preview', description: 'Newest flagship / deep reasoning', tier: 'premium', speed: 'slow' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Flagship / strongest reasoning', tier: 'premium', speed: 'slow' },
  { value: 'gemini-2.5-flash-preview-09-2025', label: 'Gemini 2.5 Flash', description: 'Latest high-speed general model', tier: 'standard', speed: 'fast' },
  { value: 'gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini 2.5 Flash Lite', description: 'Ultra-fast & cheapest', tier: 'budget', speed: 'fast' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: '2nd-gen fast workhorse', tier: 'standard', speed: 'fast' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', description: '2nd-gen ultra-fast / cost-optimized', tier: 'budget', speed: 'fast' },
]

const OPENAI_MODELS: ModelInfo[] = [
  { value: 'gpt-5.1-2025-11-13', label: 'GPT-5.1 Reasoning', description: 'Deep reasoning model (chain-of-thought)', tier: 'premium', speed: 'slow' },
  { value: 'gpt-5-reasoning', label: 'GPT-5 Reasoning', description: 'Previous reasoning model', tier: 'premium', speed: 'slow' },
  { value: 'gpt-5.1', label: 'GPT-5.1', description: 'Current flagship (most capable)', tier: 'premium', speed: 'medium' },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini', description: 'Fast & cheap default for most apps', tier: 'standard', speed: 'fast' },
  { value: 'gpt-4.1', label: 'GPT-4.1', description: 'Previous flagship, cheaper than 5-series', tier: 'standard', speed: 'medium' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Smaller / cheaper 4.1 variant', tier: 'budget', speed: 'fast' },
  { value: 'gpt-4o', label: 'GPT-4o', description: 'Legacy omni model (widely available)', tier: 'standard', speed: 'medium' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Legacy fast & cheap omni', tier: 'budget', speed: 'fast' },
]

const TierBadge = ({ tier }: { tier: 'budget' | 'standard' | 'premium' }) => {
  const colors = {
    budget: 'bg-green-500/20 text-green-400 border-green-500/30',
    standard: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    premium: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  }
  const icons = {
    budget: DollarSign,
    standard: Zap,
    premium: Sparkles,
  }
  const Icon = icons[tier]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${colors[tier]}`}>
      <Icon className="h-3 w-3" />
      {tier.charAt(0).toUpperCase() + tier.slice(1)}
    </span>
  )
}

const ProviderIcon = ({ provider }: { provider: 'google' | 'openai' }) => {
  if (provider === 'google') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-red-500 to-yellow-500">
        <span className="text-xs font-bold text-white">G</span>
      </div>
    )
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600">
      <Cpu className="h-3.5 w-3.5 text-white" />
    </div>
  )
}

export default function AISettingsPage() {
  const { guildId } = useParams()
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [settings, setSettings] = useState({
    aiModel: 'gemini-2.5-flash',
    aiModelAnalysis: 'gemini-2.5-pro',
    aiChatProvider: 'google' as 'google' | 'openai',
    aiAnalysisProvider: 'google' as 'google' | 'openai',
    aiTemperature: 0.7,
    aiMaxTokens: 2000,
  })

  // WebSocket for real-time updates
  const { isConnected } = useGuildConfigWebSocket(guildId as string, {
    onConfigChange: (event) => {
      if (event.field && event.newValue !== undefined) {
        const field = event.field as keyof typeof settings
        if (field in settings) {
          setSettings(prev => ({ ...prev, [field]: event.newValue }))
        }
      }
    },
  })

  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ['guild-config', guildId],
    queryFn: () => api.get(`/api/guilds/${guildId}/config`),
    staleTime: STALE_TIMES.config,
    placeholderData: (prev) => prev,
  })

  useEffect(() => {
    if (data?.config) {
      setSettings({
        aiModel: data.config.aiModel || 'gemini-2.5-flash',
        aiModelAnalysis: data.config.aiModelAnalysis || 'gemini-2.5-pro',
        aiChatProvider: data.config.aiChatProvider || 'google',
        aiAnalysisProvider: data.config.aiAnalysisProvider || 'google',
        aiTemperature: data.config.aiTemperature ?? 0.7,
        aiMaxTokens: data.config.aiMaxTokens ?? 2000,
      })
    }
  }, [data])

  // Get the correct model list based on provider
  const chatModels = useMemo(() =>
    settings.aiChatProvider === 'openai' ? OPENAI_MODELS : GEMINI_MODELS,
    [settings.aiChatProvider]
  )

  const analysisModels = useMemo(() =>
    settings.aiAnalysisProvider === 'openai' ? OPENAI_MODELS : GEMINI_MODELS,
    [settings.aiAnalysisProvider]
  )

  // Optimistic mutation for instant UI updates
  const updateMutation = useOptimisticConfigMutation(guildId as string)

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const handleSave = () => {
    updateMutation.mutate(settings, {
      onSuccess: () => {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
      },
    })
  }

  // Handle provider change - reset model to default for new provider
  const handleChatProviderChange = (provider: 'google' | 'openai') => {
    const defaultModel = provider === 'openai' ? 'gpt-5-mini' : 'gemini-2.5-flash'
    setSettings(prev => ({ ...prev, aiChatProvider: provider, aiModel: defaultModel }))
  }

  const handleAnalysisProviderChange = (provider: 'google' | 'openai') => {
    const defaultModel = provider === 'openai' ? 'gpt-5.1' : 'gemini-2.5-pro'
    setSettings(prev => ({ ...prev, aiAnalysisProvider: provider, aiModelAnalysis: defaultModel }))
  }

  const hasChanges = data?.config && (
    settings.aiModel !== data.config.aiModel ||
    settings.aiModelAnalysis !== data.config.aiModelAnalysis ||
    settings.aiChatProvider !== data.config.aiChatProvider ||
    settings.aiAnalysisProvider !== data.config.aiAnalysisProvider ||
    settings.aiTemperature !== data.config.aiTemperature ||
    settings.aiMaxTokens !== data.config.aiMaxTokens
  )

  // Find current model info for display
  const currentChatModel = [...GEMINI_MODELS, ...OPENAI_MODELS].find(m => m.value === settings.aiModel)
  const currentAnalysisModel = [...GEMINI_MODELS, ...OPENAI_MODELS].find(m => m.value === settings.aiModelAnalysis)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">AI Settings</h1>
            <span title={isConnected ? "Real-time sync active" : "Real-time sync disconnected"}>
              {isConnected ? (
                <Wifi className="h-4 w-4 text-green-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-zinc-500" />
              )}
            </span>
          </div>
          <p className="text-muted-foreground">Configure AI models for chat and analysis</p>
        </div>
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending || !hasChanges}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saveSuccess ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {updateMutation.isPending ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {/* Chat Model Selection */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Chat Model</h2>
            <p className="text-sm text-muted-foreground">Used for text & voice chat responses</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Provider Selection */}
          <div>
            <label className="mb-2 block text-sm font-medium">Provider</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleChatProviderChange('google')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-all ${settings.aiChatProvider === 'google'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
                  }`}
              >
                <ProviderIcon provider="google" />
                <span className="font-medium">Google</span>
              </button>
              <button
                onClick={() => handleChatProviderChange('openai')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-all ${settings.aiChatProvider === 'openai'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
                  }`}
              >
                <ProviderIcon provider="openai" />
                <span className="font-medium">OpenAI</span>
              </button>
            </div>
          </div>

          {/* Model Selection */}
          <div>
            <label className="mb-2 block text-sm font-medium">Model</label>
            <select
              value={settings.aiModel}
              onChange={(e) => setSettings({ ...settings, aiModel: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm focus:border-primary focus:outline-none"
            >
              {chatModels.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label} — {model.description}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Current model info */}
        {currentChatModel && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-zinc-800/50 px-4 py-3">
            <ProviderIcon provider={settings.aiChatProvider} />
            <span className="font-medium">{currentChatModel.label}</span>
            <TierBadge tier={currentChatModel.tier} />
            <span className="text-sm text-muted-foreground">• {currentChatModel.description}</span>
          </div>
        )}
      </div>

      {/* Analysis Model Selection */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Analysis Model</h2>
            <p className="text-sm text-muted-foreground">Used for server profiling, session summaries, learning</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Provider Selection */}
          <div>
            <label className="mb-2 block text-sm font-medium">Provider</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleAnalysisProviderChange('google')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-all ${settings.aiAnalysisProvider === 'google'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
                  }`}
              >
                <ProviderIcon provider="google" />
                <span className="font-medium">Google</span>
              </button>
              <button
                onClick={() => handleAnalysisProviderChange('openai')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-all ${settings.aiAnalysisProvider === 'openai'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
                  }`}
              >
                <ProviderIcon provider="openai" />
                <span className="font-medium">OpenAI</span>
              </button>
            </div>
          </div>

          {/* Model Selection */}
          <div>
            <label className="mb-2 block text-sm font-medium">Model</label>
            <select
              value={settings.aiModelAnalysis}
              onChange={(e) => setSettings({ ...settings, aiModelAnalysis: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm focus:border-primary focus:outline-none"
            >
              {analysisModels.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label} — {model.description}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Current model info */}
        {currentAnalysisModel && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-zinc-800/50 px-4 py-3">
            <ProviderIcon provider={settings.aiAnalysisProvider} />
            <span className="font-medium">{currentAnalysisModel.label}</span>
            <TierBadge tier={currentAnalysisModel.tier} />
            <span className="text-sm text-muted-foreground">• {currentAnalysisModel.description}</span>
          </div>
        )}
      </div>

      {/* Generation Parameters */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Generation Parameters</h2>
            <p className="text-sm text-muted-foreground">Control response creativity and length</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">Temperature</label>
              <span className="rounded-md bg-zinc-800 px-2 py-1 text-sm font-mono">{settings.aiTemperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={settings.aiTemperature}
              onChange={(e) => setSettings({ ...settings, aiTemperature: parseFloat(e.target.value) })}
              className="w-full accent-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Higher = more creative/random, Lower = more focused/deterministic
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Max Output Tokens</label>
            <input
              type="number"
              min="100"
              max="8000"
              step="100"
              value={settings.aiMaxTokens}
              onChange={(e) => setSettings({ ...settings, aiMaxTokens: parseInt(e.target.value) })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Maximum length of AI responses (1 token ≈ 4 characters)
            </p>
          </div>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
          <h3 className="font-medium text-blue-400">💡 Tip: Chat vs Analysis</h3>
          <p className="mt-1 text-sm text-blue-300/80">
            Use a fast model (Flash/Mini) for chat responses and a powerful model (Pro/5.1) for analysis tasks like server profiling.
          </p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
          <h3 className="font-medium text-amber-400">⚠️ OpenAI Requires API Key</h3>
          <p className="mt-1 text-sm text-amber-300/80">
            OpenAI models require OPENAI_API_KEY in your .env file. If missing, the bot will fall back to Gemini.
          </p>
        </div>
      </div>
    </div>
  )
}
