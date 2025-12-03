/**
 * LAYER 6: Bible Compiler
 * Compile all data into the final Server Bible with master prompt
 */

import { GoogleGenAI } from '@google/genai';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
    RawMessage,
    ConversationChunk,
    SessionSummary,
    GlobalCultureMap,
    PatternBank,
    ServerBible,
} from './types';

export class BibleCompiler {
    private client: GoogleGenAI;

    constructor() {
        this.client = new GoogleGenAI({ apiKey: config.ai.apiKey });
    }

    async compile(
        serverName: string,
        serverDescription: string | null,
        messages: RawMessage[],
        chunks: ConversationChunk[],
        summaries: SessionSummary[],
        cultureMap: GlobalCultureMap,
        patternBank: PatternBank,
        userProfiles: ServerBible['userProfiles'],
        channels: { id: string; name: string; type: string; topic?: string | null }[],
        _roles: { id: string; name: string; memberCount: number }[]
    ): Promise<ServerBible> {
        const styleRules = this.calculateStyleRules(messages);
        const vocabulary = this.buildVocabulary(cultureMap, patternBank, messages);
        const responsePatterns = this.buildResponsePatterns(patternBank);
        const masterPrompt = await this.generateMasterPrompt(
            serverName, serverDescription, messages, summaries,
            cultureMap, patternBank, styleRules, vocabulary, userProfiles
        );
        const antiPatterns = this.buildAntiPatterns(vocabulary);

        // Use loop instead of spread to avoid stack overflow with large arrays (100k+ messages)
        let minTime = Infinity;
        let maxTime = -Infinity;
        for (const m of messages) {
            const t = m.timestamp.getTime();
            if (t < minTime) minTime = t;
            if (t > maxTime) maxTime = t;
        }
        const dateRange = {
            start: new Date(minTime),
            end: new Date(maxTime),
        };

        return {
            coreIdentity: {
                summary: `Bot for ${serverName} - ${serverDescription || 'A Discord community'}`,
                personality: ['friend', 'member of the group', 'knows the lore'],
                archetypes: ['friend', 'shitposter', 'lorekeeper', 'hypeman'],
            },
            styleRules,
            vocabulary,
            responsePatterns,
            lore: {
                majorEvents: cultureMap.loreMap.filter(l => l.memePotential > 5),
                memes: cultureMap.loreMap.filter(l => l.memePotential <= 5),
                copypastas: this.extractCopypastas(messages),
                legends: userProfiles.slice(0, 10).map(u => ({ who: u.displayName, why: u.personality })),
            },
            exampleLibrary: patternBank,
            userProfiles,
            masterPrompt,
            antiPatterns,
            metadata: {
                messageCount: messages.length,
                chunkCount: chunks.length,
                userCount: userProfiles.length,
                channelCount: channels.length,
                dateRange,
                generatedAt: new Date(),
            },
        };
    }

    private calculateStyleRules(messages: RawMessage[]): ServerBible['styleRules'] {
        const allLower = messages.filter(m => m.content === m.content.toLowerCase()).length;
        const allCaps = messages.filter(m => m.content === m.content.toUpperCase() && m.content.length > 3).length;
        let capitalization: ServerBible['styleRules']['capitalization'] = 'normal';
        if (allLower / messages.length > 0.7) capitalization = 'lowercase';
        else if (allCaps / messages.length > 0.2) capitalization = 'CAPS_HEAVY';

        const noPunct = messages.filter(m => !/[.!?,]/.test(m.content)).length;
        const manyPunct = messages.filter(m => (m.content.match(/[.!?,]/g) || []).length > 3).length;
        let punctuation: ServerBible['styleRules']['punctuation'] = 'normal';
        if (noPunct / messages.length > 0.6) punctuation = 'minimal';
        else if (manyPunct / messages.length > 0.3) punctuation = 'excessive';

        const emojiPattern = /[\u{1F300}-\u{1F9FF}]/gu;
        const msgsWithEmoji = messages.filter(m => emojiPattern.test(m.content)).length;
        let emojiFrequency: 'never' | 'rare' | 'moderate' | 'heavy' = 'moderate';
        if (msgsWithEmoji / messages.length < 0.05) emojiFrequency = 'never';
        else if (msgsWithEmoji / messages.length < 0.2) emojiFrequency = 'rare';
        else if (msgsWithEmoji / messages.length > 0.5) emojiFrequency = 'heavy';

        // Find favorite emojis
        const emojiCounts: Record<string, number> = {};
        for (const msg of messages) {
            const emojis = msg.content.match(emojiPattern) || [];
            for (const e of emojis) {
                emojiCounts[e] = (emojiCounts[e] || 0) + 1;
            }
        }
        const favoriteEmojis = Object.entries(emojiCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([e]) => e);

        const avgLength = messages.reduce((sum, m) => sum + m.content.split(/\s+/).length, 0) / messages.length;

        const slangPattern = /bruh|lmao|lol|ngl|tbh|fr|ong|lowkey|bet|bussin|cap|sus|goated|mid|based|pog/gi;
        const totalSlang = messages.reduce((sum, m) => sum + (m.content.match(slangPattern)?.length || 0), 0);
        const slangDensity = Math.min(1, totalSlang / messages.length);

        const swearPattern = /fuck|shit|damn|hell|ass|bitch|crap/gi;
        const totalSwears = messages.reduce((sum, m) => sum + (m.content.match(swearPattern)?.length || 0), 0);
        let swearingLevel: ServerBible['styleRules']['swearingLevel'] = 'mild';
        if (totalSwears / messages.length < 0.01) swearingLevel = 'never';
        else if (totalSwears / messages.length > 0.2) swearingLevel = 'heavy';
        else if (totalSwears / messages.length > 0.05) swearingLevel = 'moderate';

        const capsInMsg = messages.filter(m => /[A-Z]{3,}/.test(m.content)).length;
        let capsUsage: ServerBible['styleRules']['capsUsage'] = 'for_emphasis';
        if (capsInMsg / messages.length < 0.05) capsUsage = 'never';
        else if (capsInMsg / messages.length > 0.3) capsUsage = 'frequent';

        return {
            capitalization,
            punctuation,
            emojiUsage: { frequency: emojiFrequency, favorites: favoriteEmojis, avoidThese: [] },
            messageLength: {
                typical: Math.round(avgLength),
                max: 100,
                style: avgLength < 10 ? 'terse' : avgLength > 30 ? 'verbose' : 'normal',
            },
            slangDensity,
            swearingLevel,
            capsUsage,
        };
    }

    private buildVocabulary(
        cultureMap: GlobalCultureMap,
        patternBank: PatternBank,
        messages: RawMessage[]
    ): ServerBible['vocabulary'] {
        const slangDictionary: Record<string, string> = {};
        for (const entry of cultureMap.slangMap) {
            slangDictionary[entry.term] = entry.meaning;
        }

        const phrases = cultureMap.slangMap.map(s => ({
            phrase: s.term,
            meaning: s.meaning,
            when: s.usageContext,
        }));

        const greetings = patternBank.greetings.flatMap(g => g.responses).slice(0, 20);
        const farewells = patternBank.farewells.flatMap(f => f.responses).slice(0, 20);

        // Extract affirmatives and negatives
        const affirmatives: string[] = [];
        const negatives: string[] = [];
        for (const msg of messages.slice(0, 10000)) {
            const lower = msg.content.toLowerCase().trim();
            if (/^(yeah|yes|yep|yup|ye|ya|bet|fr|facts|true|agreed|ong|fax)$/i.test(lower)) {
                if (!affirmatives.includes(msg.content)) affirmatives.push(msg.content);
            }
            if (/^(no|nah|nope|cap|false|disagree|ngl no)$/i.test(lower)) {
                if (!negatives.includes(msg.content)) negatives.push(msg.content);
            }
        }

        const reactions: Record<string, string[]> = {};
        for (const r of patternBank.reactions) {
            reactions[r.emotion] = r.expressions;
        }

        return {
            slangDictionary,
            phrases,
            greetings: [...new Set(greetings)].slice(0, 20),
            farewells: [...new Set(farewells)].slice(0, 20),
            affirmatives: [...new Set(affirmatives)].slice(0, 20),
            negatives: [...new Set(negatives)].slice(0, 20),
            reactions,
            forbidden: ['certainly', 'I would be happy to', 'great question', 'feel free', 'I understand your concern'],
        };
    }

    private buildResponsePatterns(patternBank: PatternBank): ServerBible['responsePatterns'] {
        return {
            whenHappy: patternBank.reactions.find(r => r.emotion === 'excited')?.expressions || [],
            whenSad: patternBank.reactions.find(r => r.emotion === 'sad')?.expressions || [],
            whenAngry: patternBank.reactions.find(r => r.emotion === 'angry')?.expressions || [],
            whenConfused: ['huh', 'wait what', 'wym', '???'],
            whenExcited: patternBank.reactions.find(r => r.emotion === 'excited')?.expressions || [],
            whenBored: ['meh', 'mid', 'k'],
            toRoast: patternBank.roastTemplates,
            toHype: patternBank.hypeTemplates,
            toComfort: patternBank.comfortTemplates,
            toDisagree: ['nah', 'cap', 'disagree'],
            toAgree: ['fr', 'facts', 'true'],
            toGreet: patternBank.greetings.flatMap(g => g.responses).slice(0, 10),
            toFarewell: patternBank.farewells.flatMap(f => f.responses).slice(0, 10),
        };
    }

    private async generateMasterPrompt(
        serverName: string,
        serverDescription: string | null,
        messages: RawMessage[],
        summaries: SessionSummary[],
        cultureMap: GlobalCultureMap,
        patternBank: PatternBank,
        styleRules: ServerBible['styleRules'],
        vocabulary: ServerBible['vocabulary'],
        userProfiles: ServerBible['userProfiles']
    ): Promise<string> {
        // Select DIVERSE sample messages showing real conversations
        const sampleMessages = this.selectRepresentativeMessages(messages, 150);
        
        // Build conversation examples (call → response pairs)
        const conversationExamples = this.buildConversationExamples(messages, 30);
        
        // Get the most iconic quotes that define this server
        const iconicQuotes = summaries
            .flatMap(s => s.keyQuotes)
            .filter(q => q && q.length > 5 && q.length < 150)
            .slice(0, 40);

        // Build anti-AI examples - what NOT to sound like
        const antiAIExamples = this.buildAntiAIExamples(messages, styleRules);

        // Build user interaction guide
        const userGuide = userProfiles.slice(0, 15).map(u => {
            const patterns = u.speechPatterns?.slice(0, 3).join(', ') || '';
            return `**${u.displayName}** (${u.personality}): ${u.howToInteract}${patterns ? ` | Style: ${patterns}` : ''}`;
        }).join('\n');

        const slangList = Object.entries(vocabulary.slangDictionary)
            .slice(0, 40)
            .map(([term, meaning]) => `"${term}" → ${meaning}`)
            .join('\n');

        const prompt = `You are an expert at creating voice/personality profiles. Create a MASTER PERSONA PROMPT (800+ words) that will make an AI sound EXACTLY like a member of the Discord server "${serverName}".

The goal is to make responses INDISTINGUISHABLE from real server members. No AI tell-tale signs.

═══════════════════════════════════════════════════════════════════
SERVER IDENTITY
═══════════════════════════════════════════════════════════════════
Name: ${serverName}
Description: ${serverDescription || 'A Discord community'}
Messages analyzed: ${messages.length.toLocaleString()}
Active users profiled: ${userProfiles.length}

═══════════════════════════════════════════════════════════════════
DETECTED WRITING STYLE (QUANTIFIED)
═══════════════════════════════════════════════════════════════════
Capitalization: ${styleRules.capitalization} (${styleRules.capitalization === 'lowercase' ? 'NEVER capitalize unless for emphasis' : styleRules.capitalization === 'CAPS_HEAVY' ? 'Use CAPS freely for emphasis' : 'normal capitalization'})
Punctuation: ${styleRules.punctuation} (${styleRules.punctuation === 'minimal' ? 'skip periods, minimal punctuation' : styleRules.punctuation === 'excessive' ? 'heavy punctuation use' : 'selective punctuation'})
Emoji frequency: ${styleRules.emojiUsage.frequency}
Favorite emojis: ${styleRules.emojiUsage.favorites.slice(0, 8).join(' ') || 'none detected'}
Avg message length: ${styleRules.messageLength.typical} words (${styleRules.messageLength.style})
Slang density: ${Math.round(styleRules.slangDensity * 100)}%
Swearing level: ${styleRules.swearingLevel}
CAPS for emphasis: ${styleRules.capsUsage}

═══════════════════════════════════════════════════════════════════
REAL MESSAGE SAMPLES (COPY THIS EXACT STYLE)
═══════════════════════════════════════════════════════════════════
${sampleMessages}

═══════════════════════════════════════════════════════════════════
REAL CONVERSATIONS (CALL → RESPONSE PATTERNS)
═══════════════════════════════════════════════════════════════════
${conversationExamples}

═══════════════════════════════════════════════════════════════════
ICONIC QUOTES FROM THIS SERVER
═══════════════════════════════════════════════════════════════════
${iconicQuotes.map(q => `"${q}"`).join('\n')}

═══════════════════════════════════════════════════════════════════
SLANG DICTIONARY (USE THESE)
═══════════════════════════════════════════════════════════════════
${slangList}

═══════════════════════════════════════════════════════════════════
VOCABULARY TO USE
═══════════════════════════════════════════════════════════════════
Greetings: ${vocabulary.greetings.slice(0, 10).join(', ') || 'hey, yo, sup'}
Agreements: ${vocabulary.affirmatives.slice(0, 10).join(', ') || 'bet, fr, facts'}
Disagreements: ${vocabulary.negatives.slice(0, 10).join(', ') || 'nah, cap'}
Farewells: ${vocabulary.farewells.slice(0, 10).join(', ') || 'later, peace, gn'}

═══════════════════════════════════════════════════════════════════
RESPONSE TEMPLATES FROM SERVER
═══════════════════════════════════════════════════════════════════
When hyping someone: ${patternBank.hypeTemplates.slice(0, 5).join(' | ') || 'W, goated, lets go'}
When roasting someone: ${patternBank.roastTemplates.slice(0, 5).join(' | ') || 'L, ratio, mid'}
When comforting someone: ${patternBank.comfortTemplates.slice(0, 5).join(' | ') || 'its ok, youll be fine'}

═══════════════════════════════════════════════════════════════════
RUNNING JOKES & INSIDE REFERENCES
═══════════════════════════════════════════════════════════════════
${cultureMap.runningJokes.slice(0, 10).map(j => `- "${j.joke}" (${j.frequency})`).join('\n') || 'None detected'}

═══════════════════════════════════════════════════════════════════
KEY USERS TO KNOW (AND HOW THEY TALK)
═══════════════════════════════════════════════════════════════════
${userGuide}

═══════════════════════════════════════════════════════════════════
ANTI-AI GUIDELINES (CRITICAL - WHAT MAKES YOU SOUND LIKE A BOT)
═══════════════════════════════════════════════════════════════════
${antiAIExamples}

═══════════════════════════════════════════════════════════════════
NOW WRITE THE MASTER PROMPT
═══════════════════════════════════════════════════════════════════
Write an 800+ word instruction prompt in second person that transforms an AI into a server member.

STRUCTURE IT AS:
1. **CORE IDENTITY** - Who you are in this server (personality, vibe, role)
2. **EXACT TYPING RULES** - Specific capitalization, punctuation, abbreviations to use
3. **VOCABULARY REQUIREMENTS** - Words you MUST use, words to NEVER use
4. **MESSAGE FORMATTING** - Length, structure, when to use emojis
5. **RESPONSE PATTERNS** - How to respond to greetings, questions, hype, roasts, etc.
6. **TONE CALIBRATION** - Energy level, humor style, when to be serious vs chaotic
7. **ANTI-AI COMMANDMENTS** - 10+ specific things that make you sound robotic (be VERY specific)
8. **EXAMPLE RESPONSES** - 5+ examples of "if user says X, respond like Y"

CRITICAL REQUIREMENTS:
- Use ACTUAL phrases and words from the sample messages
- Be EXTREMELY specific (not "use slang" but "say 'fr' instead of 'for real'")
- Include specific examples with real server vocabulary
- The anti-AI section must be comprehensive - list every robotic pattern to avoid`;

        try {
            const response = await this.client.models.generateContent({
                model: config.ai.models.analysis,
                contents: prompt,
                config: {
                    maxOutputTokens: 6000,
                    temperature: 0.4,
                },
            });

            const masterPrompt = response.text || '';
            
            // Append a hard-coded anti-AI footer for safety
            const antiAIFooter = this.buildAntiAIFooter(vocabulary, styleRules);
            
            return masterPrompt + '\n\n' + antiAIFooter;
        } catch (error) {
            logger.error('Failed to generate master prompt:', error);
            return this.getFallbackPrompt(serverName, styleRules, vocabulary);
        }
    }

    /**
     * Select representative messages that capture the server's voice
     */
    private selectRepresentativeMessages(messages: RawMessage[], count: number): string {
        // Get messages of various types
        const short = messages.filter(m => m.content.length > 3 && m.content.length < 30);
        const medium = messages.filter(m => m.content.length >= 30 && m.content.length < 100);
        const withReactions = messages.filter(m => m.reactions.length > 0);
        
        const sample: RawMessage[] = [];
        const addRandom = (arr: RawMessage[], n: number) => {
            const shuffled = [...arr].sort(() => Math.random() - 0.5);
            for (const msg of shuffled.slice(0, n)) {
                if (!sample.includes(msg)) sample.push(msg);
            }
        };

        // Prioritize messages with reactions (community approved)
        addRandom(withReactions, Math.min(50, withReactions.length));
        addRandom(short, 50);
        addRandom(medium, 50);

        return sample
            .slice(0, count)
            .map(m => `[${m.authorName}]: ${m.content}`)
            .join('\n');
    }

    /**
     * Build real conversation examples (call → response)
     */
    private buildConversationExamples(messages: RawMessage[], count: number): string {
        const examples: string[] = [];
        
        for (let i = 1; i < messages.length && examples.length < count; i++) {
            const prev = messages[i - 1]!;
            const curr = messages[i]!;
            
            // Must be different authors, same channel, within 2 minutes
            if (prev.authorId === curr.authorId) continue;
            if (prev.channelId !== curr.channelId) continue;
            if (curr.timestamp.getTime() - prev.timestamp.getTime() > 120000) continue;
            
            // Skip very short or very long
            if (prev.content.length < 3 || curr.content.length < 3) continue;
            if (prev.content.length > 150 || curr.content.length > 150) continue;
            
            // Prioritize responses with reactions
            if (curr.reactions.length > 0 || Math.random() < 0.1) {
                examples.push(`Q: "${prev.content}"\nA: "${curr.content}"`);
            }
        }

        return examples.slice(0, count).join('\n\n');
    }

    /**
     * Build anti-AI examples showing what NOT to do
     */
    private buildAntiAIExamples(_messages: RawMessage[], styleRules: ServerBible['styleRules']): string {
        const examples: string[] = [];
        
        // Based on detected style, build specific anti-patterns
        if (styleRules.capitalization === 'lowercase') {
            examples.push('❌ NEVER start sentences with capital letters');
            examples.push('❌ NEVER capitalize "I" - use lowercase "i"');
        }
        
        if (styleRules.punctuation === 'minimal') {
            examples.push('❌ NEVER end messages with periods');
            examples.push('❌ NEVER use proper punctuation in casual messages');
        }
        
        if (styleRules.messageLength.typical < 10) {
            examples.push('❌ NEVER write paragraphs in response to short messages');
            examples.push('❌ NEVER over-explain or be verbose');
        }

        // Universal anti-AI patterns
        examples.push('❌ NEVER say "I understand", "Certainly!", "Of course!", "Great question!"');
        examples.push('❌ NEVER say "feel free to", "I\'d be happy to", "Let me help you with that"');
        examples.push('❌ NEVER use bullet points or numbered lists in casual chat');
        examples.push('❌ NEVER start messages with "I" - vary your sentence starters');
        examples.push('❌ NEVER be overly helpful or eager - match the server\'s casual energy');
        examples.push('❌ NEVER use perfect grammar if the server doesn\'t');
        examples.push('❌ NEVER respond to one-word messages with paragraphs');
        examples.push('❌ NEVER use formal transitions like "However", "Furthermore", "Additionally"');
        examples.push('❌ NEVER apologize excessively or be overly polite');
        examples.push('❌ NEVER use "!" excessively unless the server does');
        
        return examples.join('\n');
    }

    /**
     * Hard-coded anti-AI footer that always gets appended
     */
    private buildAntiAIFooter(vocabulary: ServerBible['vocabulary'], styleRules: ServerBible['styleRules']): string {
        return `
═══════════════════════════════════════════════════════════════════
ABSOLUTE RULES (NEVER BREAK THESE)
═══════════════════════════════════════════════════════════════════

**FORBIDDEN PHRASES** (using these instantly reveals you're an AI):
${vocabulary.forbidden.map(f => `- "${f}"`).join('\n')}
- "I'd be happy to"
- "Great question!"
- "Let me explain"
- "I understand your concern"
- "Feel free to"
- "I'm here to help"
- "Certainly!"
- "Absolutely!"
- "That's a great point"

**MESSAGE LENGTH RULE**:
- If someone sends 1-5 words, respond with 1-10 words MAX
- Match the energy and length of what you're responding to
- Average message length in this server: ${styleRules.messageLength.typical} words

**CAPITALIZATION RULE**:
- This server uses ${styleRules.capitalization} capitalization
${styleRules.capitalization === 'lowercase' ? '- Type in all lowercase, even "i" instead of "I"' : ''}
${styleRules.capitalization === 'CAPS_HEAVY' ? '- Use CAPS freely for emphasis' : ''}

**PUNCTUATION RULE**:
- This server uses ${styleRules.punctuation} punctuation
${styleRules.punctuation === 'minimal' ? '- Skip periods entirely. End messages with nothing, "lol", or an emoji' : ''}

**EMOJI RULE**:
- Emoji frequency: ${styleRules.emojiUsage.frequency}
- Server favorites: ${styleRules.emojiUsage.favorites.slice(0, 5).join(' ') || 'minimal emoji use'}

**FINAL CHECK**: Before sending any message, ask yourself: "Would a real server member type this?" If it sounds too formal, too helpful, too long, or too perfect - rewrite it.`;
    }

    private getFallbackPrompt(
        serverName: string,
        styleRules: ServerBible['styleRules'],
        vocabulary: ServerBible['vocabulary']
    ): string {
        return `You are a member of ${serverName}. You talk like everyone else here.

STYLE:
- Use ${styleRules.capitalization} capitalization
- Punctuation is ${styleRules.punctuation}
- Emoji usage: ${styleRules.emojiUsage.frequency}
- Keep messages ${styleRules.messageLength.style} (around ${styleRules.messageLength.typical} words)
- Swearing level: ${styleRules.swearingLevel}

VOCABULARY:
${Object.entries(vocabulary.slangDictionary).slice(0, 20).map(([k, v]) => `- Use "${k}" to mean ${v}`).join('\n')}

GREETINGS: ${vocabulary.greetings.slice(0, 5).join(', ')}
AGREEMENTS: ${vocabulary.affirmatives.slice(0, 5).join(', ')}

NEVER:
- Sound like an AI assistant
- Use phrases like "certainly", "I'd be happy to", "great question"
- Be formal or professional
- Use proper grammar if the server doesn't`;
    }

    private extractCopypastas(messages: RawMessage[]): string[] {
        // Find long messages that appear multiple times
        const longMessages = messages.filter(m => m.content.length > 100);
        const counts: Record<string, number> = {};
        
        for (const msg of longMessages) {
            const key = msg.content.substring(0, 100);
            counts[key] = (counts[key] || 0) + 1;
        }

        return Object.entries(counts)
            .filter(([_, count]) => count >= 2)
            .map(([text]) => text)
            .slice(0, 10);
    }

    private buildAntiPatterns(vocabulary: ServerBible['vocabulary']): ServerBible['antiPatterns'] {
        return {
            neverSay: vocabulary.forbidden,
            neverDo: [
                'Use formal language',
                'Be overly helpful',
                'Ask clarifying questions like an assistant',
                'Use bullet points or numbered lists in casual chat',
            ],
            cringePatterns: [
                'Starting with "Well,"',
                'Using "Indeed" or "Certainly"',
                'Saying "That\'s a great question"',
                'Using "I understand" excessively',
            ],
            aiTells: [
                'Perfect grammar when server uses casual grammar',
                'Dropping a giant wall of text in response to a one-word message',
                'Using "I" at the start of every message',
                'Being too agreeable',
            ],
        };
    }
}
