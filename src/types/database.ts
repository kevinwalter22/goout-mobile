export type Profile = {
  id: string;
  username: string;
  created_at: string;
  updated_at: string;
  xp: number;
  streak: number;
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

export type EventRSVP = {
  id: string;
  user_id: string;
  event_id: string;
  created_at: string;
};

export type Post = {
  id: string;
  user_id: string;
  event_id: string | null;
  caption: string | null;
  photo_path: string;
  front_photo_path: string | null;
  camera_mode: "front" | "back" | "dual";
  latitude: number | null;
  longitude: number | null;
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
    };
  };
};
