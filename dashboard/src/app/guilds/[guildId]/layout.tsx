'use client'

import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, User, Brain, Mic,
  ScrollText, BarChart3,
  ChevronLeft, Settings, Sparkles, Server, Bot,
  FileText, Database, CalendarDays
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navSections = [
  {
    label: 'Dashboard',
    items: [
      { href: '', label: 'Overview', icon: LayoutDashboard },
      { href: '/logs', label: 'Activity Logs', icon: ScrollText },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
    ]
  },
  {
    label: 'Configuration',
    items: [
      { href: '/ai', label: 'AI Settings', icon: Brain },
      { href: '/voice', label: 'Voice & TTS', icon: Mic },
      { href: '/learning', label: 'Learning', icon: Sparkles },
      { href: '/personality', label: 'Personality', icon: User },
    ]
  },
  {
    label: 'Data',
    items: [
      { href: '/memory', label: 'Memories', icon: Database },
      { href: '/voice-sessions', label: 'Session History', icon: CalendarDays },
      { href: '/transcript', label: 'Voice Transcripts', icon: FileText },
      { href: '/ai-transcript', label: 'AI Transcript', icon: Bot },
    ]
  },
  {
    label: 'Server',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/env', label: 'Environment', icon: Server },
    ]
  },
]

export default function GuildLayout({ children }: { children: React.ReactNode }) {
  const { guildId } = useParams()
  const pathname = usePathname()
  const basePath = `/guilds/${guildId}`

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-zinc-800 bg-zinc-900/30">
        {/* Logo Header */}
        <div className="border-b border-zinc-800 p-4">
          <Link
            href="/guilds"
            className="flex items-center gap-3 group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-purple-600 shadow-lg shadow-primary/20">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="font-bold text-white">Mr. Handi WC</h1>
              <p className="text-xs text-muted-foreground">Dashboard</p>
            </div>
          </Link>
        </div>

        {/* Back to servers */}
        <div className="px-3 py-2">
          <Link
            href="/guilds"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-zinc-800 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            All Servers
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {navSections.map((section) => (
            <div key={section.label} className="mb-6">
              <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {section.label}
              </h3>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const href = `${basePath}${item.href}`
                  const isActive = item.href === ''
                    ? pathname === basePath
                    : pathname.startsWith(href)

                  return (
                    <Link
                      key={item.href}
                      href={href}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                        isActive
                          ? 'bg-primary/10 text-primary shadow-sm'
                          : 'text-muted-foreground hover:bg-zinc-800/80 hover:text-foreground'
                      )}
                    >
                      <item.icon className={cn('h-4 w-4', isActive && 'text-primary')} />
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <p className="text-xs text-muted-foreground">
              Connected & Syncing
            </p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-zinc-950">
        <div className="mx-auto max-w-6xl p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
