import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export interface ConfigChangeEvent {
  type: 'config:updated' | 'personality:updated' | 'env:changed' | 'bot:status' | 'tts:usage' | 'log:created' | 'transcript:new';
  guildId?: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  actor?: string;
  timestamp: string;
  requiresRestart?: boolean;
  message?: string;
  // TTS usage data
  ttsUsage?: {
    characterCount: number;
    requestId: string | null;
    latencyMs: number;
    textLength: number;
    sessionTotal: number;
    estimatedCostUsd: number;
  };
  // Transcript data
  transcript?: {
    id: string;
    channelId: string;
    userId: string | null;
    userName?: string | null;
    rawText: string;
    startedAt: string;
    endedAt: string;
  };
}

interface ClientSubscription {
  ws: WebSocket;
  guildIds: Set<string>;
  isAlive: boolean;
}

class ConfigWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientSubscription> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize WebSocket server attached to HTTP server
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      const subscription: ClientSubscription = {
        ws,
        guildIds: new Set(),
        isAlive: true,
      };
      this.clients.set(ws, subscription);

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      });

      ws.on('pong', () => {
        const client = this.clients.get(ws);
        if (client) client.isAlive = true;
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('[WebSocket] Client error:', err);
        this.clients.delete(ws);
      });

      // Send welcome message
      this.send(ws, {
        type: 'bot:status',
        message: 'Connected to config WebSocket',
        timestamp: new Date().toISOString(),
      });
    });

    // Heartbeat to detect dead connections
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, ws) => {
        if (!client.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
          return;
        }
        client.isAlive = false;
        ws.ping();
      });
    }, 30000);

    console.log('[WebSocket] Server initialized on /ws path');
  }

  /**
   * Handle incoming messages from clients
   */
  private handleMessage(ws: WebSocket, message: { type: string; guildId?: string; guildIds?: string[] }): void {
    const client = this.clients.get(ws);
    if (!client) return;

    switch (message.type) {
      case 'subscribe':
        if (message.guildId) {
          client.guildIds.add(message.guildId);
        }
        if (message.guildIds) {
          message.guildIds.forEach(id => client.guildIds.add(id));
        }
        break;

      case 'unsubscribe':
        if (message.guildId) {
          client.guildIds.delete(message.guildId);
        }
        break;

      case 'ping':
        this.send(ws, { type: 'bot:status', message: 'pong', timestamp: new Date().toISOString() });
        break;

      default:
        console.log(`[WebSocket] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Send message to specific client
   */
  private send(ws: WebSocket, event: ConfigChangeEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /**
   * Broadcast config change to all clients subscribed to a guild
   */
  broadcast(guildId: string, event: Omit<ConfigChangeEvent, 'timestamp'>): void {
    const fullEvent: ConfigChangeEvent = {
      ...event,
      guildId,
      timestamp: new Date().toISOString(),
    };

    let sentCount = 0;
    this.clients.forEach((client) => {
      if (client.guildIds.has(guildId) || client.guildIds.has('*')) {
        this.send(client.ws, fullEvent);
        sentCount++;
      }
    });

    console.log(`[WebSocket] Broadcast to ${sentCount} clients:`, {
      type: event.type,
      guildId,
      field: event.field,
      actor: event.actor,
    });
  }

  /**
   * Broadcast to ALL connected clients (for global events like env changes)
   */
  broadcastAll(event: Omit<ConfigChangeEvent, 'timestamp'>): void {
    const fullEvent: ConfigChangeEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    let sentCount = 0;
    this.clients.forEach((client) => {
      this.send(client.ws, fullEvent);
      sentCount++;
    });

    console.log(`[WebSocket] Broadcast to ALL ${sentCount} clients:`, {
      type: event.type,
      message: event.message,
    });
  }

  /**
   * Broadcast new transcript to subscribed clients (instant update)
   */
  broadcastTranscript(guildId: string, transcript: {
    id: string;
    channelId: string;
    userId: string | null;
    userName?: string | null;
    rawText: string;
    startedAt: string;
    endedAt: string;
  }): void {
    this.broadcast(guildId, {
      type: 'transcript:new',
      transcript,
    });
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.clients.forEach((_, ws) => {
      ws.close();
    });
    this.clients.clear();
    this.wss?.close();
    console.log('[WebSocket] Server shut down');
  }
}

// Singleton instance
export const configWebSocket = new ConfigWebSocketServer();
