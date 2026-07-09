'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, AuthResponse } from '@/lib/api'
import { Loader2 } from 'lucide-react'

export default function HomePage() {
  const router = useRouter()
  
  const { data, isLoading, error } = useQuery<AuthResponse>({
    queryKey: ['auth'],
    queryFn: () => api.get('/api/auth/me'),
    retry: false,
  })

  useEffect(() => {
    if (error) {
      router.push('/login')
    } else if (data && data.guilds.length > 0) {
      router.push(`/guilds/${data.guilds[0].id}`)
    } else if (data) {
      router.push('/guilds')
    }
  }, [data, error, router])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )
}
