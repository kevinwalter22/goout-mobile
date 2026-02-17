export type PublicProfile = {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
};

export type Profile = PublicProfile & {
  updated_at: string;
  xp: number;
  streak: number;
  last_post_date: string | null;
  is_admin: boolean;
  phone_number: string | null;
  phone_hash: string | null;
  phone_verified_at: string | null;
};

export type Event = {
  id: string;
  title: string;
  starts_at: string;
  venue_name: string | null;
  city: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
};

// ============================================================================
// AVAILABILITY TYPES (for AI-enriched explore items)
// ============================================================================

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | "daily";
export type Season = "spring" | "summer" | "fall" | "winter" | "year_round";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "anytime";
export type AvailabilityType = "event" | "activity";
export type RecurrenceType = "none" | "daily" | "weekly" | "monthly" | "annual" | "unknown";
export type EventVisibility = "friends_only" | "public";

export type AvailableTimes = {
  start: string; // "09:00" 24hr format
  end: string;   // "17:00"
};

export type Availability = {
  type: AvailabilityType;

  // For activities - when is it available?
  available_days?: DayOfWeek[];
  available_times?: AvailableTimes | "anytime" | "daylight";
  available_seasons?: Season[];

  // For events - when does it happen?
  next_occurrence?: string | null; // ISO 8601
  recurrence?: RecurrenceType;

  // Common fields
  typical_duration?: string; // "2-3 hours", "full day", "multi-day"
  best_time_of_day?: TimeOfDay;

  // Quality
  confidence: number; // 0-100
  source: "ai_enrichment" | "manual" | "api";
};

// ============================================================================
// EXPLORE ITEM
// ============================================================================

export type ExploreItem = {
  id: string;
  kind: "event" | "activity";
  title: string;
  description: string | null;
  hook_line: string | null;
  category: string | null;
  sub_category: string | null;
  location_name: string | null;
  address: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
  starts_at: string | null;
  ends_at: string | null;
  schedule_text: string | null;
  time_text: string | null;
  recurrence: string | null;
  season: string | null;
  price_bucket: "free" | "$" | "$$" | "$$$" | "unknown";
  effort: "low" | "medium" | "high" | "unknown";
  xp_value: number | null;
  priority: number;
  is_anchor: boolean;
  is_hidden_gem: boolean;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  // AI enrichment fields
  tags?: string[];
  llm_enriched_at?: string | null;
  availability_json?: Availability | null;
  // Image fields
  image_url?: string | null;
  image_thumb_url?: string | null;
  image_cached_at?: string | null;
  image_source?: string | null;
  image_search_attempted_at?: string | null;
  // User-created event fields
  created_by_user_id?: string | null;
  visibility?: EventVisibility | null;
  // Review / provenance fields (web collector)
  review_status?: "auto_approved" | "quarantined" | "approved" | "rejected" | null;
  provenance?: Record<string, any> | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  // Refresh tracking
  last_refreshed_at?: string | null;
  stale_reason?: string | null;
  // Soft delete
  deleted_at?: string | null;
};

export type EventRSVP = {
  id: string;
  user_id: string;
  event_id: string;
  created_at: string;
};

export type ExploreItemRSVP = {
  id: string;
  user_id: string;
  explore_item_id: string;
  created_at: string;
};

export type Post = {
  id: string;
  user_id: string;
  event_id: string | null;
  explore_item_id: string | null;
  caption: string | null;
  photo_path: string;
  front_photo_path: string | null;
  camera_mode: "front" | "back" | "dual";
  latitude: number | null;
  longitude: number | null;
  created_at: string;
};

export type PostReaction = {
  id: string;
  post_id: string;
  user_id: string;
  emoji: "❤️" | "😂" | "🔥" | "👏" | "😮" | "😢";
  created_at: string;
};

export type PostComment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

export type Friendship = {
  id: string;
  user_id: string;
  friend_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
};

export type ReportReason = "spam" | "harassment" | "inappropriate_content" | "impersonation" | "other";
export type ReportStatus = "pending" | "reviewed" | "dismissed" | "actioned";
export type ReportTargetType = "post" | "comment" | "user";

export type ContentReport = {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type UserBlock = {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "created_at" | "updated_at">;
        Update: Partial<Omit<Profile, "id" | "created_at" | "updated_at">>;
      };
      events: {
        Row: Event;
        Insert: Omit<Event, "id">;
        Update: Partial<Omit<Event, "id">>;
      };
      event_rsvps: {
        Row: EventRSVP;
        Insert: Omit<EventRSVP, "id" | "created_at">;
        Update: never;
      };
      posts: {
        Row: Post;
        Insert: Omit<Post, "created_at"> & { id?: string };
        Update: never;
      };
      post_reactions: {
        Row: PostReaction;
        Insert: Omit<PostReaction, "id" | "created_at">;
        Update: never;
      };
      post_comments: {
        Row: PostComment;
        Insert: Omit<PostComment, "id" | "created_at">;
        Update: never;
      };
      friendships: {
        Row: Friendship;
        Insert: Omit<Friendship, "id" | "created_at">;
        Update: Partial<Pick<Friendship, "status">>;
      };
    };
  };
};
