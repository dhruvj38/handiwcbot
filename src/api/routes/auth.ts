import { Router } from 'express';
import { getPrismaClient } from '../../db/client';
import { requireAuth, fetchUserGuilds, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const DISCORD_API = 'https://discord.com/api/v10';

/**
 * GET /api/auth/login
 * Redirect to Discord OAuth
 */
router.get('/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: `${process.env.API_URL || 'http://localhost:3000'}/api/auth/callback`,
    response_type: 'code',
    scope: 'identify guilds',
  });
  
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

/**
 * GET /api/auth/callback
 * Handle OAuth callback
 */
router.get('/callback', asyncHandler(async (req, res) => {
  const { code } = req.query;
  
  if (!code || typeof code !== 'string') {
    return res.redirect(`${process.env.DASHBOARD_URL || 'http://localhost:3001'}/login?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.API_URL || 'http://localhost:3000'}/api/auth/callback`,
      }),
    });

    if (!tokenRes.ok) {
      console.error('Token exchange failed:', await tokenRes.text());
      return res.redirect(`${process.env.DASHBOARD_URL || 'http://localhost:3001'}/login?error=token_failed`);
    }

    const tokens = await tokenRes.json();

    // Get user info
    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      console.error('User fetch failed:', await userRes.text());
      return res.redirect(`${process.env.DASHBOARD_URL || 'http://localhost:3001'}/login?error=user_failed`);
    }

    const user = await userRes.json();

    // Create or update session
    const db = getPrismaClient();
    const session = await db.dashboardSession.upsert({
      where: { discordId: user.id },
      update: {
        username: user.username,
        avatar: user.avatar,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
      create: {
        discordId: user.id,
        username: user.username,
        avatar: user.avatar,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });

    // Set session cookie
    res.cookie('session_id', session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.redirect(process.env.DASHBOARD_URL || 'http://localhost:3001');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.DASHBOARD_URL || 'http://localhost:3001'}/login?error=unknown`);
  }
}));

/**
 * GET /api/auth/me
 * Get current user and their manageable guilds
 */
router.get('/me', requireAuth, fetchUserGuilds, (req: AuthenticatedRequest, res) => {
  res.json({
    user: {
      id: req.user!.id,
      username: req.user!.username,
      avatar: req.user!.avatar,
    },
    guilds: req.guilds?.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
    })) || [],
  });
});

/**
 * POST /api/auth/logout
 * Clear session
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const sessionId = req.cookies?.session_id;
  
  if (sessionId) {
    const db = getPrismaClient();
    await db.dashboardSession.delete({ where: { id: sessionId } }).catch(() => {});
  }
  
  res.clearCookie('session_id');
  res.json({ success: true });
}));

export default router;
