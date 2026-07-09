'use client'

import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useState } from 'react'
import { Loader2, Save, RotateCcw } from 'lucide-react'

interface PersonalityResponse {
  personality: Record<string, unknown>
  defaults: Record<string, unknown>
  overrides: Record<string, unknown> | null
}

export default function PersonalityPage() {
  const { guildId } = useParams()
  const queryClient = useQueryClient()
  const [localOverrides, setLocalOverrides] = useState<Record<string, unknown> | null>(null)

  const { data, isLoading } = useQuery<PersonalityResponse>({
    queryKey: ['personality', guildId],
    queryFn: () => api.get(`/api/guilds/${guildId}/personality`),
  })

  const updateMutation = useMutation({
    mutationFn: (overrides: Record<string, unknown>) =>
      api.patch(`/api/guilds/${guildId}/personality`, overrides),
    onSuccess: () => {
      console.log('[Dashboard][Personality] Saved overrides', { guildId, overrides: localOverrides })
      queryClient.invalidateQueries({ queryKey: ['personality', guildId] })
    },
  })

  const resetMutation = useMutation({
    mutationFn: () => api.delete(`/api/guilds/${guildId}/personality`),
    onSuccess: () => {
      console.log('[Dashboard][Personality] Reset to defaults', { guildId })
      setLocalOverrides(null)
      queryClient.invalidateQueries({ queryKey: ['personality', guildId] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const personality = data?.personality as Record<string, unknown> || {}
  const currentOverrides = localOverrides ?? data?.overrides ?? {}

  const updateField = (path: string[], value: unknown) => {
    const newOverrides = { ...currentOverrides }
    let current: Record<string, unknown> = newOverrides
    
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) {
        current[path[i]] = {}
      }
      current = current[path[i]] as Record<string, unknown>
    }
    current[path[path.length - 1]] = value
    
    setLocalOverrides(newOverrides)
  }

  const handleSave = () => {
    if (localOverrides) {
      updateMutation.mutate(localOverrides)
    }
  }

  const traits = (personality.traits || {}) as Record<string, unknown>

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Personality Settings</h1>
          <p className="text-muted-foreground">Customize how the bot talks and behaves</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending || !localOverrides}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Core Identity */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Core Identity</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Bot Name</label>
              <input
                type="text"
                value={String((currentOverrides as Record<string, unknown>).name || personality.name || '')}
                onChange={(e) => updateField(['name'], e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Personality Summary</label>
              <textarea
                value={String((currentOverrides as Record<string, unknown>).summary || personality.summary || '')}
                onChange={(e) => updateField(['summary'], e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Vibe</label>
              <input
                type="text"
                value={String((currentOverrides as Record<string, unknown>).vibe || personality.vibe || '')}
                onChange={(e) => updateField(['vibe'], e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Personality Traits */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Personality Traits</h2>
          <div className="space-y-6">
            {['humor', 'sarcasm', 'roastLevel', 'helpfulness', 'energy', 'chaosLevel'].map((trait) => (
              <div key={trait}>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm capitalize">{trait.replace(/([A-Z])/g, ' $1')}</label>
                  <span className="text-sm text-muted-foreground">
                    {((currentOverrides as Record<string, Record<string, unknown>>).traits?.[trait] as number) ?? 
                     (traits[trait] as number) ?? 5}/10
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={((currentOverrides as Record<string, Record<string, unknown>>).traits?.[trait] as number) ?? 
                         (traits[trait] as number) ?? 5}
                  onChange={(e) => updateField(['traits', trait], parseInt(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Typing Style */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Typing Style</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Capitalization</label>
              <select
                value={String(((currentOverrides as Record<string, Record<string, unknown>>).typingStyle as Record<string, unknown>)?.capitalization || 
                       ((personality.typingStyle as Record<string, unknown>)?.capitalization) || 'lowercase')}
                onChange={(e) => updateField(['typingStyle', 'capitalization'], e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="lowercase">Lowercase</option>
                <option value="normal">Normal</option>
                <option value="caps_heavy">Caps Heavy</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Punctuation</label>
              <select
                value={String(((currentOverrides as Record<string, Record<string, unknown>>).typingStyle as Record<string, unknown>)?.punctuation || 
                       ((personality.typingStyle as Record<string, unknown>)?.punctuation) || 'minimal')}
                onChange={(e) => updateField(['typingStyle', 'punctuation'], e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="minimal">Minimal</option>
                <option value="selective">Selective</option>
                <option value="normal">Normal</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Typical Message Length (words)</label>
              <input
                type="number"
                min="1"
                max="50"
                value={Number(((currentOverrides as Record<string, Record<string, unknown>>).typingStyle as Record<string, unknown>)?.typicalMessageLength || 
                       ((personality.typingStyle as Record<string, unknown>)?.typicalMessageLength) || 8)}
                onChange={(e) => updateField(['typingStyle', 'typicalMessageLength'], parseInt(e.target.value))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Emoji Settings */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Emoji Usage</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Frequency</label>
              <select
                value={String(((currentOverrides as Record<string, Record<string, unknown>>).emojis as Record<string, unknown>)?.frequency || 
                       ((personality.emojis as Record<string, unknown>)?.frequency) || 'sometimes')}
                onChange={(e) => updateField(['emojis', 'frequency'], e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="rarely">Rarely</option>
                <option value="sometimes">Sometimes</option>
                <option value="often">Often</option>
                <option value="heavy">Heavy</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Favorite Emojis (space separated)</label>
              <input
                type="text"
                value={(((currentOverrides as Record<string, Record<string, unknown>>).emojis as Record<string, unknown>)?.favorites as string[] || 
                       ((personality.emojis as Record<string, unknown>)?.favorites as string[]) || []).join(' ')}
                onChange={(e) => updateField(['emojis', 'favorites'], e.target.value.split(' ').filter(Boolean))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                placeholder="💀 😭 🔥 😂"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Slang */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-4 text-lg font-semibold">Favorite Slang</h2>
        <p className="mb-2 text-sm text-muted-foreground">Comma-separated list of slang words the bot should use frequently</p>
        <textarea
          value={(((currentOverrides as Record<string, Record<string, unknown>>).slang as Record<string, unknown>)?.favorites as string[] || 
                 ((personality.slang as Record<string, unknown>)?.favorites as string[]) || []).join(', ')}
          onChange={(e) => updateField(['slang', 'favorites'], e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          rows={3}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
          placeholder="bet, no cap, lowkey, bruh, ayo..."
        />
      </div>

      {/* Forbidden Phrases */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-4 text-lg font-semibold">Forbidden Phrases</h2>
        <p className="mb-2 text-sm text-muted-foreground">Phrases the bot should NEVER say (one per line)</p>
        <textarea
          value={(((currentOverrides as Record<string, Record<string, unknown>>).forbidden as Record<string, unknown>)?.aiPhrases as string[] || 
                 ((personality.forbidden as Record<string, unknown>)?.aiPhrases as string[]) || []).join('\n')}
          onChange={(e) => updateField(['forbidden', 'aiPhrases'], e.target.value.split('\n').filter(Boolean))}
          rows={6}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
          placeholder="certainly&#10;I would be happy to&#10;great question"
        />
      </div>
    </div>
  )
}
