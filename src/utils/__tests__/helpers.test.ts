import { truncateText, chunkArray, formatRelativeTime } from '../helpers';

describe('Helper Functions', () => {
    describe('truncateText', () => {
        it('should not truncate text shorter than max length', () => {
            const text = 'Hello world';
            expect(truncateText(text, 20)).toBe('Hello world');
        });

        it('should truncate text longer than max length', () => {
            const text = 'This is a very long text that needs to be truncated';
            const result = truncateText(text, 20);
            expect(result.length).toBe(20);
            expect(result).toBe('This is a very lo...');
        });

        it('should use custom suffix', () => {
            const text = 'This is a very long text';
            const result = truncateText(text, 15, '---');
            expect(result).toBe('This is a v---');
        });
    });

    describe('chunkArray', () => {
        it('should chunk array into smaller arrays', () => {
            const array = [1, 2, 3, 4, 5, 6, 7, 8, 9];
            const chunks = chunkArray(array, 3);
            expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
        });

        it('should handle arrays not evenly divisible', () => {
            const array = [1, 2, 3, 4, 5];
            const chunks = chunkArray(array, 2);
            expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
        });

        it('should handle empty arrays', () => {
            const chunks = chunkArray([], 3);
            expect(chunks).toEqual([]);
        });
    });

    describe('formatRelativeTime', () => {
        it('should format seconds ago', () => {
            const date = new Date(Date.now() - 30000); // 30 seconds ago
            const result = formatRelativeTime(date);
            expect(result).toBe('30s ago');
        });

        it('should format minutes ago', () => {
            const date = new Date(Date.now() - 300000); // 5 minutes ago
            const result = formatRelativeTime(date);
            expect(result).toBe('5m ago');
        });

        it('should format hours ago', () => {
            const date = new Date(Date.now() - 7200000); // 2 hours ago
            const result = formatRelativeTime(date);
            expect(result).toBe('2h ago');
        });

        it('should format days ago', () => {
            const date = new Date(Date.now() - 172800000); // 2 days ago
            const result = formatRelativeTime(date);
            expect(result).toBe('2d ago');
        });
    });
});
