/**
 * Parse relative time strings like "1h ago", "30m ago", "now"
 */
export function parseRelativeTime(timeStr: string): Date {
    const now = new Date();

    if (timeStr.toLowerCase() === 'now') {
        return now;
    }

    const relativeMatch = timeStr.match(/^(\d+)(s|m|h|d)\s*ago$/i);
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1]!, 10);
        const unit = relativeMatch[2]!.toLowerCase();

        const msPerUnit: Record<string, number> = {
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
        };

        const ms = amount * (msPerUnit[unit] || 0);
        return new Date(now.getTime() - ms);
    }

    // Try parsing as ISO date
    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) {
        return parsed;
    }

    throw new Error(`Invalid time format: ${timeStr}. Use ISO format or relative like "1h ago"`);
}

/**
 * Paginate an array of items
 */
export function paginateItems<T>(items: T[], pageSize: number = 10): T[][] {
    const pages: T[][] = [];
    for (let i = 0; i < items.length; i += pageSize) {
        pages.push(items.slice(i, i + pageSize));
    }
    return pages;
}
