/**
 * MessageCache - Caches server message data to avoid re-fetching
 * 
 * Features:
 * - Saves messages to CSV after fetching (for both caching and lookups)
 * - Checks for recent cache (<5 days) before fetching
 * - Supports incremental updates (fetch only new messages since last cache)
 * - Provides quick search through cached messages
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { ServerBible } from './types';

export interface CachedMessage {
    channelId: string;
    channelName: string;
    authorId: string;
    authorName: string;
    content: string;
    timestamp: Date;
    attachments: number;
    reactions: string;
    mentions: string;
}

export interface CacheMetadata {
    serverId: string;
    serverName: string;
    cachedAt: Date;
    messageCount: number;
    oldestMessage: Date;
    newestMessage: Date;
}

const CACHE_DIR = path.join(process.cwd(), 'data', 'server_captures');
const CACHE_MAX_AGE_DAYS = 5;

export class MessageCache {
    /**
     * Get the cache file paths for a server
     */
    private static getCachePaths(serverId: string): { csv: string; meta: string; bible: string } {
        return {
            csv: path.join(CACHE_DIR, `${serverId}_messages.csv`),
            meta: path.join(CACHE_DIR, `${serverId}_meta.json`),
            bible: path.join(CACHE_DIR, `${serverId}_bible.json`),
        };
    }

    /**
     * Ensure cache directory exists
     */
    private static ensureCacheDir(): void {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
            logger.info(`Created cache directory: ${CACHE_DIR}`);
        }
    }

    /**
     * Check if a valid cache exists (< 5 days old)
     */
    static hasValidCache(serverId: string): boolean {
        const paths = this.getCachePaths(serverId);

        if (!fs.existsSync(paths.csv) || !fs.existsSync(paths.meta)) {
            return false;
        }

        try {
            const meta = this.loadMetadata(serverId);
            if (!meta) return false;

            const ageMs = Date.now() - new Date(meta.cachedAt).getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);

            if (ageDays > CACHE_MAX_AGE_DAYS) {
                logger.info(`Cache for ${serverId} is ${ageDays.toFixed(1)} days old (max: ${CACHE_MAX_AGE_DAYS})`);
                return false;
            }

            logger.info(`Found valid cache for ${serverId}: ${meta.messageCount} messages, ${ageDays.toFixed(1)} days old`);
            return true;
        } catch (error) {
            logger.warn(`Error checking cache validity:`, error);
            return false;
        }
    }

    /**
     * Get cache age in days (returns null if no cache)
     */
    static getCacheAge(serverId: string): number | null {
        const meta = this.loadMetadata(serverId);
        if (!meta) return null;

        const ageMs = Date.now() - new Date(meta.cachedAt).getTime();
        return ageMs / (1000 * 60 * 60 * 24);
    }

    /**
     * Load metadata for a server cache
     */
    static loadMetadata(serverId: string): CacheMetadata | null {
        const paths = this.getCachePaths(serverId);

        if (!fs.existsSync(paths.meta)) {
            return null;
        }

        try {
            const content = fs.readFileSync(paths.meta, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            logger.warn(`Failed to load cache metadata for ${serverId}:`, error);
            return null;
        }
    }

    /**
     * Load cached messages from CSV
     */
    static loadMessages(serverId: string): CachedMessage[] {
        const paths = this.getCachePaths(serverId);

        if (!fs.existsSync(paths.csv)) {
            return [];
        }

        try {
            const content = fs.readFileSync(paths.csv, 'utf-8');
            const lines = content.split('\n').slice(1); // Skip header
            const messages: CachedMessage[] = [];

            for (const line of lines) {
                if (!line.trim()) continue;

                // Parse CSV (handle quoted fields with commas)
                const parsed = this.parseCSVLine(line);
                if (parsed.length >= 9) {
                    messages.push({
                        channelId: parsed[0]!,
                        channelName: parsed[1]!,
                        authorId: parsed[2]!,
                        authorName: parsed[3]!,
                        content: parsed[4]!,
                        timestamp: new Date(parsed[5]!),
                        attachments: parseInt(parsed[6]!) || 0,
                        reactions: parsed[7]!,
                        mentions: parsed[8]!,
                    });
                }
            }

            logger.info(`Loaded ${messages.length} messages from cache for ${serverId}`);
            return messages;
        } catch (error) {
            logger.error(`Failed to load cached messages for ${serverId}:`, error);
            return [];
        }
    }

    /**
     * Save messages to CSV cache
     */
    static saveMessages(
        serverId: string,
        serverName: string,
        messages: CachedMessage[]
    ): void {
        this.ensureCacheDir();
        const paths = this.getCachePaths(serverId);

        try {
            // Write CSV
            const header = 'channelId,channelName,authorId,authorName,content,timestamp,attachments,reactions,mentions';
            const rows = messages.map(m => {
                // Escape content for CSV (handle quotes and newlines)
                const escapedContent = `"${(m.content || '').replace(/"/g, '""').replace(/\n/g, '\\n')}"`;
                const escapedAuthor = `"${(m.authorName || '').replace(/"/g, '""')}"`;
                const escapedChannel = `"${(m.channelName || '').replace(/"/g, '""')}"`;

                return [
                    m.channelId,
                    escapedChannel,
                    m.authorId,
                    escapedAuthor,
                    escapedContent,
                    m.timestamp.toISOString(),
                    m.attachments,
                    `"${m.reactions || ''}"`,
                    `"${m.mentions || ''}"`,
                ].join(',');
            });

            fs.writeFileSync(paths.csv, [header, ...rows].join('\n'), 'utf-8');

            // Write metadata
            // Use reduce instead of spread to avoid stack overflow with large arrays
            let oldestTime = Infinity;
            let newestTime = -Infinity;
            for (const m of messages) {
                const t = m.timestamp.getTime();
                if (t < oldestTime) oldestTime = t;
                if (t > newestTime) newestTime = t;
            }
            const meta: CacheMetadata = {
                serverId,
                serverName,
                cachedAt: new Date(),
                messageCount: messages.length,
                oldestMessage: new Date(oldestTime),
                newestMessage: new Date(newestTime),
            };
            fs.writeFileSync(paths.meta, JSON.stringify(meta, null, 2), 'utf-8');

            logger.info(`Saved ${messages.length} messages to cache for ${serverId} (${serverName})`);
        } catch (error) {
            logger.error(`Failed to save message cache for ${serverId}:`, error);
        }
    }

    /**
     * Search cached messages by content (quick lookup for @bot queries)
     */
    static searchMessages(
        serverId: string,
        query: string,
        options: {
            maxResults?: number;
            authorId?: string;
            channelId?: string;
            afterDate?: Date;
        } = {}
    ): CachedMessage[] {
        const messages = this.loadMessages(serverId);
        const queryLower = query.toLowerCase();
        const maxResults = options.maxResults || 100;

        const filtered = messages.filter(m => {
            // Text search
            if (!m.content.toLowerCase().includes(queryLower)) return false;

            // Author filter
            if (options.authorId && m.authorId !== options.authorId) return false;

            // Channel filter
            if (options.channelId && m.channelId !== options.channelId) return false;

            // Date filter
            if (options.afterDate && m.timestamp < options.afterDate) return false;

            return true;
        });

        // Sort by recency
        filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        return filtered.slice(0, maxResults);
    }

    /**
     * Get message statistics from cache
     */
    static getStats(serverId: string): {
        total: number;
        byChannel: Record<string, number>;
        byAuthor: Record<string, number>;
        dateRange: { start: Date; end: Date } | null;
    } | null {
        const messages = this.loadMessages(serverId);
        if (messages.length === 0) return null;

        const byChannel: Record<string, number> = {};
        const byAuthor: Record<string, number> = {};

        for (const msg of messages) {
            byChannel[msg.channelName] = (byChannel[msg.channelName] || 0) + 1;
            byAuthor[msg.authorName] = (byAuthor[msg.authorName] || 0) + 1;
        }

        // Use loop instead of spread to avoid stack overflow with large arrays
        let minTime = Infinity;
        let maxTime = -Infinity;
        for (const m of messages) {
            const t = m.timestamp.getTime();
            if (t < minTime) minTime = t;
            if (t > maxTime) maxTime = t;
        }

        return {
            total: messages.length,
            byChannel,
            byAuthor,
            dateRange: {
                start: new Date(minTime),
                end: new Date(maxTime),
            },
        };
    }

    static saveBibleSnapshot(serverId: string, bible: ServerBible): void {
        this.ensureCacheDir();
        const paths = this.getCachePaths(serverId);

        try {
            const serialized = JSON.stringify(bible, null, 2);
            fs.writeFileSync(paths.bible, serialized, 'utf-8');
            logger.info(`Saved Server Bible snapshot for ${serverId}`);
        } catch (error) {
            logger.error(`Failed to save Server Bible snapshot for ${serverId}:`, error);
        }
    }

    static loadBibleSnapshot(serverId: string): ServerBible | null {
        const paths = this.getCachePaths(serverId);

        if (!fs.existsSync(paths.bible)) {
            return null;
        }

        try {
            const content = fs.readFileSync(paths.bible, 'utf-8');
            const parsed = JSON.parse(content) as ServerBible;

            if (parsed.metadata?.generatedAt) {
                parsed.metadata.generatedAt = new Date(parsed.metadata.generatedAt as any);
            }

            if (parsed.metadata?.dateRange) {
                const range = parsed.metadata.dateRange as any;
                parsed.metadata.dateRange = {
                    start: new Date(range.start),
                    end: new Date(range.end),
                };
            }

            return parsed;
        } catch (error) {
            logger.error(`Failed to load Server Bible snapshot for ${serverId}:`, error);
            return null;
        }
    }

    /**
     * Parse a CSV line handling quoted fields
     */
    private static parseCSVLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"' && !inQuotes) {
                inQuotes = true;
            } else if (char === '"' && inQuotes) {
                if (nextChar === '"') {
                    current += '"';
                    i++; // Skip escaped quote
                } else {
                    inQuotes = false;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);

        // Unescape newlines
        return result.map(s => s.replace(/\\n/g, '\n'));
    }

    /**
     * Delete cache for a server
     */
    static deleteCache(serverId: string): void {
        const paths = this.getCachePaths(serverId);

        try {
            if (fs.existsSync(paths.csv)) fs.unlinkSync(paths.csv);
            if (fs.existsSync(paths.meta)) fs.unlinkSync(paths.meta);
            if (fs.existsSync(paths.bible)) fs.unlinkSync(paths.bible);
            logger.info(`Deleted cache for ${serverId}`);
        } catch (error) {
            logger.warn(`Failed to delete cache for ${serverId}:`, error);
        }
    }
}
