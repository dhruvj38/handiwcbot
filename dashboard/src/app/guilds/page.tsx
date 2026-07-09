'use client'

import { useQuery } from '@tanstack/react-query'
import { api, AuthResponse, Guild } from '@/lib/api'
import { Loader2, Server } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'

export default function GuildsPage() {
  const { data, isLoading } = useQuery<AuthResponse>({
    queryKey: ['auth'],
    queryFn: () => api.get('/api/auth/me'),
  })

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-8 text-3xl font-bold">Select a Server</h1>
        
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data?.guilds.map((guild: Guild) => (
            <Link
              key={guild.id}
              href={`/guilds/${guild.id}`}
              className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-primary/50 hover:bg-zinc-900"
            >
              {guild.icon ? (
                <Image
                  src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                  alt={guild.name}
                  width={48}
                  height={48}
                  className="rounded-full"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
                  <Server className="h-6 w-6 text-zinc-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold">{guild.name}</h2>
                <p className="text-sm text-muted-foreground">Click to manage</p>
              </div>
            </Link>
          ))}
        </div>

        {data?.guilds.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <Server className="mx-auto h-12 w-12 text-zinc-600" />
            <h2 className="mt-4 text-lg font-semibold">No Servers Found</h2>
            <p className="mt-2 text-muted-foreground">
              You don&apos;t have admin access to any servers with the bot.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
