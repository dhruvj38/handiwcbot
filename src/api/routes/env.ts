import { Router, Response, NextFunction } from 'express';
import { envConfigService } from '../services/EnvConfigService';
import { configWebSocket } from '../websocket';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

/**
 * Helper to wrap async route handlers
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler = (fn: (req: AuthenticatedRequest, res: Response) => Promise<any>) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
};

/**
 * GET /api/env
 * Get all environment variables (sensitive values masked)
 */
router.get('/', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  console.log(`[API][ENV] GET all env vars (by ${req.user?.username})`);
  
  const categories = envConfigService.getCategories();
  
  res.json({
    categories,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/env/:category
 * Get environment variables for a specific category
 */
router.get('/:category', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { category } = req.params;
  console.log(`[API][ENV] GET category ${category || 'unknown'} (by ${req.user?.username})`);
  
  const variables = envConfigService.getByCategory(category || '');
  
  if (variables.length === 0) {
    res.status(404).json({ error: `Category not found: ${category}` });
    return;
  }
  
  res.json({
    category,
    variables,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * PATCH /api/env
 * Update one or more environment variables
 */
router.patch('/', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const updates: { key: string; value: string }[] = req.body.updates;
  
  if (!updates || !Array.isArray(updates)) {
    res.status(400).json({ error: 'Missing updates array in request body' });
    return;
  }
  
  const actor = req.user?.username || 'Unknown';
  console.log(`[API][ENV] PATCH ${updates.length} vars (by ${actor})`);
  
  const results = await envConfigService.updateMany(updates, actor);
  
  // Check if any changes require restart
  const requiresRestart = results.some(r => r.requiresRestart && r.success);
  
  // Broadcast to all WebSocket clients
  for (const result of results) {
    if (result.success) {
      configWebSocket.broadcastAll({
        type: 'env:changed',
        field: result.key,
        actor,
        requiresRestart: result.requiresRestart,
        message: result.message,
      });
      
      console.log(`[ENV] ${result.key} updated by ${actor} - requiresRestart: ${result.requiresRestart}`);
    }
  }
  
  res.json({
    results,
    requiresRestart,
    message: requiresRestart 
      ? 'Some changes require a bot restart to take effect.'
      : 'All changes applied successfully.',
  });
}));

/**
 * PATCH /api/env/:key
 * Update a single environment variable
 */
router.patch('/:key', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { key } = req.params;
  const { value } = req.body;
  
  if (value === undefined) {
    res.status(400).json({ error: 'Missing value in request body' });
    return;
  }
  
  const actor = req.user?.username || 'Unknown';
  console.log(`[API][ENV] PATCH ${key || 'unknown'} (by ${actor})`);
  
  const result = await envConfigService.updateEnvVar(key || '', value, actor);
  
  if (result.success) {
    // Broadcast change to all WebSocket clients
    configWebSocket.broadcastAll({
      type: 'env:changed',
      field: key,
      actor,
      requiresRestart: result.requiresRestart,
      message: result.message,
    });
    
    console.log(`[ENV] ${key} updated by ${actor} - requiresRestart: ${result.requiresRestart}`);
  }
  
  res.json(result);
}));

export default router;
