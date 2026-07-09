'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000/ws';

export interface ConfigChangeEvent {
  type: 'config:updated' | 'personality:updated' | 'env:changed' | 'bot:status' | 'log:created' | 'transcript:new';
  guildId?: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  actor?: string;
  timestamp: string;
  requiresRestart?: boolean;
  message?: string;
  // Transcript data
  transcript?: {
    id: string;
    channelId: string;
    userId: string | null;
    rawText: string;
    startedAt: string;
    endedAt: string;
  };
}

interface UseConfigWebSocketOptions {
  guildIds?: string[];
  onConfigChange?: (event: ConfigChangeEvent) => void;
  onEnvChange?: (event: ConfigChangeEvent) => void;
  onPersonalityChange?: (event: ConfigChangeEvent) => void;
  onTranscript?: (event: ConfigChangeEvent) => void;
  onLog?: (event: ConfigChangeEvent) => void;
  enabled?: boolean;
}

export function useConfigWebSocket(options: UseConfigWebSocketOptions = {}) {
  const {
    guildIds = [],
    onConfigChange,
    onEnvChange,
    onPersonalityChange,
    onTranscript,
    onLog,
    enabled = true,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<ConfigChangeEvent | null>(null);
  const guildIdsRef = useRef<string[]>(guildIds);
  const callbacksRef = useRef({
    onConfigChange,
    onEnvChange,
    onPersonalityChange,
    onTranscript,
    onLog,
  });

  useEffect(() => {
    guildIdsRef.current = guildIds;
  }, [guildIds]);

  useEffect(() => {
    callbacksRef.current = {
      onConfigChange,
      onEnvChange,
      onPersonalityChange,
      onTranscript,
      onLog,
    };
  }, [onConfigChange, onEnvChange, onPersonalityChange, onTranscript, onLog]);

  const connect = useCallback(() => {
    if (!enabled) return;

    // Avoid opening multiple connections if one is already active
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    
    try {
      console.log('[WebSocket] Connecting to', WS_URL);
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setIsConnected(true);

        const currentGuildIds = guildIdsRef.current;

        // Subscribe to guilds
        if (currentGuildIds.length > 0) {
          ws.send(JSON.stringify({ type: 'subscribe', guildIds: currentGuildIds }));
          console.log('[WebSocket] Subscribed to guilds:', currentGuildIds);
        } else {
          // Subscribe to all events if no specific guilds
          ws.send(JSON.stringify({ type: 'subscribe', guildIds: ['*'] }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data: ConfigChangeEvent = JSON.parse(event.data);
          console.log('[WebSocket] Received:', data);
          setLastEvent(data);

          // Handle different event types
          switch (data.type) {
            case 'config:updated': {
              console.log(`[WebSocket] Config updated: ${data.field} = ${JSON.stringify(data.newValue)} (by ${data.actor})`);
              
              // Invalidate relevant queries for immediate UI update
              if (data.guildId) {
                queryClient.invalidateQueries({ queryKey: ['guild-config', data.guildId] });
                queryClient.invalidateQueries({ queryKey: ['guild-metrics', data.guildId] });
              }
              
              callbacksRef.current.onConfigChange?.(data);
              break;
            }

            case 'personality:updated': {
              console.log(`[WebSocket] Personality updated for guild ${data.guildId} (by ${data.actor})`);
              
              if (data.guildId) {
                queryClient.invalidateQueries({ queryKey: ['personality', data.guildId] });
              }
              
              callbacksRef.current.onPersonalityChange?.(data);
              break;
            }

            case 'env:changed': {
              console.log(`[WebSocket] Env changed: ${data.field} - requiresRestart: ${data.requiresRestart}`);
              
              // Invalidate env queries
              queryClient.invalidateQueries({ queryKey: ['env'] });
              
              callbacksRef.current.onEnvChange?.(data);
              break;
            }

            case 'log:created': {
              if (data.guildId) {
                queryClient.invalidateQueries({ queryKey: ['logs', data.guildId] });
              }
              callbacksRef.current.onLog?.(data);
              break;
            }

            case 'transcript:new': {
              // Instant transcript update - append to cache directly
              if (data.guildId && data.transcript) {
                console.log('[WebSocket] New transcript:', data.transcript.rawText?.substring(0, 50));
                // Invalidate to trigger refetch with new data
                queryClient.invalidateQueries({ 
                  queryKey: ['transcripts', data.guildId],
                  refetchType: 'active',
                });
              }
              callbacksRef.current.onTranscript?.(data);
              break;
            }

            case 'bot:status': {
              console.log('[WebSocket] Bot status:', data.message);
              break;
            }
          }
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setIsConnected(false);
        wsRef.current = null;

        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[WebSocket] Reconnecting...');
          connect();
        }, 3000);
      };

      ws.onerror = (err) => {
        console.error('[WebSocket] Error:', err);
      };
    } catch (err) {
      console.error('[WebSocket] Failed to connect:', err);
    }
  }, [enabled, queryClient]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Re-subscribe when guildIds change
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && guildIds.length > 0) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', guildIds }));
      console.log('[WebSocket] Re-subscribed to guilds:', guildIds);
    }
  }, [guildIds]);

  const subscribe = useCallback((guildId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', guildId }));
      console.log('[WebSocket] Subscribed to guild:', guildId);
    }
  }, []);

  const unsubscribe = useCallback((guildId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', guildId }));
      console.log('[WebSocket] Unsubscribed from guild:', guildId);
    }
  }, []);

  return {
    isConnected,
    lastEvent,
    subscribe,
    unsubscribe,
  };
}

/**
 * Hook for using WebSocket with a specific guild
 */
export function useGuildConfigWebSocket(guildId: string, options: Omit<UseConfigWebSocketOptions, 'guildIds'> = {}) {
  return useConfigWebSocket({
    ...options,
    guildIds: [guildId],
  });
}
