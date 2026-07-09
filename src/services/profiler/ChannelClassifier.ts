/**
 * ChannelClassifier - Automatically categorizes Discord channels based on name and topic
 * 
 * Categories:
 * - rules: Server rules, guidelines, policies
 * - announcements: Official announcements, news, updates
 * - general: Main chat, general discussion, lounge
 * - media: Images, videos, memes, clips
 * - gaming: Game-specific channels, looking-for-group
 * - voice-text: Text channels paired with voice channels
 * - bot-commands: Bot command channels
 * - support: Help, support, questions
 * - off-topic: Random, off-topic discussions
 * - introductions: Welcome, introductions, new members
 * - events: Events, tournaments, schedules
 * - creative: Art, music, creative content
 * - nsfw: Adult content channels
 * - logs: Logging, audit channels
 * - other: Uncategorized
 */

import { logger } from '../../utils/logger';

export type ChannelCategory = 
    | 'rules'
    | 'announcements'
    | 'general'
    | 'media'
    | 'gaming'
    | 'voice-text'
    | 'bot-commands'
    | 'support'
    | 'off-topic'
    | 'introductions'
    | 'events'
    | 'creative'
    | 'nsfw'
    | 'logs'
    | 'other';

export interface ClassifiedChannel {
    id: string;
    name: string;
    type: string;
    topic?: string | null;
    parentName?: string;
    category: ChannelCategory;
    confidence: number; // 0-1, how confident we are in the classification
    categoryReason: string; // Why we classified it this way
}

interface CategoryPattern {
    category: ChannelCategory;
    namePatterns: RegExp[];
    topicPatterns: RegExp[];
    priority: number; // Higher = checked first
}

const CATEGORY_PATTERNS: CategoryPattern[] = [
    // Rules - highest priority, must be identified correctly
    {
        category: 'rules',
        namePatterns: [
            /\brules?\b/i,
            /\bguidelines?\b/i,
            /\bpolic(y|ies)\b/i,
            /\btos\b/i,
            /\bterms\b/i,
            /\bcode.?of.?conduct\b/i,
            /\bserver.?info\b/i,
            /\bimportant\b/i,
            /\bread.?first\b/i,
            /\bread.?me\b/i,
        ],
        topicPatterns: [
            /\brules?\b/i,
            /\bguidelines?\b/i,
            /\bfollow\b.*\brules?\b/i,
            /\bserver\b.*\bpolicy\b/i,
        ],
        priority: 100,
    },
    // Announcements
    {
        category: 'announcements',
        namePatterns: [
            /\bannounce/i,
            /\bnews\b/i,
            /\bupdates?\b/i,
            /\bchangelog\b/i,
            /\bpatch.?notes?\b/i,
            /\bserver.?updates?\b/i,
            /\bnotice\b/i,
            /\bbroadcast\b/i,
        ],
        topicPatterns: [
            /\bannounce/i,
            /\bofficial\b/i,
            /\bupdates?\b/i,
        ],
        priority: 90,
    },
    // NSFW - check early to avoid misclassification
    {
        category: 'nsfw',
        namePatterns: [
            /\bnsfw\b/i,
            /\badult\b/i,
            /\b18\+\b/i,
            /\blewd\b/i,
            /\bspicy\b/i,
        ],
        topicPatterns: [
            /\bnsfw\b/i,
            /\b18\+\b/i,
            /\badult\b/i,
        ],
        priority: 85,
    },
    // Bot commands
    {
        category: 'bot-commands',
        namePatterns: [
            /\bbot/i,
            /\bcommands?\b/i,
            /\bspam\b/i,
            /\bbots?\b/i,
        ],
        topicPatterns: [
            /\bbot\b/i,
            /\bcommands?\b/i,
        ],
        priority: 80,
    },
    // Logs
    {
        category: 'logs',
        namePatterns: [
            /\blogs?\b/i,
            /\baudit\b/i,
            /\bmod.?log/i,
            /\bmessage.?log/i,
            /\bjoin.?leave/i,
        ],
        topicPatterns: [
            /\blogs?\b/i,
            /\baudit\b/i,
        ],
        priority: 75,
    },
    // Introductions
    {
        category: 'introductions',
        namePatterns: [
            /\bintro/i,
            /\bwelcome\b/i,
            /\bnew.?members?\b/i,
            /\bsay.?hi\b/i,
            /\bhello\b/i,
            /\bgreet/i,
        ],
        topicPatterns: [
            /\bintroduce\b/i,
            /\bwelcome\b/i,
            /\bnew\b.*\bmembers?\b/i,
        ],
        priority: 70,
    },
    // Support/Help
    {
        category: 'support',
        namePatterns: [
            /\bhelp\b/i,
            /\bsupport\b/i,
            /\bquestions?\b/i,
            /\bfaq\b/i,
            /\btroubleshoot/i,
            /\btech.?support\b/i,
            /\bask\b/i,
        ],
        topicPatterns: [
            /\bhelp\b/i,
            /\bsupport\b/i,
            /\bquestions?\b/i,
            /\bask\b/i,
        ],
        priority: 65,
    },
    // Events
    {
        category: 'events',
        namePatterns: [
            /\bevents?\b/i,
            /\btournament/i,
            /\bschedule\b/i,
            /\bmeetup/i,
            /\bgiveaway/i,
            /\bcontest/i,
            /\bstream/i,
        ],
        topicPatterns: [
            /\bevents?\b/i,
            /\btournament/i,
            /\bschedule\b/i,
        ],
        priority: 60,
    },
    // Creative
    {
        category: 'creative',
        namePatterns: [
            /\bart\b/i,
            /\bmusic\b/i,
            /\bcreative\b/i,
            /\bdrawing/i,
            /\bphotograph/i,
            /\bwriting\b/i,
            /\bpoetry\b/i,
            /\bshowcase\b/i,
            /\bportfolio\b/i,
        ],
        topicPatterns: [
            /\bart\b/i,
            /\bmusic\b/i,
            /\bcreative\b/i,
            /\bshare\b.*\b(art|music|work)\b/i,
        ],
        priority: 55,
    },
    // Media/Memes
    {
        category: 'media',
        namePatterns: [
            /\bmemes?\b/i,
            /\bmedia\b/i,
            /\bimages?\b/i,
            /\bpics?\b/i,
            /\bphotos?\b/i,
            /\bvideos?\b/i,
            /\bclips?\b/i,
            /\bscreenshots?\b/i,
            /\bgifs?\b/i,
            /\bfunny\b/i,
            /\bshitpost/i,
        ],
        topicPatterns: [
            /\bmemes?\b/i,
            /\bimages?\b/i,
            /\bvideos?\b/i,
            /\bshare\b/i,
        ],
        priority: 50,
    },
    // Gaming
    {
        category: 'gaming',
        namePatterns: [
            /\bgam(e|ing)\b/i,
            /\blfg\b/i,
            /\blooking.?for.?group/i,
            /\bparty.?finder\b/i,
            /\bminecraft\b/i,
            /\bvalorant\b/i,
            /\bleague\b/i,
            /\bfortnite\b/i,
            /\bapex\b/i,
            /\boverwatch\b/i,
            /\bcod\b/i,
            /\bgenshin\b/i,
            /\broblox\b/i,
            /\bsteam\b/i,
            /\bplaystation\b/i,
            /\bxbox\b/i,
            /\bnintendo\b/i,
            /\bpc.?gaming\b/i,
        ],
        topicPatterns: [
            /\bgam(e|ing)\b/i,
            /\bplay\b/i,
            /\blfg\b/i,
        ],
        priority: 45,
    },
    // Voice-text (paired with VC)
    {
        category: 'voice-text',
        namePatterns: [
            /\bvc\b/i,
            /\bvoice\b/i,
            /\blounge\b.*\btext\b/i,
            /\btext\b.*\blounge\b/i,
            /\bvoice.?chat\b/i,
            /\bvc.?text\b/i,
        ],
        topicPatterns: [
            /\bvoice\b/i,
            /\bvc\b/i,
        ],
        priority: 40,
    },
    // Off-topic
    {
        category: 'off-topic',
        namePatterns: [
            /\boff.?topic\b/i,
            /\brandom\b/i,
            /\bcasual\b/i,
            /\bmisc/i,
            /\bother\b/i,
            /\bchill\b/i,
            /\bhangout\b/i,
        ],
        topicPatterns: [
            /\boff.?topic\b/i,
            /\brandom\b/i,
            /\banything\b/i,
        ],
        priority: 35,
    },
    // General - lowest priority, catchall for main chat
    {
        category: 'general',
        namePatterns: [
            /\bgeneral\b/i,
            /\bmain\b/i,
            /\bchat\b/i,
            /\blounge\b/i,
            /\btalk\b/i,
            /\bsocial\b/i,
            /\bcommunity\b/i,
            /\bdiscussion\b/i,
        ],
        topicPatterns: [
            /\bgeneral\b/i,
            /\bmain\b/i,
            /\bchat\b/i,
            /\bdiscuss/i,
        ],
        priority: 30,
    },
];

export class ChannelClassifier {
    /**
     * Classify a single channel
     */
    static classifyChannel(channel: {
        id: string;
        name: string;
        type: string;
        topic?: string | null;
        parentName?: string;
    }): ClassifiedChannel {
        const name = channel.name.toLowerCase();
        const topic = (channel.topic || '').toLowerCase();
        const parentName = (channel.parentName || '').toLowerCase();

        // Sort patterns by priority (highest first)
        const sortedPatterns = [...CATEGORY_PATTERNS].sort((a, b) => b.priority - a.priority);

        let bestMatch: { category: ChannelCategory; confidence: number; reason: string } | null = null;

        for (const pattern of sortedPatterns) {
            let confidence = 0;
            const reasons: string[] = [];

            // Check name patterns
            for (const namePattern of pattern.namePatterns) {
                if (namePattern.test(name)) {
                    confidence += 0.6;
                    reasons.push(`name matches "${namePattern.source}"`);
                    break; // One name match is enough
                }
            }

            // Check topic patterns
            for (const topicPattern of pattern.topicPatterns) {
                if (topicPattern.test(topic)) {
                    confidence += 0.3;
                    reasons.push(`topic matches "${topicPattern.source}"`);
                    break;
                }
            }

            // Check parent category name (e.g., channel in "RULES" category)
            for (const namePattern of pattern.namePatterns) {
                if (namePattern.test(parentName)) {
                    confidence += 0.2;
                    reasons.push(`parent category matches "${namePattern.source}"`);
                    break;
                }
            }

            // Cap confidence at 1.0
            confidence = Math.min(confidence, 1.0);

            if (confidence > 0 && (!bestMatch || confidence > bestMatch.confidence)) {
                bestMatch = {
                    category: pattern.category,
                    confidence,
                    reason: reasons.join(', '),
                };
            }
        }

        // Default to 'other' if no match
        if (!bestMatch) {
            bestMatch = {
                category: 'other',
                confidence: 0.1,
                reason: 'no pattern matched',
            };
        }

        return {
            ...channel,
            category: bestMatch.category,
            confidence: bestMatch.confidence,
            categoryReason: bestMatch.reason,
        };
    }

    /**
     * Classify all channels in a server
     */
    static classifyChannels(channels: Array<{
        id: string;
        name: string;
        type: string;
        topic?: string | null;
        parentName?: string;
    }>): ClassifiedChannel[] {
        const classified = channels.map(ch => this.classifyChannel(ch));

        // Log summary
        const categoryCounts: Record<ChannelCategory, number> = {} as Record<ChannelCategory, number>;
        for (const ch of classified) {
            categoryCounts[ch.category] = (categoryCounts[ch.category] || 0) + 1;
        }

        logger.info(`Channel classification summary: ${JSON.stringify(categoryCounts)}`);

        return classified;
    }

    /**
     * Get channels by category
     */
    static getChannelsByCategory(
        classifiedChannels: ClassifiedChannel[],
        category: ChannelCategory
    ): ClassifiedChannel[] {
        return classifiedChannels.filter(ch => ch.category === category);
    }

    /**
     * Get a human-readable description of what each category means for AI training
     */
    static getCategoryDescription(category: ChannelCategory): string {
        const descriptions: Record<ChannelCategory, string> = {
            'rules': 'Server rules and guidelines - extract these as normative rules the bot must follow',
            'announcements': 'Official announcements - formal tone, not representative of casual chat',
            'general': 'Main conversation channel - learn personality and casual communication style here',
            'media': 'Media sharing - memes, images, videos; learn humor and reaction patterns',
            'gaming': 'Gaming discussion - may contain game-specific slang and coordination talk',
            'voice-text': 'Voice chat text companion - casual, often fragmented conversation',
            'bot-commands': 'Bot commands - ignore for personality training',
            'support': 'Help/support - learn how to be helpful and answer questions',
            'off-topic': 'Off-topic chat - casual banter, may be more random/chaotic',
            'introductions': 'Introductions - welcoming tone, learn how to greet new members',
            'events': 'Events discussion - scheduling, coordination, hype',
            'creative': 'Creative content - appreciation, feedback patterns',
            'nsfw': 'Adult content - may contain explicit language, handle appropriately',
            'logs': 'Logging channels - ignore for personality training',
            'other': 'Uncategorized - general content, no special handling',
        };

        return descriptions[category] || 'Unknown category';
    }

    /**
     * Build a summary of channel categories for the AI prompt
     */
    static buildChannelContextSummary(classifiedChannels: ClassifiedChannel[]): string {
        const lines: string[] = [];
        
        // Group by category
        const byCategory: Record<ChannelCategory, ClassifiedChannel[]> = {} as Record<ChannelCategory, ClassifiedChannel[]>;
        for (const ch of classifiedChannels) {
            if (!byCategory[ch.category]) {
                byCategory[ch.category] = [];
            }
            byCategory[ch.category].push(ch);
        }

        // Build summary
        for (const [category, channels] of Object.entries(byCategory)) {
            const channelNames = channels.map(ch => `#${ch.name}`).slice(0, 5).join(', ');
            const extra = channels.length > 5 ? ` (+${channels.length - 5} more)` : '';
            lines.push(`**${category}**: ${channelNames}${extra}`);
        }

        return lines.join('\n');
    }
}
