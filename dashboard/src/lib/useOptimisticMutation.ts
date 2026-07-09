/**
 * Optimistic mutation hooks for instant UI updates
 * Updates happen immediately in the UI, then sync with server
 */

import { useMutation, useQueryClient, QueryKey } from '@tanstack/react-query'
import { api, GuildConfig } from './api'
import { useCallback } from 'react'

interface OptimisticMutationOptions<TData, TVariables> {
  queryKey: QueryKey
  mutationFn: (variables: TVariables) => Promise<TData>
  // Function to optimistically update cache before server response
  optimisticUpdate?: (old: TData | undefined, variables: TVariables) => TData
  onSuccess?: (data: TData, variables: TVariables) => void
  onError?: (error: Error, variables: TVariables, context: unknown) => void
}

/**
 * Hook for mutations with optimistic updates
 * UI updates instantly, then confirms with server
 */
export function useOptimisticMutation<TData, TVariables>({
  queryKey,
  mutationFn,
  optimisticUpdate,
  onSuccess,
  onError,
}: OptimisticMutationOptions<TData, TVariables>) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,
    
    // Before mutation - optimistically update cache
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey })
      
      // Snapshot previous value
      const previousData = queryClient.getQueryData<TData>(queryKey)
      
      // Optimistically update
      if (optimisticUpdate && previousData !== undefined) {
        queryClient.setQueryData(queryKey, optimisticUpdate(previousData, variables))
      }
      
      return { previousData }
    },
    
    // On error - rollback to previous value
    onError: (error, variables, context) => {
      if (context?.previousData !== undefined) {
        queryClient.setQueryData(queryKey, context.previousData)
      }
      onError?.(error as Error, variables, context)
    },
    
    // On success - update with server response
    onSuccess: (data, variables) => {
      // Optionally update cache with server response
      queryClient.setQueryData(queryKey, data)
      onSuccess?.(data, variables)
    },
    
    // Always refetch after mutation settles
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey })
    },
  })
}

interface ConfigResponse {
  config: GuildConfig
}

/**
 * Optimistic guild config mutation
 * Config changes appear instantly in UI
 */
export function useOptimisticConfigMutation(guildId: string) {
  const queryClient = useQueryClient()
  const queryKey = ['guild-config', guildId]

  const mutation = useMutation({
    mutationFn: (updates: Partial<GuildConfig>) => 
      api.patch<ConfigResponse>(`/api/guilds/${guildId}/config`, updates),
    
    onMutate: async (updates) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey })
      
      // Snapshot previous value
      const previous = queryClient.getQueryData<ConfigResponse>(queryKey)
      
      // Optimistically update - merge updates into existing config
      if (previous?.config) {
        queryClient.setQueryData<ConfigResponse>(queryKey, {
          ...previous,
          config: { ...previous.config, ...updates },
        })
      }
      
      return { previous }
    },
    
    onError: (_error, _variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey })
    },
  })

  // Convenience method to update a single field instantly
  const updateField = useCallback(<K extends keyof GuildConfig>(
    field: K, 
    value: GuildConfig[K]
  ) => {
    return mutation.mutateAsync({ [field]: value } as Partial<GuildConfig>)
  }, [mutation])

  return {
    ...mutation,
    updateField,
  }
}

/**
 * Hook for instant toggle mutations
 * Perfect for boolean settings
 */
export function useToggleMutation(
  guildId: string, 
  field: keyof GuildConfig,
  currentValue: boolean
) {
  const { mutate, isPending } = useOptimisticConfigMutation(guildId)

  const toggle = useCallback(() => {
    mutate({ [field]: !currentValue } as Partial<GuildConfig>)
  }, [mutate, field, currentValue])

  return { toggle, isPending }
}
