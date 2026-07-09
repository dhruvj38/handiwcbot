'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useState } from 'react'
import { Loader2, Save, AlertTriangle, RefreshCw, Eye, EyeOff } from 'lucide-react'
import { useConfigWebSocket } from '@/lib/useConfigWebSocket'

interface EnvVariable {
  key: string
  value: string | null
  displayValue: string
  category: string
  label: string
  description: string
  type: 'string' | 'number' | 'boolean'
  sensitive: boolean
  requiresRestart: boolean
  defaultValue?: string
}

interface EnvCategory {
  category: string
  label: string
  variables: EnvVariable[]
}

interface EnvResponse {
  categories: EnvCategory[]
  timestamp: string
}

interface UpdateResult {
  success: boolean
  key: string
  requiresRestart: boolean
  message: string
}

export default function EnvironmentPage() {
  const queryClient = useQueryClient()
  const [editedValues, setEditedValues] = useState<Record<string, string>>({})
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({})
  const [pendingRestart, setPendingRestart] = useState(false)

  // WebSocket for real-time updates
  useConfigWebSocket({
    onEnvChange: (event) => {
      console.log('[Env] Real-time env update:', event.field, '- requiresRestart:', event.requiresRestart)
      if (event.requiresRestart) {
        setPendingRestart(true)
      }
    },
  })

  const { data, isLoading } = useQuery<EnvResponse>({
    queryKey: ['env'],
    queryFn: () => api.get('/api/env'),
  })

  const updateMutation = useMutation({
    mutationFn: (updates: { key: string; value: string }[]) =>
      api.patch<{ results: UpdateResult[]; requiresRestart: boolean }>('/api/env', { updates }),
    onSuccess: (result) => {
      console.log('[Env] Update result:', result)
      if (result.requiresRestart) {
        setPendingRestart(true)
      }
      setEditedValues({})
      queryClient.invalidateQueries({ queryKey: ['env'] })
    },
    onError: (error) => {
      console.error('[Env] Failed to update:', error)
    },
  })

  const handleChange = (key: string, value: string) => {
    console.log(`[Env] Editing ${key}:`, value)
    setEditedValues({ ...editedValues, [key]: value })
  }

  const handleSave = () => {
    const updates = Object.entries(editedValues).map(([key, value]) => ({ key, value }))
    console.log('[Env] Saving updates:', updates)
    updateMutation.mutate(updates)
  }

  const hasChanges = Object.keys(editedValues).length > 0

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Environment Configuration</h1>
          <p className="text-muted-foreground">Global settings that affect all servers</p>
        </div>
        
        {pendingRestart && (
          <div className="flex items-center gap-2 rounded-lg bg-yellow-500/20 px-4 py-2 text-yellow-300">
            <RefreshCw className="h-4 w-4" />
            <span className="text-sm">Bot restart required</span>
          </div>
        )}
      </div>

      {/* Warning Banner */}
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-500" />
          <div>
            <p className="font-medium text-yellow-200">Caution: Global Settings</p>
            <p className="text-sm text-yellow-200/70">
              These settings affect the entire bot. Some changes require a restart to take effect.
              Sensitive values (API keys) are masked for security.
            </p>
          </div>
        </div>
      </div>

      {/* Categories */}
      {data?.categories.map((category) => (
        <div key={category.category} className="rounded-xl border border-zinc-800 bg-zinc-900/50">
          <div className="border-b border-zinc-800 px-6 py-4">
            <h2 className="text-lg font-semibold">{category.label}</h2>
          </div>
          
          <div className="divide-y divide-zinc-800">
            {category.variables.map((variable) => (
              <div key={variable.key} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <label className="font-medium">{variable.label}</label>
                      {variable.requiresRestart && (
                        <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-xs text-yellow-300">
                          Restart
                        </span>
                      )}
                      {variable.sensitive && (
                        <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-300">
                          Sensitive
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{variable.description}</p>
                    <p className="mt-1 font-mono text-xs text-zinc-500">{variable.key}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {variable.type === 'boolean' ? (
                      <select
                        value={editedValues[variable.key] ?? variable.displayValue}
                        onChange={(e) => handleChange(variable.key, e.target.value)}
                        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
                      >
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          type={variable.sensitive && !showSensitive[variable.key] ? 'password' : 'text'}
                          value={editedValues[variable.key] ?? (variable.sensitive ? '' : variable.displayValue)}
                          onChange={(e) => handleChange(variable.key, e.target.value)}
                          placeholder={variable.sensitive ? '••••••••' : variable.defaultValue}
                          className="w-48 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
                        />
                        {variable.sensitive && (
                          <button
                            onClick={() => setShowSensitive({ ...showSensitive, [variable.key]: !showSensitive[variable.key] })}
                            className="p-2 text-zinc-400 hover:text-white"
                          >
                            {showSensitive[variable.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Save Button */}
      {hasChanges && (
        <div className="sticky bottom-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-medium text-white shadow-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save {Object.keys(editedValues).length} Change{Object.keys(editedValues).length !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  )
}
