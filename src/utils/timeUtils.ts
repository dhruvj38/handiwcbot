/**
 * Parse relative time strings like "1h ago", "30m ago", "1hr ago", "2 hours ago", "now"
 */
export function parseRelativeTime(timeStr: string): Date {
    const now = new Date();
    const normalized = timeStr.toLowerCase().trim();

    if (normalized === 'now') {
        return now;
    }

    // Match patterns like: "1h ago", "1hr ago", "1 hour ago", "30m ago", "30min ago", "2 days ago"
    const relativeMatch = normalized.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)\s*ago$/);
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1]!, 10);
        const unit = relativeMatch[2]!;

        // Map various unit names to milliseconds
        const msPerUnit: Record<string, number> = {
            // Seconds
            s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
            // Minutes
            m: 60 * 1000, min: 60 * 1000, mins: 60 * 1000, minute: 60 * 1000, minutes: 60 * 1000,
            // Hours
            h: 60 * 60 * 1000, hr: 60 * 60 * 1000, hrs: 60 * 60 * 1000, hour: 60 * 60 * 1000, hours: 60 * 60 * 1000,
            // Days
            d: 24 * 60 * 60 * 1000, day: 24 * 60 * 60 * 1000, days: 24 * 60 * 60 * 1000,
            // Weeks
            w: 7 * 24 * 60 * 60 * 1000, wk: 7 * 24 * 60 * 60 * 1000, wks: 7 * 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, weeks: 7 * 24 * 60 * 60 * 1000,
        };

        const ms = amount * (msPerUnit[unit] || 0);
        return new Date(now.getTime() - ms);
    }

    // Try parsing as ISO date
    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) {
        return parsed;
    }

    throw new Error(`Invalid time format: "${timeStr}". Use formats like "1h ago", "30min ago", "2 days ago", or an ISO date.`);
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
