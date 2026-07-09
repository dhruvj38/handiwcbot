'use client'

import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, GuildConfig } from '@/lib/api'
import { useState, useEffect } from 'react'
import { Loader2, Save, Hash, MessageSquare, AlertTriangle } from 'lucide-react'
import { useGuildConfigWebSocket } from '@/lib/useConfigWebSocket'

interface ConfigResponse {
  config: GuildConfig
}

export default function SettingsPage() {
  const { guildId } = useParams()
  const queryClient = useQueryClient()
  
  const [settings, setSettings] = useState({
    allowedChannelIds: [] as string[],
    logChannelId: '' as string,
    memoryRetentionDays: 30,
    maxMemoriesPerUser: 100,
  })
  
  const [newChannelId, setNewChannelId] = useState('')

  // WebSocket for real-time updates
  useGuildConfigWebSocket(guildId as string, {
    onConfigChange: (event) => {
      console.log('[Settings] Real-time config update:', event.field, '=', event.newValue)
    },
  })

  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ['guild-config', guildId],
    queryFn: () => api.get(`/api/guilds/${guildId}/config`),
    refetchInterval: 30000,
  })

  useEffect(() => {
    if (data?.config) {
      setSettings({
        allowedChannelIds: data.config.allowedChannelIds || [],
        logChannelId: data.config.logChannelId || '',
        memoryRetentionDays: data.config.memoryRetentionDays,
        maxMemoriesPerUser: data.config.maxMemoriesPerUser,
      })
    }
  }, [data])

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<GuildConfig>) =>
      api.patch(`/api/guilds/${guildId}/config`, updates),
    onSuccess: () => {
      console.log('[Settings] Config saved successfully')
      queryClient.invalidateQueries({ queryKey: ['guild-config', guildId] })
    },
    onError: (error) => {
      console.error('[Settings] Failed to save config:', error)
    },
  })

  const handleSave = () => {
    console.log('[Settings] Saving settings:', settings)
    updateMutation.mutate({
      allowedChannelIds: settings.allowedChannelIds,
      logChannelId: settings.logChannelId || null,
      memoryRetentionDays: settings.memoryRetentionDays,
      maxMemoriesPerUser: settings.maxMemoriesPerUser,
    })
  }

  const handleAddChannel = () => {
    if (newChannelId && !settings.allowedChannelIds.includes(newChannelId)) {
      const updated = [...settings.allowedChannelIds, newChannelId]
      setSettings({ ...settings, allowedChannelIds: updated })
      setNewChannelId('')
      console.log('[Settings] Added channel:', newChannelId)
    }
  }

  const handleRemoveChannel = (channelId: string) => {
    const updated = settings.allowedChannelIds.filter(id => id !== channelId)
    setSettings({ ...settings, allowedChannelIds: updated })
    console.log('[Settings] Removed channel:', channelId)
  }

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
        <h1 className="text-2xl font-bold">Server Settings</h1>
        <p className="text-muted-foreground">Configure bot behavior and channel restrictions</p>
      </div>

      {/* Channel Restrictions */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Hash className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Allowed Channels</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          If set, the bot will only respond in these channels. Leave empty to allow all channels.
        </p>

        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={newChannelId}
            onChange={(e) => setNewChannelId(e.target.value)}
            placeholder="Channel ID"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
          />
          <button
            onClick={handleAddChannel}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Add
          </button>
        </div>

        {settings.allowedChannelIds.length > 0 ? (
          <div className="space-y-2">
            {settings.allowedChannelIds.map((channelId) => (
              <div
                key={channelId}
                className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2"
              >
                <span className="font-mono text-sm">{channelId}</span>
                <button
                  onClick={() => handleRemoveChannel(channelId)}
                  className="text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No channel restrictions - bot responds in all channels</p>
        )}
      </div>

      {/* Log Channel */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Log Channel</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Channel where the bot will send activity logs and notifications.
        </p>

        <input
          type="text"
          value={settings.logChannelId}
          onChange={(e) => {
            setSettings({ ...settings, logChannelId: e.target.value })
            console.log('[Settings] Log channel changed:', e.target.value)
          }}
          placeholder="Channel ID (optional)"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
        />
      </div>

      {/* Memory Settings */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Memory Settings</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">
              Memory Retention (days): {settings.memoryRetentionDays}
            </label>
            <input
              type="range"
              min="7"
              max="365"
              value={settings.memoryRetentionDays}
              onChange={(e) => {
                const value = parseInt(e.target.value)
                setSettings({ ...settings, memoryRetentionDays: value })
                console.log('[Settings] Memory retention changed:', value)
              }}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>7 days</span>
              <span>365 days</span>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Max Memories Per User: {settings.maxMemoriesPerUser}
            </label>
            <input
              type="range"
              min="10"
              max="500"
              value={settings.maxMemoriesPerUser}
              onChange={(e) => {
                const value = parseInt(e.target.value)
                setSettings({ ...settings, maxMemoriesPerUser: value })
                console.log('[Settings] Max memories changed:', value)
              }}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>10</span>
              <span>500</span>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Settings
        </button>
      </div>
    </div>
  )
}
