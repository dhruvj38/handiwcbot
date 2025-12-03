import { GoogleGenAI } from '@google/genai';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { retryWithBackoff } from '../../utils/helpers';
import {
    ChatContext,
    SessionSummaryDraft,
    UserProfileData,
    ServerMemoryData,
    TranscriptChunkData,
} from '../../types';

export class AiService {
    private client: GoogleGenAI;

    constructor() {
        this.client = new GoogleGenAI({
            apiKey: config.ai.apiKey,
        });

        logger.info('AiService initialized with config:', {
            model: config.ai.models.chat,
            embeddingModel: config.ai.models.embeddings,
        });
    }

    /**
     * Generate a chat response based on context
     */
    async generateChatResponse(context: ChatContext): Promise<string> {
        try {
            const systemPrompt = this.buildSystemPrompt(context);
            const userPrompt = this.buildUserPrompt(context);

            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.generateContent({
                        model: config.ai.models.chat,
                        contents: userPrompt,
                        config: {
                            systemInstruction: systemPrompt,
                            maxOutputTokens: config.ai.maxTokens,
                            temperature: config.ai.temperature,
                        },
                    });

                    const content = response.text;
                    if (!content) {
                        throw new Error('No content in AI response');
                    }

                    return content;
                },
                { maxRetries: 3 },
                'generateChatResponse'
            );

            return result;

        } catch (error) {
            logger.error('Failed to generate chat response:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            return "I'm having trouble processing that right now. Please try again later!";
        }
    }

    /**
     * Summarize transcript chunks into a session summary
     */
    async summarizeTranscripts(chunks: TranscriptChunkData[]): Promise<SessionSummaryDraft> {
        try {
            const transcriptText = chunks
                .map((chunk) => {
                    const timestamp = chunk.startedAt.toISOString();
                    const userId = chunk.userId || 'Unknown';
                    return `[${timestamp}] User ${userId}: ${chunk.rawText}`;
                })
                .join('\n');

            const prompt = `Analyze the following voice chat transcripts and extract structured information:

${transcriptText}

Please provide:
1. A high-level summary (7-8 sentences)
2. Key events discussed (bullet points)
3. Plans or decisions made (bullet points)
4. Memes, jokes, or recurring references (bullet points). Understand the references too
5. User insights (for each active participant, note personality traits, preferences, or behaviors).

Format your response as JSON with these exact keys:
{
  "highLevelSummary": "...",
  "events": ["...", "..."],
  "plans": ["...", "..."],
  "memes": ["...", "..."],
  "userInsights": {
    "userId1": "insight about user 1",
    "userId2": "insight about user 2"
  }
}`;

            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.generateContent({
                        model: config.ai.models.chat,
                        contents: prompt,
                        config: {
                            systemInstruction: 'You are a helpful assistant that analyzes voice chat transcripts and extracts structured information. Always respond with valid JSON.',
                            maxOutputTokens: 1500,
                            temperature: 0.3,
                            responseMimeType: 'application/json',
                        },
                    });

                    const content = response.text;
                    if (!content) {
                        throw new Error('No content in AI response');
                    }

                    return JSON.parse(content) as SessionSummaryDraft;
                },
                { maxRetries: 3 },
                'summarizeTranscripts'
            );

            return result;
        } catch (error) {
            logger.error('Failed to summarize transcripts:', error);
            // Return empty summary on failure
            return {
                highLevelSummary: 'Failed to generate summary',
                events: [],
                plans: [],
                memes: [],
                userInsights: {},
            };
        }
    }

    /**
     * Update user profile based on new session summary
     */
    async updateUserProfileFromSummary(
        profile: UserProfileData,
        summary: SessionSummaryDraft
    ): Promise<{ summary: string; tags: string[] }> {
        try {
            const userInsight = summary.userInsights[profile.userId];
            if (!userInsight) {
                // No new insights for this user
                return { summary: profile.summary, tags: profile.tags };
            }

            const prompt = `Current user profile:
Name: ${profile.displayName}
Summary: ${profile.summary}
Tags: ${profile.tags.join(', ')}

New insight from recent conversation:
${userInsight}

Update the user profile summary and tags to incorporate this new information. Keep the summary concise (2-3 sentences). Tags should be single words or short phrases.

Respond with JSON:
{
  "summary": "updated summary",
  "tags": ["tag1", "tag2", "tag3"]
}`;

            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.generateContent({
                        model: config.ai.models.chat,
                        contents: prompt,
                        config: {
                            systemInstruction: 'You are a helpful assistant that maintains user profiles. Always respond with valid JSON.',
                            maxOutputTokens: 500,
                            temperature: 0.3,
                            responseMimeType: 'application/json',
                        },
                    });

                    const content = response.text;
                    if (!content) {
                        throw new Error('No content in AI response');
                    }

                    return JSON.parse(content) as { summary: string; tags: string[] };
                },
                { maxRetries: 3 },
                'updateUserProfile'
            );

            return result;
        } catch (error) {
            logger.error('Failed to update user profile:', error);
            return { summary: profile.summary, tags: profile.tags };
        }
    }

    /**
     * Generate server memory entries from session summary
     */
    async generateServerMemories(
        _serverId: string,
        summary: SessionSummaryDraft
    ): Promise<Array<{ type: ServerMemoryData['type']; title: string; content: string }>> {
        const memories: Array<{ type: ServerMemoryData['type']; title: string; content: string }> = [];

        // Create memories for events
        for (const event of summary.events) {
            memories.push({
                type: 'event',
                title: event.substring(0, 100),
                content: event,
            });
        }

        // Create memories for plans
        for (const plan of summary.plans) {
            memories.push({
                type: 'plan',
                title: plan.substring(0, 100),
                content: plan,
            });
        }

        // Create memories for memes
        for (const meme of summary.memes) {
            memories.push({
                type: 'meme',
                title: meme.substring(0, 100),
                content: meme,
            });
        }

        return memories;
    }

    /**
     * Analyze server data to build comprehensive profiles
     */
    async analyzeServerData(data: {
        serverName: string;
        serverDescription: string | null;
        channels: Array<{ id: string; name: string; type: string; topic?: string | null }>;
        roles: Array<{ id: string; name: string; color: number; memberCount: number; permissions: string[] }>;
        members: Array<{ id: string; displayName: string; username: string; roles: string[]; isBot: boolean; joinedAt: Date | null }>;
        messages: Array<{ channelId: string; channelName: string; authorId: string; authorName: string; content: string; timestamp: Date }>;
    }): Promise<{
        serverProfile: {
            summary: string;
            topics: string[];
            culture: string;
            activeHours: string;
            keyMembers: string[];
        };
        communicationStyle: {
            slang: string[];
            commonPhrases: string[];
            greetings?: string[];
            reactions?: Record<string, string[]>;
            fillerWords?: string[];
            emojiStyle: string;
            messageLength: string;
            tone: string;
            capitalization: string;
            punctuation: string;
            humorStyle?: string;
            exampleMessages: string[];
        };
        insideJokes?: Array<{ joke: string; context: string; usage: string; examples?: string[] }>;
        thingsToAvoid?: string[];
        wayToFitIn?: string;
        masterPrompt?: string;
        operatingManual?: {
            vocabularyRules?: string[];
            slangDictionary?: Record<string, string>;
            grammarRules?: string[];
            responsePatterns?: Record<string, string[]>;
            humorRules?: string[];
            toneRules?: string[];
            formattingRules?: string[];
            forbiddenPatterns?: string[];
            exampleExchanges?: Array<{ context: string; goodResponse: string; badResponse: string }>;
        };
        userProfiles: Array<{
            userId: string;
            displayName: string;
            summary: string;
            tags: string[];
            personality: string;
            interests: string[];
            activityLevel: string;
        }>;
        memories: Array<{ type: 'event' | 'meme' | 'rule' | 'habit' | 'plan'; title: string; content: string }>;
    }> {
        try {
            // Build context about the server
            const channelList = data.channels
                .map((c) => `- #${c.name} (${c.type})${c.topic ? `: ${c.topic}` : ''}`)
                .join('\n');

            const roleList = data.roles
                .filter((r) => r.name !== '@everyone')
                .slice(0, 20)
                .map((r) => `- ${r.name} (${r.memberCount} members)`)
                .join('\n');

            // Get messages for analysis - use much higher limits for 100k message profiling
            // Sort by timestamp to show conversation flow
            const allMessages = data.messages
                .slice(0, 20000) // Higher limit for comprehensive analysis
                .map(msg => `[${msg.authorName}] ${msg.content}`)
                .join('\n');
            
            // Also group by user to show individual patterns
            const messagesByUser: Record<string, { name: string; messages: string[] }> = {};
            for (const msg of data.messages) {
                if (!messagesByUser[msg.authorId]) {
                    messagesByUser[msg.authorId] = { name: msg.authorName, messages: [] };
                }
                messagesByUser[msg.authorId]!.messages.push(msg.content);
            }

            // Get top 200 users with up to 500 messages each for comprehensive profiling
            const userMessageSummaries = Object.entries(messagesByUser)
                .sort((a, b) => b[1].messages.length - a[1].messages.length) // Most active first
                .slice(0, 200)
                .map(([_userId, userData]) => {
                    const sampleMessages = userData.messages.slice(0, 500).join('\n  ');
                    return `=== ${userData.name} (${userData.messages.length} total messages) ===\n  ${sampleMessages}`;
                })
                .join('\n\n');

            const prompt = `You are creating an EXHAUSTIVE OPERATING MANUAL for a chatbot to perfectly mimic how people talk in this Discord server. This is not a summary - this is a detailed rulebook with hundreds of specific instructions.

═══════════════════════════════════════════════════════════════
SERVER: ${data.serverName}
${data.serverDescription ? `Description: ${data.serverDescription}` : ''}
═══════════════════════════════════════════════════════════════

CHANNELS: ${channelList}

ROLES: ${roleList}

MEMBERS (${data.members.length} total):
${data.members.slice(0, 50).map((m) => `- ${m.displayName} (@${m.username})`).join('\n')}

═══════════════════════════════════════════════════════════════
RAW MESSAGE DUMP (${data.messages.length} messages - STUDY EVERY SINGLE ONE):
═══════════════════════════════════════════════════════════════
${allMessages}

═══════════════════════════════════════════════════════════════
MESSAGES GROUPED BY USER (to see individual patterns):
═══════════════════════════════════════════════════════════════
${userMessageSummaries}

═══════════════════════════════════════════════════════════════
YOUR TASK: Generate a COMPREHENSIVE OPERATING MANUAL
═══════════════════════════════════════════════════════════════

You must create an EXTREMELY DETAILED rulebook. Not summaries. SPECIFIC RULES.

For each category, list AS MANY specific rules/examples as you can find:

Output JSON with these sections:

{
  "serverProfile": {
    "summary": "what this server is about",
    "topics": ["every topic they discuss"],
    "culture": "detailed vibe description",
    "activeHours": "when active",
    "keyMembers": ["main people"]
  },
  
  "operatingManual": {
    "vocabularyRules": [
      "ALWAYS say 'X' instead of 'Y'",
      "Use 'Z' when expressing agreement",
      "Never say 'A', say 'B' instead",
      ... (list 50+ specific vocabulary rules)
    ],
    "slangDictionary": {
      "word": "meaning and when to use it",
      ... (list EVERY slang term with definitions)
    },
    "grammarRules": [
      "Always/never capitalize X",
      "Use/don't use punctuation for Y",
      "Sentence structure pattern: ...",
      ... (list all grammar patterns)
    ],
    "responsePatterns": {
      "whenSomeoneIsHappy": ["responses to use"],
      "whenSomeoneIsSad": ["responses to use"],
      "whenSomeoneAsksQuestion": ["how to answer"],
      "whenJoiningConversation": ["how to butt in"],
      "whenGreeting": ["exact greetings to use"],
      "whenSayingBye": ["exact farewells"],
      "whenAgreeing": ["ways to agree"],
      "whenDisagreeing": ["ways to disagree"],
      "whenSurprised": ["surprise expressions"],
      "whenAmused": ["how to show amusement"],
      "whenConfused": ["confusion expressions"],
      "whenExcited": ["excitement expressions"]
    },
    "humorRules": [
      "Types of jokes that land here: ...",
      "How to roast someone: ...",
      "Inside joke patterns: ...",
      "What makes them laugh: ...",
      ... (detailed humor guidelines)
    ],
    "toneRules": [
      "Energy level to match: ...",
      "When to be serious vs joking: ...",
      "How sarcastic to be: ...",
      ... (tone guidelines)
    ],
    "formattingRules": [
      "Message length: X words typical",
      "Use emojis: how/when/which",
      "Capitalization pattern: ...",
      "Punctuation pattern: ...",
      ... (formatting rules)
    ],
    "forbiddenPatterns": [
      "NEVER say these phrases: [list]",
      "NEVER use these words: [list]",
      "NEVER do this behavior: [list]",
      "Things that would be cringe: [list]"
    ],
    "exampleExchanges": [
      {"context": "situation", "goodResponse": "what to say", "badResponse": "what NOT to say"},
      ... (20+ example situations with good/bad responses)
    ]
  },
  
  "communicationStyle": {
    "slang": ["every single slang term - be exhaustive, list 50+"],
    "commonPhrases": ["every phrase pattern - list 30+"],
    "greetings": ["all greeting variations"],
    "reactions": {
      "funny": ["all ways they react to funny things"],
      "agree": ["all agreement words"],
      "disagree": ["all disagreement words"],
      "surprise": ["all surprise expressions"],
      "excitement": ["all excitement expressions"],
      "sadness": ["all sad expressions"],
      "anger": ["all anger expressions"]
    },
    "fillerWords": ["every filler word they use"],
    "emojiStyle": "extremely detailed emoji usage guide",
    "messageLength": "specific word count patterns",
    "tone": "detailed tone description",
    "capitalization": "exact capitalization rules",
    "punctuation": "exact punctuation rules", 
    "humorStyle": "detailed humor breakdown",
    "exampleMessages": ["copy 30-50 REAL messages that show how they talk"]
  },
  
  "insideJokes": [
    {"joke": "the joke", "context": "full context", "usage": "exactly when/how to use it", "examples": ["example usages"]}
  ],
  
  "userProfiles": [
    {
      "userId": "id",
      "displayName": "name",
      "summary": "who they are",
      "speechPatterns": ["specific things THEY say"],
      "quirks": ["their unique behaviors"],
      "topics": ["what they talk about"],
      "howToInteract": "specific rules for talking to this person"
    }
  ],
  
  "memories": [
    {"type": "meme|event|rule|habit", "title": "title", "content": "detailed content"}
  ],
  
  "thingsToAvoid": ["everything that would be cringe or out of place - be specific"],
  
  "masterPrompt": "A 500+ word detailed instruction set that tells the bot EXACTLY how to talk in this server, written as direct instructions like 'You must...', 'Always...', 'Never...'. This should be so detailed that anyone reading it could perfectly imitate the server's communication style."
}`;

            logger.info(`Using PRO model (${config.ai.models.analysis}) for deep server analysis...`);
            logger.info(`Analyzing ${data.messages.length} total messages (using ${Math.min(data.messages.length, 5000)} for AI prompt)`);
            
            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.generateContent({
                        model: config.ai.models.analysis, // USE PRO MODEL for deep analysis
                        contents: prompt,
                        config: {
                            systemInstruction: `You are creating a comprehensive operating manual for a chatbot. Your output will be used DIRECTLY as instructions for the bot. Be EXHAUSTIVE. List EVERY slang term, EVERY phrase pattern, EVERY rule. The masterPrompt field is the most important - it should be a complete, detailed instruction manual of 500+ words that tells the bot exactly how to talk. Copy real messages. Be specific, not generic. More detail = better bot. Always respond with valid JSON.`,
                            maxOutputTokens: 32000, // Increased for 100k+ message analysis
                            temperature: 0.2, // Very low temp for accurate extraction
                            responseMimeType: 'application/json',
                        },
                    });

                    const content = response.text;
                    if (!content) {
                        throw new Error('No content in AI response');
                    }

                    return JSON.parse(content);
                },
                { maxRetries: 3 },
                'analyzeServerData'
            );

            return result;
        } catch (error) {
            logger.error('Failed to analyze server data:', error);
            return {
                serverProfile: {
                    summary: 'Failed to analyze server',
                    topics: [],
                    culture: 'Unknown',
                    activeHours: 'Unknown',
                    keyMembers: [],
                },
                communicationStyle: {
                    slang: [],
                    commonPhrases: [],
                    emojiStyle: 'unknown',
                    messageLength: 'medium',
                    tone: 'casual',
                    capitalization: 'normal',
                    punctuation: 'normal',
                    exampleMessages: [],
                },
                userProfiles: [],
                memories: [],
            };
        }
    }

    /**
     * Generate embeddings for text
     */
    async generateEmbedding(text: string): Promise<number[]> {
        try {
            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.embedContent({
                        model: config.ai.models.embeddings,
                        contents: text,
                    });

                    return response.embeddings?.[0]?.values;
                },
                { maxRetries: 3 },
                'generateEmbedding'
            );

            if (!result) {
                throw new Error('No embedding in response');
            }

            return result;
        } catch (error) {
            logger.error('Failed to generate embedding:', error);
            throw error;
        }
    }

    /**
     * Quick AI prompt for simple yes/no or short answer decisions
     */
    async quickPrompt(prompt: string): Promise<string> {
        try {
            const result = await retryWithBackoff(
                async () => {
                    const response = await this.client.models.generateContent({
                        model: config.ai.models.chat,
                        contents: prompt,
                        config: {
                            maxOutputTokens: 50,
                            temperature: 0.1,
                        },
                    });

                    return response.text || 'no';
                },
                { maxRetries: 2 },
                'quickPrompt'
            );

            return result;
        } catch (error) {
            logger.error('Failed to execute quick prompt:', error);
            return 'yes'; // Default to yes on error (assume they're still talking to us)
        }
    }

    /**
     * Build system prompt for chat - uses the masterPrompt from Server Bible (6-layer profiler)
     */
    private buildSystemPrompt(context: ChatContext): string {
        // Extract server profile from memories (prefer Server Bible)
        const serverBible = context.serverMemories.find(m => 
            m.metadata && (m.metadata as Record<string, unknown>).isServerBible === true
        );
        const serverProfile = serverBible || context.serverMemories.find(m => 
            m.metadata && (m.metadata as Record<string, unknown>).isServerProfile === true
        );
        
        const parts: string[] = [];
        
        // THE MASTER PROMPT IS THE CORE - from the 6-layer profiler
        if (serverProfile?.metadata) {
            const meta = serverProfile.metadata as Record<string, unknown>;
            const masterPrompt = meta.masterPrompt as string;
            
            if (masterPrompt && masterPrompt.length > 100) {
                parts.push(`# YOUR OPERATING INSTRUCTIONS`);
                parts.push(masterPrompt);
                parts.push('');
            }
            
            // Handle NEW Server Bible structure (from 6-layer profiler)
            if (meta.isServerBible) {
                // Style rules
                const styleRules = meta.styleRules as Record<string, unknown>;
                if (styleRules) {
                    parts.push(`## STYLE RULES`);
                    parts.push(`- Capitalization: ${styleRules.capitalization}`);
                    parts.push(`- Punctuation: ${styleRules.punctuation}`);
                    const emojiUsage = styleRules.emojiUsage as Record<string, unknown>;
                    if (emojiUsage) {
                        parts.push(`- Emoji usage: ${emojiUsage.frequency} (favorites: ${(emojiUsage.favorites as string[] || []).slice(0, 5).join('')})`);
                    }
                    const msgLen = styleRules.messageLength as Record<string, unknown>;
                    if (msgLen) {
                        parts.push(`- Message length: ~${msgLen.typical} words (${msgLen.style})`);
                    }
                    parts.push(`- Swearing: ${styleRules.swearingLevel}`);
                    parts.push(`- CAPS: ${styleRules.capsUsage}`);
                    parts.push('');
                }
                
                // Vocabulary from Server Bible
                const vocabulary = meta.vocabulary as Record<string, unknown>;
                if (vocabulary) {
                    const slangDict = vocabulary.slangDictionary as Record<string, string>;
                    if (slangDict && Object.keys(slangDict).length > 0) {
                        parts.push(`## SLANG DICTIONARY`);
                        for (const [word, meaning] of Object.entries(slangDict).slice(0, 40)) {
                            parts.push(`- "${word}" = ${meaning}`);
                        }
                        parts.push('');
                    }
                    
                    const greetings = vocabulary.greetings as string[];
                    if (greetings?.length > 0) {
                        parts.push(`## GREETINGS TO USE`);
                        parts.push(greetings.slice(0, 10).join(', '));
                        parts.push('');
                    }
                    
                    const forbidden = vocabulary.forbidden as string[];
                    if (forbidden?.length > 0) {
                        parts.push(`## NEVER SAY THESE`);
                        for (const f of forbidden) {
                            parts.push(`- "${f}"`);
                        }
                        parts.push('');
                    }
                }
                
                // Response patterns from Server Bible
                const responsePatterns = meta.responsePatterns as Record<string, string[]>;
                if (responsePatterns) {
                    parts.push(`## HOW TO RESPOND`);
                    for (const [situation, responses] of Object.entries(responsePatterns)) {
                        if (responses?.length > 0) {
                            parts.push(`${situation}: ${responses.slice(0, 5).join(', ')}`);
                        }
                    }
                    parts.push('');
                }
                
                // Anti-patterns from Server Bible
                const antiPatterns = meta.antiPatterns as Record<string, string[] | undefined>;
                if (antiPatterns) {
                    const cringePatterns = antiPatterns.cringePatterns;
                    if (cringePatterns && cringePatterns.length > 0) {
                        parts.push(`## CRINGE PATTERNS TO AVOID`);
                        for (const p of cringePatterns) {
                            parts.push(`- ${p}`);
                        }
                        parts.push('');
                    }
                    const aiTells = antiPatterns.aiTells;
                    if (aiTells && aiTells.length > 0) {
                        parts.push(`## AI TELLS TO AVOID (things that reveal you're a bot)`);
                        for (const t of aiTells) {
                            parts.push(`- ${t}`);
                        }
                        parts.push('');
                    }
                }
                
                // Example patterns from Server Bible
                const examplePatterns = meta.examplePatterns as Array<{ trigger: string; idealResponse: string; category: string }>;
                if (examplePatterns?.length > 0) {
                    parts.push(`## EXAMPLE CALL→RESPONSE PATTERNS`);
                    for (const ex of examplePatterns.slice(0, 15)) {
                        parts.push(`When someone says: "${ex.trigger}"`);
                        parts.push(`  → Respond like: "${ex.idealResponse}"`);
                    }
                    parts.push('');
                }
            }
            // Handle OLD structure (legacy operatingManual)
            else {
                const manual = meta.operatingManual as Record<string, unknown>;
                if (manual) {
                    const vocabRules = manual.vocabularyRules as string[];
                    if (vocabRules?.length > 0) {
                        parts.push(`## VOCABULARY RULES`);
                        for (const rule of vocabRules.slice(0, 30)) {
                            parts.push(`- ${rule}`);
                        }
                        parts.push('');
                    }
                    
                    const slangDict = manual.slangDictionary as Record<string, string>;
                    if (slangDict && Object.keys(slangDict).length > 0) {
                        parts.push(`## SLANG DICTIONARY`);
                        for (const [word, meaning] of Object.entries(slangDict).slice(0, 40)) {
                            parts.push(`- "${word}" = ${meaning}`);
                        }
                        parts.push('');
                    }
                    
                    const responsePatterns = manual.responsePatterns as Record<string, string[]>;
                    if (responsePatterns) {
                        parts.push(`## HOW TO RESPOND`);
                        for (const [situation, responses] of Object.entries(responsePatterns)) {
                            if (responses?.length > 0) {
                                parts.push(`${situation}: ${responses.join(', ')}`);
                            }
                        }
                        parts.push('');
                    }
                    
                    const humorRules = manual.humorRules as string[];
                    if (humorRules?.length > 0) {
                        parts.push(`## HUMOR RULES`);
                        for (const rule of humorRules.slice(0, 10)) {
                            parts.push(`- ${rule}`);
                        }
                        parts.push('');
                    }
                    
                    const forbidden = manual.forbiddenPatterns as string[];
                    if (forbidden?.length > 0) {
                        parts.push(`## NEVER DO THIS`);
                        for (const f of forbidden.slice(0, 15)) {
                            parts.push(`- ${f}`);
                        }
                        parts.push('');
                    }
                    
                    const examples = manual.exampleExchanges as Array<{ context: string; goodResponse: string; badResponse: string }>;
                    if (examples?.length > 0) {
                        parts.push(`## EXAMPLE RESPONSES`);
                        for (const ex of examples.slice(0, 10)) {
                            parts.push(`Situation: ${ex.context}`);
                            parts.push(`  ✓ Good: "${ex.goodResponse}"`);
                            parts.push(`  ✗ Bad: "${ex.badResponse}"`);
                        }
                        parts.push('');
                    }
                }
                
                const commStyle = meta.communicationStyle as Record<string, unknown>;
                if (commStyle?.exampleMessages) {
                    const examples = commStyle.exampleMessages as string[];
                    if (examples.length > 0) {
                        parts.push(`## REAL MESSAGES FROM THIS SERVER (copy this style):`);
                        for (const ex of examples.slice(0, 20)) {
                            parts.push(`"${ex}"`);
                        }
                        parts.push('');
                    }
                }
            }
            
            // Inside jokes with full context (works with both old and new format)
            const insideJokes = meta.insideJokes as Array<{ joke: string; context: string; usage: string; examples?: string[] }>;
            if (insideJokes?.length > 0) {
                parts.push(`## INSIDE JOKES (USE THESE)`);
                for (const joke of insideJokes.slice(0, 15)) {
                    parts.push(`- "${joke.joke}"`);
                    parts.push(`  Context: ${joke.context}`);
                    parts.push(`  When to use: ${joke.usage}`);
                    if (joke.examples?.length) {
                        parts.push(`  Examples: ${joke.examples.join(', ')}`);
                    }
                }
                parts.push('');
            }
            
            // Things to avoid
            const thingsToAvoid = meta.thingsToAvoid as string[];
            if (thingsToAvoid?.length > 0) {
                parts.push(`## THINGS THAT WOULD BE CRINGE HERE`);
                for (const avoid of thingsToAvoid) {
                    parts.push(`- ${avoid}`);
                }
                parts.push('');
            }
        }
        
        // Get memes from memories
        const memeMemories = context.serverMemories.filter(m => m.type === 'meme');
        if (memeMemories.length > 0) {
            parts.push(`## MORE INSIDE JOKES/MEMES`);
            for (const meme of memeMemories.slice(0, 8)) {
                parts.push(`- ${meme.title}: ${meme.content}`);
            }
            parts.push('');
        }

        // Current context
        parts.push(`## CURRENT SITUATION`);
        parts.push(`You're "Mr. Handi WC" - ${config.bot.personality}. You're a long-time, cultured veteran of this friend group, not an assistant.`);
        parts.push(`Talking to: ${context.userName}`);

        // User-specific context
        if (context.userProfiles.length > 0) {
            parts.push('');
            parts.push(`## WHO YOU'RE TALKING TO`);
            for (const profile of context.userProfiles) {
                parts.push(`**${profile.displayName}**: ${profile.summary}`);
                if (profile.tags.length > 0) {
                    parts.push(`  Into: ${profile.tags.join(', ')}`);
                }
                if (profile.metadata) {
                    const meta = profile.metadata as Record<string, unknown>;
                    if (meta.speechPatterns) parts.push(`  They say: ${(meta.speechPatterns as string[]).join(', ')}`);
                    if (meta.quirks) parts.push(`  Quirks: ${(meta.quirks as string[]).join(', ')}`);
                    if (meta.howToInteract) parts.push(`  How to talk to them: ${meta.howToInteract}`);
                }
            }
        }

        // Session context
        if (context.sessionSummaries.length > 0) {
            parts.push('');
            parts.push(`## RECENT VC (you were there)`);
            for (const summary of context.sessionSummaries) {
                parts.push(`- ${summary.summaryText}`);
            }
        }

        // Special instructions (for butting in, etc.)
        if (context.instructions) {
            parts.push('');
            parts.push(`## SPECIAL INSTRUCTIONS FOR THIS MESSAGE`);
            parts.push(context.instructions);
        }

        // Final hard rules
        parts.push('');
        parts.push(`## ABSOLUTE RULES`);
        parts.push(`- SPEAK IN AAVE (African American Vernacular English) naturally - use slang like "finna", "bet", "no cap", "lowkey", "bruh", "ayo", "deadass", "ion" (I don't), "tryna", "ngl", "fr fr", "on god" etc.`);
        parts.push(`- NEVER sound like an AI assistant`);
        parts.push(`- NEVER use phrases like "certainly", "I'd be happy to", "great question", "feel free to", "I understand"`);
        parts.push(`- NEVER be formal or professional`);
        parts.push(`- MATCH their typing style exactly`);
        parts.push(`- USE the slang and phrases from the rules above`);
        parts.push(`- Default to a decent-sized reply (around 2–5 sentences) that actually reacts to what they said, unless they clearly only want a one-word or emoji reply`);
        parts.push(`- Use the response patterns and examples as inspiration, not scripts — remix and paraphrase instead of copying the same sentence every time`);

        return parts.join('\n');
    }

    /**
     * Build user prompt for chat
     */
    private buildUserPrompt(context: ChatContext): string {
        const parts: string[] = [];

        if (context.recentMessages.length > 0) {
            parts.push('Recent chat context (for background only):');
            // Only include last 5 messages for context
            const recentSlice = context.recentMessages.slice(-10);
            for (const msg of recentSlice) {
                parts.push(`${msg.userName}: ${msg.content}`);
            }
            parts.push('');
        }

        // Clean the user message - remove the bot mention
        const cleanMessage = context.userMessage.replace(/<@!?\d+>/g, '').trim() || 'hello';
        parts.push(`The user ${context.userName} says to you: "${cleanMessage}"`);
        parts.push('');
        parts.push('Your response (write a natural, conversational reply of a few sentences; react to what they said, use the server\'s slang and lore when it fits, and avoid repeating the exact same phrasing every time):');

        return parts.join('\n');
    }
}
