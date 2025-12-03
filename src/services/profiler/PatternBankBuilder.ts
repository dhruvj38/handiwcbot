/**
 * LAYER 4: Pattern Bank Builder (Enhanced)
 * Build call→response patterns for mimicking server communication style
 * Focuses on AUTHENTIC patterns that capture the server's real voice
 */

import { RawMessage, PatternEntry, PatternBank } from './types';

export class PatternBankBuilder {
    build(messages: RawMessage[]): PatternBank {
        const patterns = this.extractPatterns(messages);
        const greetings = this.extractGreetings(messages);
        const farewells = this.extractFarewells(messages);
        const reactions = this.extractReactions(messages);
        const roastTemplates = this.extractRoastTemplates(messages);
        const hypeTemplates = this.extractHypeTemplates(messages);
        const comfortTemplates = this.extractComfortTemplates(messages);

        return { patterns, greetings, farewells, reactions, roastTemplates, hypeTemplates, comfortTemplates };
    }

    private extractPatterns(messages: RawMessage[]): PatternEntry[] {
        const patterns: PatternEntry[] = [];
        const seenResponses = new Set<string>();

        for (let i = 1; i < messages.length; i++) {
            const prev = messages[i - 1]!;
            const curr = messages[i]!;
            
            // Skip if same author, different channel, or too far apart
            if (prev.authorId === curr.authorId) continue;
            if (prev.channelId !== curr.channelId) continue;
            if (curr.timestamp.getTime() - prev.timestamp.getTime() > 120000) continue;
            
            // Skip very short or very long messages
            if (prev.content.length < 3 || curr.content.length < 3) continue;
            if (prev.content.length > 200 || curr.content.length > 200) continue;
            
            // Skip duplicate responses
            if (seenResponses.has(curr.content.toLowerCase())) continue;

            // Calculate quality score
            const quality = this.calculatePatternQuality(prev, curr);
            
            // Include high quality patterns (reactions, good length match, natural flow)
            if (quality >= 2) {
                patterns.push({
                    trigger: prev.content,
                    context: this.buildContext(prev, curr, quality),
                    idealResponse: curr.content,
                    category: this.categorizeResponse(prev.content, curr.content),
                    energy: this.detectEnergy(curr.content),
                });
                seenResponses.add(curr.content.toLowerCase());
            }
        }

        // Sort by quality (patterns with reactions first)
        return patterns
            .sort((a, b) => {
                const aScore = a.context.includes('reactions') ? 10 : 0;
                const bScore = b.context.includes('reactions') ? 10 : 0;
                return bScore - aScore;
            })
            .slice(0, 150);
    }

    /**
     * Calculate quality score for a call→response pattern
     */
    private calculatePatternQuality(trigger: RawMessage, response: RawMessage): number {
        let score = 0;
        
        // Reactions are the best indicator of good responses
        if (response.reactions.length > 0) score += 3;
        if (response.reactions.length > 2) score += 2;
        
        // Length matching (short trigger → short response is natural)
        const triggerWords = trigger.content.split(/\s+/).length;
        const responseWords = response.content.split(/\s+/).length;
        if (triggerWords < 5 && responseWords < 10) score += 1;
        if (triggerWords > 10 && responseWords > 5) score += 1;
        
        // Quick response time indicates natural conversation
        const timeDiff = response.timestamp.getTime() - trigger.timestamp.getTime();
        if (timeDiff < 30000) score += 1; // Within 30 seconds
        
        // Contains server-typical patterns (slang, emojis, etc.)
        if (/lmao|lol|fr|ngl|bruh|💀|😂/.test(response.content)) score += 1;
        
        return score;
    }

    /**
     * Build descriptive context for a pattern
     */
    private buildContext(trigger: RawMessage, response: RawMessage, quality: number): string {
        const parts: string[] = [];
        
        if (response.reactions.length > 0) {
            parts.push(`${response.reactions.length} reactions`);
        }
        
        const timeDiff = Math.round((response.timestamp.getTime() - trigger.timestamp.getTime()) / 1000);
        if (timeDiff < 10) parts.push('instant reply');
        else if (timeDiff < 30) parts.push('quick reply');
        
        if (quality >= 4) parts.push('high quality');
        
        return parts.length > 0 ? parts.join(', ') : 'natural conversation';
    }

    private extractGreetings(messages: RawMessage[]): { input: string; responses: string[] }[] {
        const greetings: { input: string; responses: string[] }[] = [];
        const greetingPatterns = /^(hey|hi|hello|yo|sup|wassup|what'?s? ?up|gm|good morning|good evening|howdy)/i;

        for (let i = 0; i < messages.length - 1; i++) {
            const msg = messages[i]!;
            if (greetingPatterns.test(msg.content)) {
                const response = messages[i + 1];
                if (response && response.channelId === msg.channelId && response.authorId !== msg.authorId) {
                    const existing = greetings.find(g => g.input.toLowerCase() === msg.content.toLowerCase().slice(0, 20));
                    if (existing) {
                        existing.responses.push(response.content);
                    } else {
                        greetings.push({
                            input: msg.content.slice(0, 50),
                            responses: [response.content],
                        });
                    }
                }
            }
        }

        return greetings.slice(0, 20);
    }

    private extractFarewells(messages: RawMessage[]): { input: string; responses: string[] }[] {
        const farewells: { input: string; responses: string[] }[] = [];
        const farewellPatterns = /^(bye|cya|later|gn|goodnight|night|peace|im out|gotta go|ttyl)/i;

        for (let i = 0; i < messages.length - 1; i++) {
            const msg = messages[i]!;
            if (farewellPatterns.test(msg.content)) {
                const response = messages[i + 1];
                if (response && response.channelId === msg.channelId && response.authorId !== msg.authorId) {
                    const existing = farewells.find(f => f.input.toLowerCase() === msg.content.toLowerCase().slice(0, 20));
                    if (existing) {
                        existing.responses.push(response.content);
                    } else {
                        farewells.push({
                            input: msg.content.slice(0, 50),
                            responses: [response.content],
                        });
                    }
                }
            }
        }

        return farewells.slice(0, 20);
    }

    private extractReactions(messages: RawMessage[]): { emotion: string; expressions: string[] }[] {
        const emotionExpressions: Record<string, string[]> = {
            funny: [],
            surprised: [],
            excited: [],
            sad: [],
            angry: [],
        };

        for (const msg of messages) {
            const content = msg.content.toLowerCase();
            if (/lmao|lol|💀|😂|🤣|haha|dead/.test(content)) {
                emotionExpressions.funny!.push(msg.content);
            }
            if (/wtf|what|😱|🤯|no way/.test(content)) {
                emotionExpressions.surprised!.push(msg.content);
            }
            if (/lets go|pog|🔥|💯|w\b|dub/.test(content)) {
                emotionExpressions.excited!.push(msg.content);
            }
            if (/sad|😢|😞|damn|rip/.test(content)) {
                emotionExpressions.sad!.push(msg.content);
            }
            if (/mad|angry|pissed|😡|🤬/.test(content)) {
                emotionExpressions.angry!.push(msg.content);
            }
        }

        return Object.entries(emotionExpressions)
            .filter(([_, expressions]) => expressions.length > 0)
            .map(([emotion, expressions]) => ({
                emotion,
                expressions: [...new Set(expressions)].slice(0, 20),
            }));
    }

    private extractRoastTemplates(messages: RawMessage[]): string[] {
        return messages
            .filter(m => m.mentions.length > 0 && /L|ratio|cope|seethe|mald|cringe|mid|trash|bad|worst/.test(m.content.toLowerCase()))
            .slice(0, 20)
            .map(m => m.content);
    }

    private extractHypeTemplates(messages: RawMessage[]): string[] {
        return messages
            .filter(m => /goat|goated|king|queen|legend|W|dub|fire|insane|sick|crazy|best/.test(m.content.toLowerCase()))
            .slice(0, 20)
            .map(m => m.content);
    }

    private extractComfortTemplates(messages: RawMessage[]): string[] {
        return messages
            .filter(m => /sorry|feel better|it's okay|you got this|hang in there|here for you|love you/i.test(m.content))
            .slice(0, 20)
            .map(m => m.content);
    }

    private categorizeResponse(trigger: string, response: string): PatternEntry['category'] {
        const t = trigger.toLowerCase();
        const r = response.toLowerCase();
        
        if (/^(hey|hi|hello|yo|sup)/i.test(t)) return 'greeting';
        if (/bye|cya|later|gn|goodnight/i.test(t)) return 'farewell';
        if (/L|ratio|cope|cringe/.test(r)) return 'roast';
        if (/goat|W|fire|pog|nice/.test(r)) return 'hype';
        if (/sorry|feel|okay/.test(r)) return 'comfort';
        if (/lol|lmao|haha/.test(r)) return 'reaction';
        return 'smalltalk';
    }

    private detectEnergy(content: string): PatternEntry['energy'] {
        const caps = (content.match(/[A-Z]/g) || []).length / content.length;
        const exclaim = (content.match(/!/g) || []).length;
        
        if (caps > 0.5 || exclaim > 2) return 'unhinged';
        if (caps > 0.3 || exclaim > 1) return 'high';
        if (content.length > 100) return 'medium';
        return 'low';
    }
}
