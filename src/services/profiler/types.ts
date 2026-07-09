/**
 * Types for the 6-Layer Server Culture Analysis System
 */

/** Raw message from Discord */
export interface RawMessage {
    channelId: string;
    channelName: string;
    authorId: string;
    authorName: string;
    content: string;
    timestamp: Date;
    attachments: number;
    reactions: string[];
    mentions: string[];
    replyToId?: string;
}

/** LAYER 1: A conversation chunk/session */
export interface ConversationChunk {
    id: string;
    channelId: string;
    channelName: string;
    startTime: Date;
    endTime: Date;
    participants: string[];
    messageCount: number;
    messages: RawMessage[];
    vibeType: 'shitpost' | 'serious' | 'hype' | 'drama' | 'chill' | 'gaming' | 'debate' | 'vent' | 'mixed';
    slangDensity: number;
    emojiDensity: number;
    topics: string[];
}

/** LAYER 2: Session mini-summary */
export interface SessionSummary {
    chunkId: string;
    summary: string;
    keyQuotes: string[];
    keySlang: string[];
    emotionalPattern: string;
    loreGenerated: string[];
    participants: Record<string, string>;
    vibeScore: {
        humor: number;
        chaos: number;
        wholesome: number;
        toxicity: number;
    };
}

/** LAYER 3: Global culture map entries */
export interface SlangEntry {
    term: string;
    meaning: string;
    examples: string[];
    usageContext: 'roast' | 'hype' | 'comfort' | 'greeting' | 'reaction' | 'general';
    frequency: number;
    originUser?: string;
}

export interface LoreEntry {
    title: string;
    description: string;
    date?: Date;
    participants: string[];
    references: string[];
    memePotential: number;
    examples: string[];
}

export interface SocialDynamic {
    relationship: string;
    type: 'friends' | 'rivals' | 'couple' | 'nemesis' | 'mentor' | 'group';
    howTheyInteract: string;
    insideJokes: string[];
    examples: string[];
}

export interface GlobalCultureMap {
    slangMap: SlangEntry[];
    loreMap: LoreEntry[];
    socialMap: SocialDynamic[];
    roleHierarchy: { role: string; howToAddressThem: string; howTheyTalk: string }[];
    taboos: string[];
    sacredCows: string[];
    runningJokes: { joke: string; setup: string; payoff: string; frequency: 'rare' | 'common' | 'overused' }[];
}

/** LAYER 4: Pattern Bank */
export interface PatternEntry {
    trigger: string;
    context: string;
    idealResponse: string;
    category: 'roast' | 'hype' | 'comfort' | 'lore' | 'smalltalk' | 'reaction' | 'meme' | 'greeting' | 'farewell';
    energy: 'low' | 'medium' | 'high' | 'unhinged';
}

export interface PatternBank {
    patterns: PatternEntry[];
    greetings: { input: string; responses: string[] }[];
    farewells: { input: string; responses: string[] }[];
    reactions: { emotion: string; expressions: string[] }[];
    roastTemplates: string[];
    hypeTemplates: string[];
    comfortTemplates: string[];
}

/** LAYER 5: The Server Bible */
export interface ServerBible {
    coreIdentity: {
        summary: string;
        personality: string[];
        archetypes: ('friend' | 'shitposter' | 'lorekeeper' | 'hypeman')[];
    };

    styleRules: {
        capitalization: 'lowercase' | 'normal' | 'CAPS_HEAVY' | 'mixed';
        punctuation: 'minimal' | 'normal' | 'excessive' | 'chaotic';
        emojiUsage: {
            frequency: 'never' | 'rare' | 'moderate' | 'heavy';
            favorites: string[];
            avoidThese: string[];
        };
        messageLength: { typical: number; max: number; style: 'terse' | 'normal' | 'verbose' };
        slangDensity: number;
        swearingLevel: 'never' | 'mild' | 'moderate' | 'heavy';
        capsUsage: 'never' | 'for_emphasis' | 'frequent' | 'ALWAYS';
    };

    vocabulary: {
        slangDictionary: Record<string, string>;
        phrases: { phrase: string; meaning: string; when: string }[];
        greetings: string[];
        farewells: string[];
        affirmatives: string[];
        negatives: string[];
        reactions: Record<string, string[]>;
        forbidden: string[];
    };

    responsePatterns: {
        whenHappy: string[];
        whenSad: string[];
        whenAngry: string[];
        whenConfused: string[];
        whenExcited: string[];
        whenBored: string[];
        toRoast: string[];
        toHype: string[];
        toComfort: string[];
        toDisagree: string[];
        toAgree: string[];
        toGreet: string[];
        toFarewell: string[];
    };

    lore: {
        majorEvents: LoreEntry[];
        memes: LoreEntry[];
        copypastas: string[];
        legends: { who: string; why: string }[];
    };

    exampleLibrary: PatternBank;

    userProfiles: {
        userId: string;
        displayName: string;
        personality: string;
        speechPatterns: string[];
        interests: string[];
        quirks: string[];
        howToInteract: string;
        relationshipToOthers: string[];
    }[];

    masterPrompt: string;

    antiPatterns: {
        neverSay: string[];
        neverDo: string[];
        cringePatterns: string[];
        aiTells: string[];
    };

    metadata: {
        messageCount: number;
        chunkCount: number;
        userCount: number;
        channelCount: number;
        dateRange: { start: Date; end: Date };
        generatedAt: Date;
        lastIncrementalUpdate?: string;
        incrementalMessageCount?: number;
    };
}

export type ProgressCallback = (status: string) => Promise<void>;
