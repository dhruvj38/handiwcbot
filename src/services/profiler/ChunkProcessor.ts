/**
 * LAYER 1: Conversation Chunking
 * Breaks raw messages into meaningful conversation chunks
 */

import { RawMessage, ConversationChunk } from './types';

export class ChunkProcessor {
    /**
     * Split messages into conversation chunks by channel and time gaps
     */
    chunkConversations(messages: RawMessage[]): ConversationChunk[] {
        const chunks: ConversationChunk[] = [];
        
        // Group by channel first
        const byChannel: Record<string, RawMessage[]> = {};
        for (const msg of messages) {
            if (!byChannel[msg.channelId]) {
                byChannel[msg.channelId] = [];
            }
            byChannel[msg.channelId]!.push(msg);
        }

        for (const [channelId, channelMsgs] of Object.entries(byChannel)) {
            const sorted = channelMsgs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            
            const GAP_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
            const MAX_CHUNK_SIZE = 100;
            
            let currentChunk: RawMessage[] = [];
            let lastTime = 0;

            for (const msg of sorted) {
                const msgTime = msg.timestamp.getTime();
                const shouldSplit = (
                    (lastTime > 0 && msgTime - lastTime > GAP_THRESHOLD_MS) ||
                    currentChunk.length >= MAX_CHUNK_SIZE
                );

                if (shouldSplit && currentChunk.length > 0) {
                    chunks.push(this.createChunk(channelId, currentChunk));
                    currentChunk = [];
                }

                currentChunk.push(msg);
                lastTime = msgTime;
            }

            if (currentChunk.length > 0) {
                chunks.push(this.createChunk(channelId, currentChunk));
            }
        }

        return chunks;
    }

    private createChunk(channelId: string, messages: RawMessage[]): ConversationChunk {
        const participants = [...new Set(messages.map(m => m.authorName))];
        
        return {
            id: `chunk_${channelId}_${messages[0]!.timestamp.getTime()}`,
            channelId,
            channelName: messages[0]!.channelName,
            startTime: messages[0]!.timestamp,
            endTime: messages[messages.length - 1]!.timestamp,
            participants,
            messageCount: messages.length,
            messages,
            vibeType: this.detectVibeType(messages),
            slangDensity: this.calculateSlangDensity(messages),
            emojiDensity: this.calculateEmojiDensity(messages),
            topics: this.extractQuickTopics(messages),
        };
    }

    private detectVibeType(messages: RawMessage[]): ConversationChunk['vibeType'] {
        const content = messages.map(m => m.content.toLowerCase()).join(' ');
        
        const patterns = {
            shitpost: /lmao|lol|bruh|💀|😭|🤣|shitpost|meme|dead/gi,
            serious: /actually|honestly|think about|important|need to/gi,
            hype: /lets go|pog|W|dub|goat|insane|sick|fire|🔥|💯/gi,
            drama: /drama|beef|fight|toxic|mad|angry|wtf|seriously\?/gi,
            gaming: /gg|game|play|stream|lobby|queue|ranked|win|lose/gi,
            debate: /but|however|disagree|point|argument|wrong|right/gi,
            vent: /sad|depressed|stressed|tired|hate|sucks|😢|😞/gi,
        };

        const scores: Record<string, number> = {};
        for (const [type, pattern] of Object.entries(patterns)) {
            const matches = content.match(pattern);
            scores[type] = matches ? matches.length : 0;
        }

        const maxType = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
        if (maxType && maxType[1] > 2) {
            return maxType[0] as ConversationChunk['vibeType'];
        }
        return 'chill';
    }

    private calculateSlangDensity(messages: RawMessage[]): number {
        const slangPatterns = /bruh|lmao|lol|ngl|tbh|fr|ong|lowkey|highkey|bet|bussin|cap|no cap|vibes|sus|goated|mid|based|cringe|pog|gg|rn|idk|wym|smh|finna|aight|yall|gonna|wanna|kinda|sorta|tho|tfw|mfw|imo|imho|afk|w\/e|nvm|ofc|ik|irl|rip/gi;
        
        let slangCount = 0;
        let wordCount = 0;
        
        for (const msg of messages) {
            wordCount += msg.content.split(/\s+/).length;
            slangCount += (msg.content.match(slangPatterns) || []).length;
        }

        return wordCount > 0 ? Math.min(1, slangCount / wordCount * 5) : 0;
    }

    private calculateEmojiDensity(messages: RawMessage[]): number {
        const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
        
        let emojiCount = 0;
        for (const msg of messages) {
            emojiCount += (msg.content.match(emojiPattern) || []).length;
        }

        return messages.length > 0 ? Math.min(1, emojiCount / messages.length / 3) : 0;
    }

    private extractQuickTopics(messages: RawMessage[]): string[] {
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that', 'what', 'which', 'who', 'where', 'when', 'why', 'how', 'all', 'each', 'both', 'few', 'more', 'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'but', 'and', 'or', 'if', 'then', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'once', 'here', 'there', 'any', 'can', 'cant', 'dont', 'im', 'ive', 'its', 'thats', 'youre', 'gonna', 'wanna', 'gotta', 'lol', 'lmao', 'yeah', 'like', 'know', 'think', 'get', 'got', 'go', 'going', 'want', 'see', 'make', 'take', 'come', 'say', 'said']);
        
        const wordCounts: Record<string, number> = {};
        
        for (const msg of messages) {
            const words = msg.content.toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 3 && !stopWords.has(w));
            
            for (const word of words) {
                wordCounts[word] = (wordCounts[word] || 0) + 1;
            }
        }

        return Object.entries(wordCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([word]) => word);
    }
}
