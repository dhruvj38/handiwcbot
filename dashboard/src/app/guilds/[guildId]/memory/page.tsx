'use client'

import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useState } from 'react'
import { Loader2, Users, Server, Trash2, Search } from 'lucide-react'

interface ServerMemory {
  id: string
  type: string
  title: string
  content: string
  createdAt: string
}

interface UserProfile {
  userId: string
  displayName: string
  summary: string
  tags: string[]
  lastUpdated: string
}

interface MemoriesResponse {
  memories: ServerMemory[]
}

interface ProfilesResponse {
  profiles: UserProfile[]
}

export default function MemoryPage() {
  const { guildId } = useParams()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'server' | 'users'>('server')
  const [search, setSearch] = useState('')

  const { data: memoriesData, isLoading: memoriesLoading } = useQuery<MemoriesResponse>({
    queryKey: ['server-memories', guildId],
    queryFn: () => api.get(`/api/guilds/${guildId}/personality/memories?limit=100`),
    enabled: activeTab === 'server',
  })

  const { data: profilesData, isLoading: profilesLoading } = useQuery<ProfilesResponse>({
    queryKey: ['user-profiles', guildId],
    queryFn: () => api.get(`/api/guilds/${guildId}/personality/profiles?limit=100`),
    enabled: activeTab === 'users',
  })

  const memories = memoriesData?.memories ?? []
  const profiles = profilesData?.profiles ?? []

  const filteredMemories = memories.filter(
    (m) =>
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.content.toLowerCase().includes(search.toLowerCase())
  )

  const deleteServerMemoryMutation = useMutation({
    mutationFn: async (memoryId: string) => {
      return api.delete(`/api/guilds/${guildId}/personality/memories/${memoryId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-memories', guildId] })
    },
  })

  const deleteUserProfileMutation = useMutation({
    mutationFn: async (userId: string) => {
      return api.delete(`/api/guilds/${guildId}/personality/user-profiles/${userId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profiles', guildId] })
    },
  })

  const handleDeleteMemory = (memoryId: string) => {
    if (!window.confirm('Delete this memory? This cannot be undone.')) return
    deleteServerMemoryMutation.mutate(memoryId)
  }

  const handleDeleteUserProfile = (userId: string) => {
    if (!window.confirm('Delete this user profile? This cannot be undone.')) return
    deleteUserProfileMutation.mutate(userId)
  }

  const filteredProfiles = profiles.filter(
    (p) =>
      p.displayName.toLowerCase().includes(search.toLowerCase()) ||
      p.summary.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Memory & Learning</h1>
        <p className="text-muted-foreground">View what the bot has learned about your server</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-zinc-800">
        <button
          onClick={() => setActiveTab('server')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'server'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Server className="h-4 w-4" />
          Server Memories
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'users'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="h-4 w-4" />
          User Profiles
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none"
        />
      </div>

      {/* Server Memories Tab */}
      {activeTab === 'server' && (
        <div className="space-y-4">
          {memoriesLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredMemories.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
              <Server className="mx-auto h-12 w-12 text-zinc-600" />
              <h3 className="mt-4 text-lg font-semibold">No Memories Yet</h3>
              <p className="mt-2 text-muted-foreground">
                The bot hasn&apos;t learned any server-specific information yet.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredMemories.map((memory) => (
                <div
                  key={memory.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${getTypeColor(memory.type)}`}>
                        {memory.type}
                      </span>
                      <h3 className="mt-2 font-semibold">{memory.title}</h3>
                    </div>
                    <button
                      onClick={() => handleDeleteMemory(memory.id)}
                      className="text-muted-foreground hover:text-red-500"
                      disabled={deleteServerMemoryMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{memory.content}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {new Date(memory.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* User Profiles Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {profilesLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredProfiles.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
              <Users className="mx-auto h-12 w-12 text-zinc-600" />
              <h3 className="mt-4 text-lg font-semibold">No User Profiles</h3>
              <p className="mt-2 text-muted-foreground">
                The bot hasn&apos;t learned about any users yet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredProfiles.map((profile) => (
                <div
                  key={profile.userId}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{profile.displayName}</h3>
                      <p className="text-sm text-muted-foreground">ID: {profile.userId}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteUserProfile(profile.userId)}
                      className="text-muted-foreground hover:text-red-500"
                      disabled={deleteUserProfileMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-3 text-sm">{profile.summary}</p>
                  {profile.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {profile.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-zinc-800 px-2 py-1 text-xs"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Last updated: {new Date(profile.lastUpdated).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    event: 'bg-blue-500/10 text-blue-500',
    meme: 'bg-purple-500/10 text-purple-500',
    rule: 'bg-yellow-500/10 text-yellow-500',
    habit: 'bg-green-500/10 text-green-500',
    plan: 'bg-cyan-500/10 text-cyan-500',
  }
  return colors[type] || 'bg-zinc-500/10 text-zinc-400'
}
