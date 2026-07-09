'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, GuildConfig, TtsUsageResponse, TtsVoice } from '@/lib/api'
import React, { useState, useEffect } from 'react'
import { Loader2, Save, Wifi, WifiOff, RefreshCw, Volume2, DollarSign, Hash, Clock, CheckCircle2 } from 'lucide-react'
import { useGuildConfigWebSocket } from '@/lib/useConfigWebSocket'
import { useOptimisticConfigMutation } from '@/lib/useOptimisticMutation'

interface ConfigResponse {
  config: GuildConfig
}

interface VoicesResponse {
  voices: TtsVoice[]
}

// Fallback voices if API fails
const FALLBACK_VOICES: TtsVoice[] = [
  { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George (Male, Deep)' },
  { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Female, Clear)' },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Female, Warm)' },
  { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Male, Friendly)' },
  { voice_id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (Female, Expressive)' },
]

export default function VoiceSettingsPage() {
  const { guildId } = useParams()

  const [saveSuccess, setSaveSuccess] = useState(false)

  const [settings, setSettings] = useState({
    voiceEnabled: true,
    ttsEnabled: false,
    autoJoinEnabled: true,
    chimeInEnabled: true,
    ttsVoice: 'JBFqnCBsd6RMkjVDRZzb',
    ttsModel: 'eleven_flash_v2_5',
    minMembersToJoin: 2,
    chimeInChance: 0.15,
    minSecondsBetweenChimes: 60,
    maxVoiceResponseLength: 200,
  })

  // WebSocket for real-time updates
  const { isConnected } = useGuildConfigWebSocket(guildId as string, {
    onConfigChange: (event) => {
      console.log('[Voice] Real-time update received:', event.field, '=', event.newValue)
      // Auto-update local state when changes come from WebSocket
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
  })

  // Fetch ElevenLabs voices
  const { data: voicesData } = useQuery<VoicesResponse>({
    queryKey: ['tts-voices'],
    queryFn: () => api.get('/api/tts/voices'),
    staleTime: 60000, // Cache for 1 minute
  })

  // Fetch TTS usage stats
  const { data: ttsUsage, refetch: refetchUsage } = useQuery<TtsUsageResponse>({
    queryKey: ['tts-usage'],
    queryFn: () => api.get('/api/tts/usage'),
    refetchInterval: 5000, // Refresh every 5 seconds for live updates
  })

  const voices = voicesData?.voices || FALLBACK_VOICES

  useEffect(() => {
    if (data?.config) {
      setSettings({
        voiceEnabled: data.config.voiceEnabled,
        ttsEnabled: data.config.ttsEnabled,
        autoJoinEnabled: data.config.autoJoinEnabled,
        chimeInEnabled: data.config.chimeInEnabled,
        ttsVoice: data.config.ttsVoice,
        ttsModel: data.config.ttsModel,
        minMembersToJoin: data.config.minMembersToJoin,
        chimeInChance: data.config.chimeInChance,
        minSecondsBetweenChimes: data.config.minSecondsBetweenChimes,
        maxVoiceResponseLength: data.config.maxVoiceResponseLength,
      })
    }
  }, [data])

  const updateMutation = useOptimisticConfigMutation(guildId as string)

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const handleSave = () => {
    console.log('[Dashboard][Voice] Saving voice settings', { guildId, settings })
    updateMutation.mutate(settings as Partial<GuildConfig>, {
      onSuccess: () => {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
      },
    })
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Voice Settings</h1>
            <span title={isConnected ? "Real-time sync active" : "Real-time sync disconnected"}>
              {isConnected ? (
                <Wifi className="h-4 w-4 text-green-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-zinc-500" />
              )}
            </span>
          </div>
          <p className="text-muted-foreground">Configure voice chat and TTS behavior</p>
        </div>
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Feature Toggles */}
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="text-lg font-semibold">Features</h2>

          <ToggleItem
            label="Voice Chat (Master Switch)"
            description="Enable all voice features - listening, speaking, auto-join"
            checked={settings.voiceEnabled}
            onChange={(checked) => {
              setSettings(prev => ({ ...prev, voiceEnabled: checked }))
            }}
          />

          <ToggleItem
            label="Speak in Voice (TTS)"
            description="Bot unmutes and speaks aloud using ElevenLabs TTS"
            checked={settings.ttsEnabled}
            disabled={!settings.voiceEnabled}
            onChange={(checked) => {
              setSettings(prev => ({ ...prev, ttsEnabled: checked }))
            }}
          />

          <ToggleItem
            label="Auto-Join Channels"
            description="Automatically join when enough members are in voice"
            checked={settings.autoJoinEnabled}
            disabled={!settings.voiceEnabled}
            onChange={(checked) => {
              setSettings(prev => ({ ...prev, autoJoinEnabled: checked }))
            }}
          />

          <ToggleItem
            label="Spontaneous Chime-Ins"
            description="Jump into conversations randomly (requires Speak enabled)"
            checked={settings.chimeInEnabled}
            disabled={!settings.voiceEnabled || !settings.ttsEnabled}
            onChange={(checked) => {
              setSettings(prev => ({ ...prev, chimeInEnabled: checked }))
            }}
          />
        </div>

        {/* TTS Settings */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">ElevenLabs Text-to-Speech</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Voice</label>
              <select
                value={settings.ttsVoice}
                onChange={(e) => {
                  const value = e.target.value
                  setSettings(prev => ({ ...prev, ttsVoice: value }))
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                {voices.map((voice: TtsVoice) => (
                  <option key={voice.voice_id} value={voice.voice_id}>
                    {voice.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Browse more at <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ElevenLabs Voice Library</a>
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm text-muted-foreground">TTS Model</label>
              <select
                value={settings.ttsModel}
                onChange={(e) => {
                  const value = e.target.value
                  setSettings(prev => ({ ...prev, ttsModel: value }))
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="eleven_flash_v2_5">Flash v2.5 (Fast, Low Latency)</option>
                <option value="eleven_multilingual_v2">Multilingual v2 (High Quality)</option>
                <option value="eleven_turbo_v2_5">Turbo v2.5 (Balanced)</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Flash is fastest, Multilingual has best quality
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Max Response Length</label>
              <input
                type="number"
                min="50"
                max="500"
                value={settings.maxVoiceResponseLength}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 200
                  setSettings(prev => ({ ...prev, maxVoiceResponseLength: value }))
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Max characters per voice response (longer = more TTS credits)
              </p>
            </div>
          </div>
        </div>

        {/* Auto-Join Settings */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Auto-Join Behavior</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Minimum Members to Join</label>
              <input
                type="number"
                min="1"
                max="10"
                value={settings.minMembersToJoin}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 2
                  setSettings(prev => ({ ...prev, minMembersToJoin: value }))
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Bot will auto-join when this many non-bot members are in a voice channel
              </p>
            </div>
          </div>
        </div>

        {/* Chime-in Behavior */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Chime-in Behavior</h2>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm">Chime-in Chance</label>
                <span className="text-sm text-muted-foreground">{(settings.chimeInChance * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.chimeInChance}
                onChange={(e) => {
                  const value = parseFloat(e.target.value)
                  setSettings(prev => ({ ...prev, chimeInChance: value }))
                }}
                className="w-full accent-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                How often the bot spontaneously joins conversations
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Cooldown Between Chimes (seconds)</label>
              <input
                type="number"
                min="10"
                max="300"
                value={settings.minSecondsBetweenChimes}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 60
                  setSettings(prev => ({ ...prev, minSecondsBetweenChimes: value }))
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Minimum time between spontaneous chime-ins
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* TTS Usage Statistics */}
      {ttsUsage?.enabled && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">ElevenLabs Usage</h2>
            <button
              onClick={() => refetchUsage()}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Session Stats */}
            <UsageCard
              icon={Hash}
              label="Session Requests"
              value={ttsUsage.session.sessionRequests.toString()}
              subtext={`${ttsUsage.session.sessionCharacters.toLocaleString()} characters`}
            />
            <UsageCard
              icon={DollarSign}
              label="Session Cost"
              value={`$${ttsUsage.session.estimatedCostUsd.toFixed(4)}`}
              subtext="Estimated cost this session"
            />

            {/* Subscription Stats */}
            {ttsUsage.subscription && (
              <>
                <UsageCard
                  icon={Volume2}
                  label="Monthly Usage"
                  value={`${ttsUsage.subscription.characterCount.toLocaleString()} / ${ttsUsage.subscription.characterLimit.toLocaleString()}`}
                  subtext={`${((ttsUsage.subscription.characterCount / ttsUsage.subscription.characterLimit) * 100).toFixed(1)}% used`}
                  variant={(ttsUsage.subscription.characterCount / ttsUsage.subscription.characterLimit) > 0.8 ? 'warning' : 'default'}
                />
                <UsageCard
                  icon={Clock}
                  label="Plan"
                  value={ttsUsage.subscription.tier.charAt(0).toUpperCase() + ttsUsage.subscription.tier.slice(1)}
                  subtext={`Resets ${new Date(ttsUsage.subscription.nextCharacterCountResetUnix * 1000).toLocaleDateString()}`}
                />
              </>
            )}
          </div>

          {/* Last Request Info */}
          {ttsUsage.session.lastRequestId && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-sm">
              <span className="text-muted-foreground">Last request: </span>
              <span className="font-mono text-xs">{ttsUsage.session.lastRequestId}</span>
              <span className="text-muted-foreground"> ({ttsUsage.session.lastRequestCharacters} chars)</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToggleItem({ label, description, checked, onChange, disabled = false }: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className={`flex items-center justify-between py-2 ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          disabled ? 'cursor-not-allowed bg-zinc-800' : checked ? 'bg-primary' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'left-[22px]' : 'left-0.5'
            }`}
        />
      </button>
    </div>
  )
}

function UsageCard({ icon: Icon, label, value, subtext, variant = 'default' }: {
  icon: React.ElementType
  label: string
  value: string
  subtext: string
  variant?: 'default' | 'warning'
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={`h-4 w-4 ${variant === 'warning' ? 'text-yellow-500' : ''}`} />
        <span className="text-sm">{label}</span>
      </div>
      <p className={`mt-2 text-xl font-semibold ${variant === 'warning' ? 'text-yellow-500' : ''}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>
    </div>
  )
}
