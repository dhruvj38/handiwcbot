import { Request, Response, NextFunction } from 'express';
import { getPrismaClient } from '../../db/client';

const DISCORD_API = 'https://discord.com/api/v10';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    avatar: string | null;
    sessionId: string;
    accessToken: string;
  };
  guilds?: Array<{
    id: string;
    name: string;
    icon: string | null;
    permissions: string;
  }>;
}

/**
 * Middleware to verify session and attach user info
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const sessionId = req.cookies?.session_id;
  
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const db = getPrismaClient();
    const session = await db.dashboardSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    if (session.expiresAt < new Date()) {
      // Try to refresh token
      if (session.refreshToken) {
        try {
          const refreshed = await refreshAccessToken(session.refreshToken);
          await db.dashboardSession.update({
            where: { id: sessionId },
            data: {
              accessToken: refreshed.access_token,
              refreshToken: refreshed.refresh_token,
              expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
            },
          });
          session.accessToken = refreshed.access_token;
        } catch {
          return res.status(401).json({ error: 'Session expired' });
        }
      } else {
        return res.status(401).json({ error: 'Session expired' });
      }
    }

    req.user = {
      id: session.discordId,
      username: session.username,
      avatar: session.avatar,
      sessionId: session.id,
      accessToken: session.accessToken,
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Fetch user's manageable guilds and attach to request
 */
export async function fetchUserGuilds(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${req.user.accessToken}` },
    });

    if (!guildsRes.ok) {
      return res.status(401).json({ error: 'Failed to fetch guilds' });
    }

    const allGuilds = await guildsRes.json();
    
    // Filter to guilds user can manage (has MANAGE_GUILD permission - 0x20)
    req.guilds = allGuilds.filter((g: { permissions: string }) => 
      (parseInt(g.permissions) & 0x20) === 0x20
    );

    next();
  } catch (error) {
    console.error('Fetch guilds error:', error);
    return res.status(500).json({ error: 'Failed to fetch guilds' });
  }
}

/**
 * Middleware to verify user can access a specific guild
 */
export function requireGuildAccess(paramName = 'guildId') {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const guildId = req.params[paramName];
    
    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID required' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      // Fetch guilds if not already fetched
      if (!req.guilds) {
        const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, {
          headers: { Authorization: `Bearer ${req.user.accessToken}` },
        });

        if (!guildsRes.ok) {
          return res.status(401).json({ error: 'Failed to verify guild access' });
        }

        const allGuilds = await guildsRes.json();
        req.guilds = allGuilds.filter((g: { permissions: string }) => 
          (parseInt(g.permissions) & 0x20) === 0x20
        );
      }

      const hasAccess = req.guilds?.some(g => g.id === guildId);
      
      if (!hasAccess) {
        return res.status(403).json({ error: 'No access to this guild' });
      }

      next();
    } catch (error) {
      console.error('Guild access check error:', error);
      return res.status(500).json({ error: 'Failed to verify guild access' });
    }
  };
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error('Failed to refresh token');
  }

  return res.json();
}
