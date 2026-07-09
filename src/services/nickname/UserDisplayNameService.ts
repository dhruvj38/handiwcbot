import { GuildMember, Client, Guild } from 'discord.js';
import { MemoryRepository } from '../memory/MemoryRepository';
import { logger } from '../../utils/logger';

/**
 * Centralized service for resolving user display names.
 * Priority order:
 * 1. Preferred nickname (learned/stored in DB)
 * 2. Server nickname (Discord guild member nick)
 * 3. Display name (Discord global display name)
 * 4. Username (fallback)
 * 
 * NEVER returns Discord tags (username#1234) or raw mentions (<@id>).
 */
export class UserDisplayNameService {
    private repository: MemoryRepository;
    private client: Client | null = null;

    // Cache for resolved names (serverId:userId -> name)
    private nameCache: Map<string, { name: string; expiresAt: number }> = new Map();
    private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    constructor(repository: MemoryRepository) {
        this.repository = repository;
    }

    /**
     * Set the Discord client for fetching guild members
     */
    setClient(client: Client): void {
        this.client = client;
    }

    /**
     * Get the display name for a user in a specific server.
     * Uses cache when available, fetches from DB and Discord as needed.
     */
    async getDisplayName(serverId: string, userId: string, guild?: Guild): Promise<string> {
        const cacheKey = `${serverId}:${userId}`;
        
        // Check cache first
        const cached = this.nameCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.name;
        }

        try {
            // 1. Check for preferred nickname in DB
            const profile = await this.repository.getUserProfile(serverId, userId);
            if (profile?.preferredNickname) {
                this.cacheResult(cacheKey, profile.preferredNickname);
                return profile.preferredNickname;
            }

            // 2. Try to get server nickname from Discord
            const guildToUse = guild || (this.client ? this.client.guilds.cache.get(serverId) : null);
            if (guildToUse) {
                try {
                    const member = await guildToUse.members.fetch(userId).catch(() => null);
                    if (member) {
                        // Prefer server nickname, then display name, then username
                        const name = member.nickname || member.displayName || member.user.username;
                        this.cacheResult(cacheKey, name);
                        return name;
                    }
                } catch (err) {
                    logger.debug(`Could not fetch member ${userId} from guild ${serverId}`);
                }
            }

            // 3. Use stored displayName from profile if available
            if (profile?.displayName && profile.displayName !== `User ${userId}`) {
                this.cacheResult(cacheKey, profile.displayName);
                return profile.displayName;
            }

            // 4. Try to fetch user from Discord client directly
            if (this.client) {
                try {
                    const user = await this.client.users.fetch(userId).catch(() => null);
                    if (user) {
                        const name = user.displayName || user.username;
                        this.cacheResult(cacheKey, name);
                        return name;
                    }
                } catch (err) {
                    logger.debug(`Could not fetch user ${userId}`);
                }
            }

            // 5. Last resort - return a generic name (not the user ID or tag)
            return profile?.displayName || 'someone';
        } catch (error) {
            logger.error(`Error resolving display name for ${userId}:`, error);
            return 'someone';
        }
    }

    /**
     * Get display name directly from a GuildMember object.
     * Checks DB for preferred nickname first.
     */
    async getDisplayNameForMember(member: GuildMember): Promise<string> {
        const serverId = member.guild.id;
        const userId = member.id;
        const cacheKey = `${serverId}:${userId}`;

        // Check cache first
        const cached = this.nameCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.name;
        }

        try {
            // 1. Check for preferred nickname in DB
            const profile = await this.repository.getUserProfile(serverId, userId);
            if (profile?.preferredNickname) {
                this.cacheResult(cacheKey, profile.preferredNickname);
                return profile.preferredNickname;
            }

            // 2. Use server nickname or display name
            const name = member.nickname || member.displayName || member.user.username;
            this.cacheResult(cacheKey, name);
            return name;
        } catch (error) {
            logger.error(`Error resolving display name for member ${userId}:`, error);
            return member.nickname || member.displayName || member.user.username;
        }
    }

    /**
     * Resolve multiple user IDs to display names efficiently.
     */
    async resolveMultiple(
        serverId: string,
        userIds: string[],
        guild?: Guild
    ): Promise<Map<string, string>> {
        const results = new Map<string, string>();
        
        // Process in parallel for efficiency
        await Promise.all(
            userIds.map(async (userId) => {
                const name = await this.getDisplayName(serverId, userId, guild);
                results.set(userId, name);
            })
        );

        return results;
    }

    /**
     * Invalidate cache for a specific user (call after nickname update)
     */
    invalidateCache(serverId: string, userId: string): void {
        const cacheKey = `${serverId}:${userId}`;
        this.nameCache.delete(cacheKey);
    }

    /**
     * Clear entire cache
     */
    clearCache(): void {
        this.nameCache.clear();
    }

    private cacheResult(key: string, name: string): void {
        this.nameCache.set(key, {
            name,
            expiresAt: Date.now() + this.CACHE_TTL_MS,
        });
    }
}

/**
 * Sanitize outgoing bot messages to remove Discord tags and mentions.
 * Replaces:
 * - username#1234 -> username
 * - <@123456789> -> resolved name or "them"
 * - <@!123456789> -> resolved name or "them"
 */
export function sanitizeOutputMessage(
    message: string,
    nameResolver?: (userId: string) => string | undefined
): string {
    // Remove Discord tags (username#1234)
    let sanitized = message.replace(/(\w+)#\d{4}/g, '$1');

    // Replace user mentions with resolved names or generic pronoun
    sanitized = sanitized.replace(/<@!?(\d+)>/g, (_match, userId) => {
        if (nameResolver) {
            const name = nameResolver(userId);
            if (name) return name;
        }
        return 'them';
    });

    return sanitized;
}

/**
 * Detect if a message contains nickname-setting intent.
 * Returns the requested nickname if detected.
 */
export function detectNicknameRequest(message: string): string | null {
    const patterns = [
        /call me (?:["']?)([^"'.,!?]+)(?:["']?)/i,
        /my name is (?:["']?)([^"'.,!?]+)(?:["']?)/i,
        /i(?:'m| am) (?:["']?)([^"'.,!?]+)(?:["']?)/i,
        /(?:from now on )?call me (?:["']?)([^"'.,!?]+)(?:["']?)/i,
        /it'?s (?:["']?)([^"'.,!?]+)(?:["']?) not \w+/i,
        /nickname(?:'?s| is)? (?:["']?)([^"'.,!?]+)(?:["']?)/i,
    ];

    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            const nickname = match[1].trim();
            // Validate: not too long, not empty, not just whitespace
            if (nickname.length > 0 && nickname.length <= 32 && !/^\s+$/.test(nickname)) {
                return nickname;
            }
        }
    }

    return null;
}
