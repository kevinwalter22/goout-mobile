/**
 * Recommender System Configuration
 *
 * Weights and thresholds for the hybrid ranking system.
 * All AI features are behind feature flags.
 *
 * This is a transparent, explainable ranking system - not a black-box algorithm.
 */

export const RECOMMENDER_CONFIG = {
  // Feature flag names (must match database)
  FLAGS: {
    LLM_RERANKER: "llm_reranker",
    WEATHER_BOOST: "weather_boost",
    FRIENDS_BOOST: "friends_rsvp_boost",
    TAG_AFFINITY: "tag_affinity",
    TYPE_AFFINITY_LEARNING: "type_affinity_learning",
    CONTACTS_SYNC: "contacts_sync",
    INGESTION: "ingestion",
    COMMUNITY_FEEDBACK: "community_feedback",
    FRESHNESS: "freshness_signal",
    FRIEND_CREATED_BOOST: "friend_created_boost",
  },

  // Scoring weights (sum to 1.0 for normalized score)
  WEIGHTS: {
    TIME_MATCH: 0.15, // Time of day / event timing match
    DISTANCE: 0.20, // Closer = higher score
    OPEN_NOW: 0.08, // Currently available/happening
    FRIENDS_GOING: 0.13, // Friends RSVP boost
    TAG_AFFINITY: 0.06, // User preference match
    WEATHER: 0.06, // Weather/season-appropriate
    CONTEXT_INTENT: 0.03, // Day/time context bias
    TYPE_AFFINITY: 0.06, // Learned event-vs-activity preference (All toggle only)
    QUALITY: 0.10, // Item confidence / data quality
    COMMUNITY_FEEDBACK: 0.05, // Community upvote/confirm/downvote/closed signal
    FRESHNESS: 0.00, // Recency boost (disabled — absorbed by FRIEND_CREATED)
    FRIEND_CREATED: 0.08, // Event created by a friend
  },

  // Distance scoring thresholds
  DISTANCE: {
    MAX_MILES: 30, // Items beyond this get 0 distance score
    OPTIMAL_MILES: 3, // Items within this get max score
  },

  // Time matching windows
  TIME_WINDOWS: {
    MORNING: { start: 6, end: 12 },
    AFTERNOON: { start: 12, end: 17 },
    EVENING: { start: 17, end: 21 },
    NIGHT: { start: 21, end: 4 },
  },

  // LLM Reranker settings (optional, behind feature flag)
  LLM_RERANKER: {
    TOP_K: 20, // Only rerank top K candidates
    CACHE_TTL_HOURS: 2, // Cache duration
    MAX_TOKENS: 500, // Token budget per request
    TIME_BUCKET_MINUTES: 60, // Round time to this for cache key
  },

  // Weather-based tagging and temperature thresholds (Fahrenheit)
  WEATHER: {
    API_CACHE_MINUTES: 30,
    // Temperature thresholds (Fahrenheit)
    FREEZING_F: 32, // Below this: heavily penalize outdoor
    COLD_F: 45, // Below this: penalize outdoor
    COMFORTABLE_LOW_F: 55, // Comfortable range start
    COMFORTABLE_HIGH_F: 85, // Comfortable range end
    HOT_F: 95, // Above this: penalize outdoor
    INDOOR_TAGS: [
      "museum",
      "indoor",
      "cafe",
      "restaurant",
      "theater",
      "cinema",
      "mall",
      "gallery",
      "library",
      "gym",
      "bowling",
      "arcade",
      "spa",
      "shopping",
    ],
    OUTDOOR_TAGS: [
      "outdoor",
      "hiking",
      "park",
      "beach",
      "festival",
      "market",
      "garden",
      "trail",
      "camping",
      "sports",
      "golf",
      "kayak",
      "biking",
      "running",
    ],
    // Category-level outdoor detection (for items without specific tags)
    OUTDOOR_CATEGORIES: ["Outdoor", "Sports & Recreation"],
    INDOOR_CATEGORIES: ["Nightlife", "Arts & Culture"],
  },

  // Tag affinity tracking (weights are also used server-side in log_interaction_and_update_affinity)
  TAG_AFFINITY: {
    POST_WEIGHT: 3.0, // Weight for posting about a tag
    SHARE_WEIGHT: 2.0, // Weight for sharing an item
    RSVP_WEIGHT: 1.5, // Weight for RSVPing to an event with tag
    OPEN_DETAIL_WEIGHT: 1.0, // Weight for opening item detail
    MAX_TAGS: 20, // Limit stored tags per user
  },

  // Type affinity learning (event vs activity preference)
  TYPE_AFFINITY: {
    MIN_INTERACTIONS: 3, // Minimum interactions before signal has effect
    SCORE_FLOOR: 0.3, // Never push score below this (prevent full penalization)
  },

  // Freshness scoring — kind-aware recency boost
  FRESHNESS: {
    // Activities: decay curve based on created_at age
    ACTIVITY_TIERS: [
      { maxDays: 3, score: 1.0 },
      { maxDays: 7, score: 0.8 },
      { maxDays: 14, score: 0.6 },
      { maxDays: 30, score: 0.3 },
    ] as const,
    ACTIVITY_DEFAULT: 0.1, // Older than 30 days
    // Events: neutral (time signals already handle urgency)
    EVENT_SCORE: 0.5,
    // Fallback when created_at is null
    NULL_SCORE: 0.5,
  },

  // Community feedback scoring
  COMMUNITY_FEEDBACK: {
    MAX_NET_SCORE: 15,   // Maps to 1.0
    MIN_NET_SCORE: -10,  // Maps to 0.0
    SCORE_FLOOR: 0.1,
    SCORE_CEILING: 1.0,
  },

  // Friends going scoring
  FRIENDS: {
    ONE_FRIEND: 0.5,
    TWO_FRIENDS: 0.7,
    THREE_PLUS: 1.0,
  },

  // Context Intent: time/day-of-week biases for the "All" toggle.
  // Each bucket defines when it applies and how much to boost events vs activities.
  // eventBoost/activityBoost: 0-1 score for that item kind when the bucket matches.
  // Items of the non-boosted kind get (1 - boost) as their score.
  // tagBoosts: optional small category/tag bonuses within this bucket.
  CONTEXT_INTENT: {
    // Neutral score when no bucket matches or when user is on Events/Activities toggle
    NEUTRAL: 0.5,

    BUCKETS: [
      {
        name: "Fri/Sat Evening",
        daysOfWeek: [5, 6], // Fri=5, Sat=6
        hourStart: 16,
        hourEnd: 24,
        eventBoost: 0.85,
        activityBoost: 0.4,
        tagBoosts: { nightlife: 0.15, concert: 0.1, live_music: 0.1 },
      },
      {
        name: "Fri Afternoon",
        daysOfWeek: [5],
        hourStart: 12,
        hourEnd: 16,
        eventBoost: 0.7,
        activityBoost: 0.5,
        tagBoosts: {},
      },
      {
        name: "Sat/Sun Morning",
        daysOfWeek: [0, 6], // Sun=0, Sat=6
        hourStart: 6,
        hourEnd: 12,
        eventBoost: 0.35,
        activityBoost: 0.85,
        tagBoosts: { cafe: 0.1, coffee: 0.1, brunch: 0.15 },
      },
      {
        name: "Sunday Afternoon",
        daysOfWeek: [0],
        hourStart: 12,
        hourEnd: 17,
        eventBoost: 0.45,
        activityBoost: 0.75,
        tagBoosts: {},
      },
      {
        name: "Weekday Lunch",
        daysOfWeek: [1, 2, 3, 4], // Mon-Thu
        hourStart: 11,
        hourEnd: 14,
        eventBoost: 0.35,
        activityBoost: 0.75,
        tagBoosts: { food: 0.1, cafe: 0.1, restaurant: 0.1 },
      },
      {
        name: "Weekday Evening",
        daysOfWeek: [1, 2, 3, 4],
        hourStart: 17,
        hourEnd: 22,
        eventBoost: 0.7,
        activityBoost: 0.55,
        tagBoosts: { nightlife: 0.05 },
      },
    ] as const,

    // Enable debug logging in dev
    DEBUG: __DEV__,
  },
} as const;

export type RecommenderConfig = typeof RECOMMENDER_CONFIG;

// Dev-only weight sum validation
if (__DEV__) {
  const sum = (Object.values(RECOMMENDER_CONFIG.WEIGHTS) as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    console.error(`[RECOMMENDER] Weights sum to ${sum}, expected 1.0!`);
  }
}
