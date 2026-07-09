import * as fs from 'fs';
import * as path from 'path';

/**
 * Environment variable definition with metadata
 */
interface EnvVarDefinition {
  key: string;
  category: 'discord' | 'ai' | 'speech' | 'tts' | 'voice' | 'learning' | 'bot' | 'database' | 'dashboard';
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  sensitive: boolean; // If true, value is masked in responses
  requiresRestart: boolean; // If true, changes require bot restart
  defaultValue?: string;
}

/**
 * Environment variables exposed in dashboard
 * Only includes secrets and startup-required settings.
 * Runtime configurable settings are now in GuildConfig (database).
 */
const ENV_DEFINITIONS: EnvVarDefinition[] = [
  // Discord Credentials
  { key: 'DISCORD_TOKEN', category: 'discord', label: 'Bot Token', description: 'Discord bot token', type: 'string', sensitive: true, requiresRestart: true },
  { key: 'DISCORD_CLIENT_ID', category: 'discord', label: 'Client ID', description: 'Discord application client ID', type: 'string', sensitive: false, requiresRestart: true },
  { key: 'DISCORD_CLIENT_SECRET', category: 'discord', label: 'Client Secret', description: 'Discord OAuth client secret', type: 'string', sensitive: true, requiresRestart: true },
  
  // Database
  { key: 'DATABASE_URL', category: 'database', label: 'Database URL', description: 'PostgreSQL connection string', type: 'string', sensitive: true, requiresRestart: true },
  
  // AI API Key
  { key: 'AI_API_KEY', category: 'ai', label: 'API Key', description: 'Google AI API key', type: 'string', sensitive: true, requiresRestart: true },
  
  // Speech-to-Text
  { key: 'SPEECH_PROVIDER', category: 'speech', label: 'Provider', description: 'Speech-to-text provider (local or groq)', type: 'string', sensitive: false, requiresRestart: true, defaultValue: 'local' },
  { key: 'SPEECH_SERVICE_URL', category: 'speech', label: 'Service URL', description: 'Whisper server URL (for local provider)', type: 'string', sensitive: false, requiresRestart: true, defaultValue: 'http://localhost:8000/transcribe' },
  { key: 'GROQ_API_KEY', category: 'speech', label: 'Groq API Key', description: 'Groq API key (for groq provider)', type: 'string', sensitive: true, requiresRestart: true },
  
  // Text-to-Speech
  { key: 'ELEVENLABS_API_KEY', category: 'tts', label: 'ElevenLabs API Key', description: 'ElevenLabs API key for TTS', type: 'string', sensitive: true, requiresRestart: false },
  
  // Server Configuration
  { key: 'API_PORT', category: 'dashboard', label: 'API Port', description: 'API server port', type: 'number', sensitive: false, requiresRestart: true, defaultValue: '3000' },
  { key: 'API_URL', category: 'dashboard', label: 'API URL', description: 'API server URL', type: 'string', sensitive: false, requiresRestart: true, defaultValue: 'http://localhost:3000' },
  { key: 'DASHBOARD_URL', category: 'dashboard', label: 'Dashboard URL', description: 'Dashboard frontend URL', type: 'string', sensitive: false, requiresRestart: true, defaultValue: 'http://localhost:3001' },
  
  // Logging
  { key: 'LOG_LEVEL', category: 'bot', label: 'Log Level', description: 'Logging level (debug, info, warn, error)', type: 'string', sensitive: false, requiresRestart: false, defaultValue: 'info' },
];

export interface EnvConfigValue {
  key: string;
  value: string | null;
  displayValue: string; // Masked if sensitive
  category: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  sensitive: boolean;
  requiresRestart: boolean;
  defaultValue?: string;
}

export interface EnvUpdateResult {
  success: boolean;
  key: string;
  requiresRestart: boolean;
  message: string;
}

class EnvConfigServiceClass {
  private envPath: string;

  constructor() {
    this.envPath = path.resolve(process.cwd(), '.env');
    console.log('[EnvConfig] Service initialized, env path:', this.envPath);
  }

  /**
   * Get all environment variables with metadata
   */
  getAll(): EnvConfigValue[] {
    return ENV_DEFINITIONS.map(def => {
      const value = process.env[def.key] || null;
      return {
        key: def.key,
        value: def.sensitive ? null : value, // Don't expose sensitive values
        displayValue: def.sensitive && value ? '••••••••' : (value || def.defaultValue || ''),
        category: def.category,
        label: def.label,
        description: def.description,
        type: def.type,
        sensitive: def.sensitive,
        requiresRestart: def.requiresRestart,
        defaultValue: def.defaultValue,
      };
    });
  }

  /**
   * Get environment variables by category
   */
  getByCategory(category: string): EnvConfigValue[] {
    return this.getAll().filter(v => v.category === category);
  }

  /**
   * Get categories with their variables
   */
  getCategories(): { category: string; label: string; variables: EnvConfigValue[] }[] {
    const categoryLabels: Record<string, string> = {
      discord: 'Discord',
      ai: 'AI / Language Model',
      speech: 'Speech-to-Text',
      tts: 'Text-to-Speech',
      voice: 'Voice Chat',
      learning: 'Realtime Learning',
      bot: 'Bot Settings',
      dashboard: 'Dashboard',
      database: 'Database',
    };

    const categories = [...new Set(ENV_DEFINITIONS.map(d => d.category))];
    return categories.map(cat => ({
      category: cat,
      label: categoryLabels[cat] || cat,
      variables: this.getByCategory(cat),
    }));
  }

  /**
   * Update an environment variable
   * Returns whether a restart is required
   */
  async updateEnvVar(key: string, value: string, actor: string): Promise<EnvUpdateResult> {
    const definition = ENV_DEFINITIONS.find(d => d.key === key);
    if (!definition) {
      return {
        success: false,
        key,
        requiresRestart: false,
        message: `Unknown environment variable: ${key}`,
      };
    }

    try {
      // Read current .env file
      let envContent = '';
      if (fs.existsSync(this.envPath)) {
        envContent = fs.readFileSync(this.envPath, 'utf-8');
      }

      // Parse existing variables
      const lines = envContent.split('\n');
      let found = false;
      const newLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith(`${key}=`) || trimmed.startsWith(`${key} =`)) {
          found = true;
          return `${key}=${value}`;
        }
        return line;
      });

      // Add new variable if not found
      if (!found) {
        newLines.push(`${key}=${value}`);
      }

      // Write back to .env
      fs.writeFileSync(this.envPath, newLines.join('\n'));

      // Update process.env for immediate effect (if doesn't require restart)
      if (!definition.requiresRestart) {
        process.env[key] = value;
      }

      console.log(`[EnvConfig] Updated ${key} (by ${actor}) - requiresRestart: ${definition.requiresRestart}`);

      return {
        success: true,
        key,
        requiresRestart: definition.requiresRestart,
        message: definition.requiresRestart 
          ? `Updated ${definition.label}. Bot restart required for changes to take effect.`
          : `Updated ${definition.label}. Changes applied immediately.`,
      };
    } catch (error) {
      console.error(`[EnvConfig] Failed to update ${key}:`, error);
      return {
        success: false,
        key,
        requiresRestart: false,
        message: `Failed to update ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Bulk update multiple environment variables
   */
  async updateMany(updates: { key: string; value: string }[], actor: string): Promise<EnvUpdateResult[]> {
    const results: EnvUpdateResult[] = [];
    for (const update of updates) {
      const result = await this.updateEnvVar(update.key, update.value, actor);
      results.push(result);
    }
    return results;
  }

  /**
   * Get definition for a specific key
   */
  getDefinition(key: string): EnvVarDefinition | undefined {
    return ENV_DEFINITIONS.find(d => d.key === key);
  }
}

export const envConfigService = new EnvConfigServiceClass();
