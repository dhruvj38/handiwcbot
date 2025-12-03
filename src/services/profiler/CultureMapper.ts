/**
 * LAYER 3: Global Culture Maps
 * Build slang, lore, social dynamics, and running jokes maps
 */

import { GoogleGenAI } from '@google/genai';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { RawMessage, SessionSummary, SlangEntry, LoreEntry, SocialDynamic, GlobalCultureMap } from './types';

export class CultureMapper {
    private client: GoogleGenAI;

    constructor() {
        this.client = new GoogleGenAI({ apiKey: config.ai.apiKey });
    }

    async buildCultureMaps(
        summaries: SessionSummary[],
        messages: RawMessage[],
        members: { id: string; displayName: string; username: string; roles: string[] }[]
    ): Promise<GlobalCultureMap> {
        const slangMap = await this.extractSlangMap(messages, summaries);
        const loreMap = this.extractLoreMap(summaries);
        const socialMap = this.extractSocialDynamics(messages, members);
        const roleHierarchy = this.extractRoleHierarchy(members);
        const runningJokes = this.extractRunningJokes(messages, summaries);
        const { taboos, sacredCows } = this.extractTaboosAndSacredCows(messages);

        return { slangMap, loreMap, socialMap, roleHierarchy, runningJokes, taboos, sacredCows };
    }

    private async extractSlangMap(messages: RawMessage[], summaries: SessionSummary[]): Promise<SlangEntry[]> {
        // Collect slang from summaries
        const slangFromSummaries = new Set<string>();
        for (const s of summaries) {
            for (const slang of s.keySlang) {
                slangFromSummaries.add(slang.toLowerCase());
            }
        }

        // Scan messages for frequent non-standard words
        const wordFrequency: Record<string, { count: number; examples: string[]; users: Set<string> }> = {};
        const standardWords = new Set(['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us']);
        
        for (const msg of messages) {
            const words = msg.content.toLowerCase().split(/\s+/);
            for (const word of words) {
                const cleaned = word.replace(/[^\w]/g, '');
                if (cleaned.length < 2 || standardWords.has(cleaned)) continue;
                
                if (!wordFrequency[cleaned]) {
                    wordFrequency[cleaned] = { count: 0, examples: [], users: new Set() };
                }
                wordFrequency[cleaned]!.count++;
                wordFrequency[cleaned]!.users.add(msg.authorId);
                if (wordFrequency[cleaned]!.examples.length < 3) {
                    wordFrequency[cleaned]!.examples.push(msg.content);
                }
            }
        }

        // Find words that appear frequently but aren't standard
        const potentialSlang = Object.entries(wordFrequency)
            .filter(([_, data]) => data.count >= 5 && data.users.size >= 2)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 100);

        const slangEntries: SlangEntry[] = [];
        const slangToAnalyze = potentialSlang.slice(0, 50).map(([word, data]) => ({
            word,
            examples: data.examples,
            frequency: data.count,
        }));

        if (slangToAnalyze.length > 0) {
            try {
                const response = await this.client.models.generateContent({
                    model: config.ai.models.chat,
                    contents: `Analyze these potential slang words from a Discord server. For each one that IS actually slang/unique usage, provide:
- meaning: what it means in context
- usageContext: one of "roast", "hype", "comfort", "greeting", "reaction", "general"

Words and example usages:
${slangToAnalyze.map(s => `"${s.word}" (used ${s.frequency} times): ${s.examples.join(' | ')}`).join('\n')}

Output JSON array of {term, meaning, usageContext} for ONLY the real slang/unique words:`,
                    config: {
                        maxOutputTokens: 2000,
                        temperature: 0.2,
                        responseMimeType: 'application/json',
                    },
                });

                const results = JSON.parse(response.text || '[]');
                for (const r of results) {
                    const data = wordFrequency[r.term.toLowerCase()];
                    if (data) {
                        slangEntries.push({
                            term: r.term,
                            meaning: r.meaning,
                            examples: data.examples,
                            usageContext: r.usageContext || 'general',
                            frequency: data.count,
                        });
                    }
                }
            } catch (error) {
                logger.warn('Failed to analyze slang with AI:', error);
            }
        }

        return slangEntries;
    }

    private extractLoreMap(summaries: SessionSummary[]): LoreEntry[] {
        const loreEntries: LoreEntry[] = [];
        
        for (const summary of summaries) {
            for (const lore of summary.loreGenerated) {
                if (lore && lore.length > 5) {
                    loreEntries.push({
                        title: lore,
                        description: summary.summary,
                        participants: Object.keys(summary.participants),
                        references: [],
                        memePotential: summary.vibeScore.humor,
                        examples: summary.keyQuotes,
                    });
                }
            }
        }

        return loreEntries.slice(0, 50);
    }

    private extractSocialDynamics(
        messages: RawMessage[],
        _members: { id: string; displayName: string; username: string; roles: string[] }[]
    ): SocialDynamic[] {
        const interactions: Record<string, Record<string, number>> = {};
        
        for (let i = 1; i < messages.length; i++) {
            const curr = messages[i]!;
            const prev = messages[i - 1]!;
            
            if (curr.channelId === prev.channelId && 
                curr.authorId !== prev.authorId &&
                curr.timestamp.getTime() - prev.timestamp.getTime() < 5 * 60 * 1000) {
                
                if (!interactions[curr.authorName]) {
                    interactions[curr.authorName] = {};
                }
                if (!interactions[curr.authorName]![prev.authorName]) {
                    interactions[curr.authorName]![prev.authorName] = 0;
                }
                interactions[curr.authorName]![prev.authorName]!++;
            }
        }

        const dynamics: SocialDynamic[] = [];
        const seen = new Set<string>();
        
        for (const [user1, targets] of Object.entries(interactions)) {
            for (const [user2, count] of Object.entries(targets)) {
                const pairKey = [user1, user2].sort().join('|');
                if (seen.has(pairKey)) continue;
                seen.add(pairKey);
                
                const reverseCount = interactions[user2]?.[user1] || 0;
                const totalInteractions = count + reverseCount;
                
                if (totalInteractions > 20) {
                    dynamics.push({
                        relationship: `${user1} ↔ ${user2}`,
                        type: 'friends',
                        howTheyInteract: `High interaction rate (${totalInteractions} exchanges)`,
                        insideJokes: [],
                        examples: [],
                    });
                }
            }
        }

        return dynamics.slice(0, 20);
    }

    private extractRoleHierarchy(
        members: { id: string; displayName: string; username: string; roles: string[] }[]
    ): GlobalCultureMap['roleHierarchy'] {
        const roleCounts: Record<string, number> = {};
        
        for (const member of members) {
            for (const role of member.roles) {
                roleCounts[role] = (roleCounts[role] || 0) + 1;
            }
        }

        return Object.entries(roleCounts)
            .filter(([role]) => !role.startsWith('@'))
            .sort((a, b) => a[1] - b[1])
            .slice(0, 10)
            .map(([role, count]) => ({
                role,
                howToAddressThem: count < 5 ? 'with respect' : 'casually',
                howTheyTalk: count < 5 ? 'may have authority' : 'regular member style',
            }));
    }

    private extractRunningJokes(
        messages: RawMessage[],
        _summaries: SessionSummary[]
    ): GlobalCultureMap['runningJokes'] {
        const phraseFrequency: Record<string, number> = {};
        
        for (const msg of messages) {
            if (msg.content.length > 5 && msg.content.length < 50) {
                const phrase = msg.content.toLowerCase().trim();
                phraseFrequency[phrase] = (phraseFrequency[phrase] || 0) + 1;
            }
        }

        return Object.entries(phraseFrequency)
            .filter(([_, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([phrase, count]) => ({
                joke: phrase,
                setup: 'Running joke / catchphrase',
                payoff: 'Used repeatedly in conversation',
                frequency: count > 10 ? 'overused' as const : count > 5 ? 'common' as const : 'rare' as const,
            }));
    }

    private extractTaboosAndSacredCows(_messages: RawMessage[]): { taboos: string[]; sacredCows: string[] } {
        return { taboos: [], sacredCows: [] };
    }
}
