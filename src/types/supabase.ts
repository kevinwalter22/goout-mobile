export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_user_id: string
          after_snapshot: Json | null
          before_snapshot: Json | null
          created_at: string
          id: string
          item_id: string
        }
        Insert: {
          action: string
          admin_user_id: string
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          id?: string
          item_id: string
        }
        Update: {
          action?: string
          admin_user_id?: string
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          id?: string
          item_id?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          metadata: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          metadata?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          metadata?: Json
          user_id?: string
        }
        Relationships: []
      }
      api_usage_counters: {
        Row: {
          id: string
          period_start: string
          requests_limit: number
          requests_used: number
          service: string
          updated_at: string
        }
        Insert: {
          id?: string
          period_start: string
          requests_limit?: number
          requests_used?: number
          service: string
          updated_at?: string
        }
        Update: {
          id?: string
          period_start?: string
          requests_limit?: number
          requests_used?: number
          service?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      app_secrets: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      category_fallback_images: {
        Row: {
          category: string
          created_at: string | null
          fallback_url: string
        }
        Insert: {
          category: string
          created_at?: string | null
          fallback_url: string
        }
        Update: {
          category?: string
          created_at?: string | null
          fallback_url?: string
        }
        Relationships: []
      }
      collector_blocklist: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          pattern: string
          pattern_type: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          pattern: string
          pattern_type: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          pattern?: string
          pattern_type?: string
          reason?: string | null
        }
        Relationships: []
      }
      collector_page_cache: {
        Row: {
          consecutive_unchanged: number | null
          content_hash: string
          content_type: string | null
          etag: string | null
          extracted_candidates: Json | null
          extraction_errors: string[] | null
          extraction_strategy:
            | Database["public"]["Enums"]["parsing_strategy"]
            | null
          fetched_at: string
          headers_json: Json | null
          http_status: number | null
          id: string
          last_changed_at: string
          last_checked_at: string
          last_modified: string | null
          raw_html: string | null
          target_id: string
          url: string
          url_hash: string
        }
        Insert: {
          consecutive_unchanged?: number | null
          content_hash: string
          content_type?: string | null
          etag?: string | null
          extracted_candidates?: Json | null
          extraction_errors?: string[] | null
          extraction_strategy?:
            | Database["public"]["Enums"]["parsing_strategy"]
            | null
          fetched_at?: string
          headers_json?: Json | null
          http_status?: number | null
          id?: string
          last_changed_at?: string
          last_checked_at?: string
          last_modified?: string | null
          raw_html?: string | null
          target_id: string
          url: string
          url_hash: string
        }
        Update: {
          consecutive_unchanged?: number | null
          content_hash?: string
          content_type?: string | null
          etag?: string | null
          extracted_candidates?: Json | null
          extraction_errors?: string[] | null
          extraction_strategy?:
            | Database["public"]["Enums"]["parsing_strategy"]
            | null
          fetched_at?: string
          headers_json?: Json | null
          http_status?: number | null
          id?: string
          last_changed_at?: string
          last_checked_at?: string
          last_modified?: string | null
          raw_html?: string | null
          target_id?: string
          url?: string
          url_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "collector_page_cache_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "collector_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collector_page_cache_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "v_collector_target_health"
            referencedColumns: ["target_id"]
          },
        ]
      }
      collector_targets: {
        Row: {
          allowed_paths: string[]
          base_url: string
          circuit_breaker: Database["public"]["Enums"]["circuit_breaker_state"]
          consecutive_errors: number
          contact_email: string
          content_types: string[] | null
          crawl_frequency_minutes: number
          created_at: string
          default_category: string | null
          discovery_urls: string[]
          dom_selectors: Json | null
          id: string
          is_enabled: boolean
          last_run_at: string | null
          last_run_errors: number | null
          last_run_items_found: number | null
          last_run_pages_fetched: number | null
          max_consecutive_errors: number
          max_pages_per_run: number
          name: string
          parsing_strategy: Database["public"]["Enums"]["parsing_strategy"]
          rate_limit_rpm: number
          request_delay_ms: number
          robots_txt_allows_crawl: boolean | null
          robots_txt_cache: string | null
          robots_txt_fetched_at: string | null
          site_config: Json | null
          source_id: string | null
          total_items_collected: number | null
          town: string | null
          updated_at: string
          user_agent: string | null
          venue_name: string | null
        }
        Insert: {
          allowed_paths?: string[]
          base_url: string
          circuit_breaker?: Database["public"]["Enums"]["circuit_breaker_state"]
          consecutive_errors?: number
          contact_email?: string
          content_types?: string[] | null
          crawl_frequency_minutes?: number
          created_at?: string
          default_category?: string | null
          discovery_urls?: string[]
          dom_selectors?: Json | null
          id?: string
          is_enabled?: boolean
          last_run_at?: string | null
          last_run_errors?: number | null
          last_run_items_found?: number | null
          last_run_pages_fetched?: number | null
          max_consecutive_errors?: number
          max_pages_per_run?: number
          name: string
          parsing_strategy?: Database["public"]["Enums"]["parsing_strategy"]
          rate_limit_rpm?: number
          request_delay_ms?: number
          robots_txt_allows_crawl?: boolean | null
          robots_txt_cache?: string | null
          robots_txt_fetched_at?: string | null
          site_config?: Json | null
          source_id?: string | null
          total_items_collected?: number | null
          town?: string | null
          updated_at?: string
          user_agent?: string | null
          venue_name?: string | null
        }
        Update: {
          allowed_paths?: string[]
          base_url?: string
          circuit_breaker?: Database["public"]["Enums"]["circuit_breaker_state"]
          consecutive_errors?: number
          contact_email?: string
          content_types?: string[] | null
          crawl_frequency_minutes?: number
          created_at?: string
          default_category?: string | null
          discovery_urls?: string[]
          dom_selectors?: Json | null
          id?: string
          is_enabled?: boolean
          last_run_at?: string | null
          last_run_errors?: number | null
          last_run_items_found?: number | null
          last_run_pages_fetched?: number | null
          max_consecutive_errors?: number
          max_pages_per_run?: number
          name?: string
          parsing_strategy?: Database["public"]["Enums"]["parsing_strategy"]
          rate_limit_rpm?: number
          request_delay_ms?: number
          robots_txt_allows_crawl?: boolean | null
          robots_txt_cache?: string | null
          robots_txt_fetched_at?: string | null
          site_config?: Json | null
          source_id?: string | null
          total_items_collected?: number | null
          town?: string | null
          updated_at?: string
          user_agent?: string | null
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collector_targets_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "event_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      enrichment_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          explore_item_id: string
          id: string
          last_error: string | null
          max_attempts: number
          priority: number
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          explore_item_id: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          priority?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          explore_item_id?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          priority?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_queue_explore_item_id_fkey"
            columns: ["explore_item_id"]
            isOneToOne: true
            referencedRelation: "explore_items"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ingest_raw: {
        Row: {
          created_at: string
          external_id: string
          fetched_at: string
          id: string
          last_error: string | null
          raw_hash: string
          raw_json: Json
          source_id: string
          status: Database["public"]["Enums"]["ingest_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id: string
          fetched_at?: string
          id?: string
          last_error?: string | null
          raw_hash: string
          raw_json: Json
          source_id: string
          status?: Database["public"]["Enums"]["ingest_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string
          fetched_at?: string
          id?: string
          last_error?: string | null
          raw_hash?: string
          raw_json?: Json
          source_id?: string
          status?: Database["public"]["Enums"]["ingest_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_ingest_raw_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "event_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      event_normalization_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          raw_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          raw_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          raw_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_normalization_jobs_raw_id_fkey"
            columns: ["raw_id"]
            isOneToOne: true
            referencedRelation: "event_ingest_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sources: {
        Row: {
          config_json: Json | null
          created_at: string
          fetch_interval_minutes: number | null
          id: string
          is_enabled: boolean
          last_fetch_at: string | null
          name: string
          type: Database["public"]["Enums"]["event_source_type"]
          updated_at: string
        }
        Insert: {
          config_json?: Json | null
          created_at?: string
          fetch_interval_minutes?: number | null
          id?: string
          is_enabled?: boolean
          last_fetch_at?: string | null
          name: string
          type: Database["public"]["Enums"]["event_source_type"]
          updated_at?: string
        }
        Update: {
          config_json?: Json | null
          created_at?: string
          fetch_interval_minutes?: number | null
          id?: string
          is_enabled?: boolean
          last_fetch_at?: string | null
          name?: string
          type?: Database["public"]["Enums"]["event_source_type"]
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          address: string | null
          category: string | null
          city: string | null
          created_at: string
          ends_at: string | null
          id: string
          lat: number | null
          latitude: number | null
          lng: number | null
          longitude: number | null
          starts_at: string
          title: string
          venue_name: string | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          city?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          lat?: number | null
          latitude?: number | null
          lng?: number | null
          longitude?: number | null
          starts_at: string
          title: string
          venue_name?: string | null
        }
        Update: {
          address?: string | null
          category?: string | null
          city?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          lat?: number | null
          latitude?: number | null
          lng?: number | null
          longitude?: number | null
          starts_at?: string
          title?: string
          venue_name?: string | null
        }
        Relationships: []
      }
      explore_item_rsvps: {
        Row: {
          created_at: string
          explore_item_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          explore_item_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          explore_item_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "explore_item_rsvps_explore_item_id_fkey"
            columns: ["explore_item_id"]
            isOneToOne: false
            referencedRelation: "explore_items"
            referencedColumns: ["id"]
          },
        ]
      }
      explore_items: {
        Row: {
          address: string | null
          availability_json: Json | null
          canonical_item_id: string | null
          category: string | null
          created_at: string
          created_by_user_id: string | null
          dedupe_key: string | null
          deleted_at: string | null
          description: string | null
          effort: Database["public"]["Enums"]["effort_level"]
          ends_at: string | null
          external_id: string | null
          hook_line: string | null
          id: string
          image_cached_at: string | null
          image_search_attempted_at: string | null
          image_source: string | null
          image_thumb_url: string | null
          image_url: string | null
          is_anchor: boolean
          is_duplicate: boolean
          is_hidden_gem: boolean
          kind: Database["public"]["Enums"]["explore_item_kind"]
          last_refreshed_at: string | null
          lat: number | null
          llm_enriched_at: string | null
          lng: number | null
          location_name: string | null
          normalized_confidence: number | null
          price_bucket: Database["public"]["Enums"]["price_bucket"]
          priority: number | null
          provenance: Json | null
          recurrence: string | null
          review_status: Database["public"]["Enums"]["review_status"] | null
          reviewed_at: string | null
          reviewed_by: string | null
          schedule_text: string | null
          season: string | null
          source_id: string | null
          source_url: string | null
          stale_reason: string | null
          starts_at: string | null
          sub_category: string | null
          tags: string[] | null
          time_text: string | null
          title: string
          town: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["event_visibility"] | null
          xp_value: number | null
        }
        Insert: {
          address?: string | null
          availability_json?: Json | null
          canonical_item_id?: string | null
          category?: string | null
          created_at?: string
          created_by_user_id?: string | null
          dedupe_key?: string | null
          deleted_at?: string | null
          description?: string | null
          effort?: Database["public"]["Enums"]["effort_level"]
          ends_at?: string | null
          external_id?: string | null
          hook_line?: string | null
          id?: string
          image_cached_at?: string | null
          image_search_attempted_at?: string | null
          image_source?: string | null
          image_thumb_url?: string | null
          image_url?: string | null
          is_anchor?: boolean
          is_duplicate?: boolean
          is_hidden_gem?: boolean
          kind?: Database["public"]["Enums"]["explore_item_kind"]
          last_refreshed_at?: string | null
          lat?: number | null
          llm_enriched_at?: string | null
          lng?: number | null
          location_name?: string | null
          normalized_confidence?: number | null
          price_bucket?: Database["public"]["Enums"]["price_bucket"]
          priority?: number | null
          provenance?: Json | null
          recurrence?: string | null
          review_status?: Database["public"]["Enums"]["review_status"] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          schedule_text?: string | null
          season?: string | null
          source_id?: string | null
          source_url?: string | null
          stale_reason?: string | null
          starts_at?: string | null
          sub_category?: string | null
          tags?: string[] | null
          time_text?: string | null
          title: string
          town?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["event_visibility"] | null
          xp_value?: number | null
        }
        Update: {
          address?: string | null
          availability_json?: Json | null
          canonical_item_id?: string | null
          category?: string | null
          created_at?: string
          created_by_user_id?: string | null
          dedupe_key?: string | null
          deleted_at?: string | null
          description?: string | null
          effort?: Database["public"]["Enums"]["effort_level"]
          ends_at?: string | null
          external_id?: string | null
          hook_line?: string | null
          id?: string
          image_cached_at?: string | null
          image_search_attempted_at?: string | null
          image_source?: string | null
          image_thumb_url?: string | null
          image_url?: string | null
          is_anchor?: boolean
          is_duplicate?: boolean
          is_hidden_gem?: boolean
          kind?: Database["public"]["Enums"]["explore_item_kind"]
          last_refreshed_at?: string | null
          lat?: number | null
          llm_enriched_at?: string | null
          lng?: number | null
          location_name?: string | null
          normalized_confidence?: number | null
          price_bucket?: Database["public"]["Enums"]["price_bucket"]
          priority?: number | null
          provenance?: Json | null
          recurrence?: string | null
          review_status?: Database["public"]["Enums"]["review_status"] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          schedule_text?: string | null
          season?: string | null
          source_id?: string | null
          source_url?: string | null
          stale_reason?: string | null
          starts_at?: string | null
          sub_category?: string | null
          tags?: string[] | null
          time_text?: string | null
          title?: string
          town?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["event_visibility"] | null
          xp_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "explore_items_canonical_item_id_fkey"
            columns: ["canonical_item_id"]
            isOneToOne: false
            referencedRelation: "explore_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "explore_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "event_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          config_json: Json | null
          created_at: string
          flag_name: string
          id: string
          is_enabled: boolean
          rollout_percentage: number | null
          updated_at: string
        }
        Insert: {
          config_json?: Json | null
          created_at?: string
          flag_name: string
          id?: string
          is_enabled?: boolean
          rollout_percentage?: number | null
          updated_at?: string
        }
        Update: {
          config_json?: Json | null
          created_at?: string
          flag_name?: string
          id?: string
          is_enabled?: boolean
          rollout_percentage?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      fetch_partitions: {
        Row: {
          config_json: Json
          consecutive_errors: number
          created_at: string
          fetch_interval_minutes: number
          id: string
          is_enabled: boolean
          last_error: string | null
          last_fetched_at: string | null
          last_result: Json | null
          partition_label: string
          priority: number
          source_id: string
          updated_at: string
        }
        Insert: {
          config_json: Json
          consecutive_errors?: number
          created_at?: string
          fetch_interval_minutes?: number
          id?: string
          is_enabled?: boolean
          last_error?: string | null
          last_fetched_at?: string | null
          last_result?: Json | null
          partition_label: string
          priority?: number
          source_id: string
          updated_at?: string
        }
        Update: {
          config_json?: Json
          consecutive_errors?: number
          created_at?: string
          fetch_interval_minutes?: number
          id?: string
          is_enabled?: boolean
          last_error?: string | null
          last_fetched_at?: string | null
          last_result?: Json | null
          partition_label?: string
          priority?: number
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fetch_partitions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "event_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          created_at: string
          friend_id: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          friend_id: string
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          friend_id?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      llm_reranker_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          id: string
          input_item_ids: string[]
          output_ranking: Json
          time_bucket: string
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          id?: string
          input_item_ids: string[]
          output_ranking: Json
          time_bucket: string
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          id?: string
          input_item_ids?: string[]
          output_ranking?: Json
          time_bucket?: string
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      pipeline_health_log: {
        Row: {
          created_at: string
          details_json: Json | null
          duration_ms: number | null
          id: string
          items_failed: number | null
          items_processed: number | null
          source_name: string | null
          stage: string
          status: string
        }
        Insert: {
          created_at?: string
          details_json?: Json | null
          duration_ms?: number | null
          id?: string
          items_failed?: number | null
          items_processed?: number | null
          source_name?: string | null
          stage: string
          status?: string
        }
        Update: {
          created_at?: string
          details_json?: Json | null
          duration_ms?: number | null
          id?: string
          items_failed?: number | null
          items_processed?: number | null
          source_name?: string | null
          stage?: string
          status?: string
        }
        Relationships: []
      }
      place_details_cache: {
        Row: {
          created_at: string
          editorial_summary: string | null
          expires_at: string
          explore_item_id: string
          external_place_id: string
          fetched_at: string
          google_maps_uri: string | null
          id: string
          opening_hours: Json | null
          phone_number: string | null
          photos: Json | null
          rating: number | null
          reviews: Json | null
          updated_at: string
          user_rating_count: number | null
          website_uri: string | null
        }
        Insert: {
          created_at?: string
          editorial_summary?: string | null
          expires_at?: string
          explore_item_id: string
          external_place_id: string
          fetched_at?: string
          google_maps_uri?: string | null
          id?: string
          opening_hours?: Json | null
          phone_number?: string | null
          photos?: Json | null
          rating?: number | null
          reviews?: Json | null
          updated_at?: string
          user_rating_count?: number | null
          website_uri?: string | null
        }
        Update: {
          created_at?: string
          editorial_summary?: string | null
          expires_at?: string
          explore_item_id?: string
          external_place_id?: string
          fetched_at?: string
          google_maps_uri?: string | null
          id?: string
          opening_hours?: Json | null
          phone_number?: string | null
          photos?: Json | null
          rating?: number | null
          reviews?: Json | null
          updated_at?: string
          user_rating_count?: number | null
          website_uri?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "place_details_cache_explore_item_id_fkey"
            columns: ["explore_item_id"]
            isOneToOne: true
            referencedRelation: "explore_items"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          camera_mode: string
          caption: string | null
          created_at: string
          event_id: string | null
          explore_item_id: string | null
          front_photo_path: string | null
          id: string
          latitude: number | null
          longitude: number | null
          photo_path: string
          user_id: string
        }
        Insert: {
          camera_mode: string
          caption?: string | null
          created_at?: string
          event_id?: string | null
          explore_item_id?: string | null
          front_photo_path?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          photo_path: string
          user_id: string
        }
        Update: {
          camera_mode?: string
          caption?: string | null
          created_at?: string
          event_id?: string | null
          explore_item_id?: string | null
          front_photo_path?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          photo_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_explore_item_id_fkey"
            columns: ["explore_item_id"]
            isOneToOne: false
            referencedRelation: "explore_items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          id: string
          is_admin: boolean
          last_post_date: string | null
          phone_hash: string | null
          phone_number: string | null
          phone_verified_at: string | null
          streak: number
          updated_at: string
          username: string
          xp: number
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id: string
          is_admin?: boolean
          last_post_date?: string | null
          phone_hash?: string | null
          phone_number?: string | null
          phone_verified_at?: string | null
          streak?: number
          updated_at?: string
          username: string
          xp?: number
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          is_admin?: boolean
          last_post_date?: string | null
          phone_hash?: string | null
          phone_number?: string | null
          phone_verified_at?: string | null
          streak?: number
          updated_at?: string
          username?: string
          xp?: number
        }
        Relationships: []
      }
      security_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_hash: string | null
          metadata: Json
          severity: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          severity: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          severity?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      user_item_events: {
        Row: {
          created_at: string
          event_type: string
          explore_item_id: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          explore_item_id: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          explore_item_id?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_item_events_explore_item_id_fkey"
            columns: ["explore_item_id"]
            isOneToOne: false
            referencedRelation: "explore_items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_rate_limits: {
        Row: {
          action: string
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          action: string
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          action?: string
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      user_tag_affinity: {
        Row: {
          created_at: string
          id: string
          interaction_count: number
          last_interaction_at: string | null
          score: number
          tag: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          interaction_count?: number
          last_interaction_at?: string | null
          score?: number
          tag: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interaction_count?: number
          last_interaction_at?: string | null
          score?: number
          tag?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_type_affinity: {
        Row: {
          activities_engaged: number
          activity_bias: number
          event_bias: number
          events_engaged: number
          last_updated_at: string
          user_id: string
        }
        Insert: {
          activities_engaged?: number
          activity_bias?: number
          event_bias?: number
          events_engaged?: number
          last_updated_at?: string
          user_id: string
        }
        Update: {
          activities_engaged?: number
          activity_bias?: number
          event_bias?: number
          events_engaged?: number
          last_updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          id: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          id?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          id?: string | null
          username?: string | null
        }
        Relationships: []
      }
      v_collector_target_health: {
        Row: {
          base_url: string | null
          circuit_breaker:
            | Database["public"]["Enums"]["circuit_breaker_state"]
            | null
          consecutive_errors: number | null
          crawl_frequency_minutes: number | null
          created_at: string | null
          is_enabled: boolean | null
          is_overdue: boolean | null
          last_run_at: string | null
          last_run_items_found: number | null
          last_run_pages_fetched: number | null
          minutes_since_run: number | null
          name: string | null
          pages_with_extractions: number | null
          robots_cache_stale: boolean | null
          robots_txt_allows_crawl: boolean | null
          robots_txt_fetched_at: string | null
          strategy: string | null
          target_id: string | null
          total_cached_pages: number | null
          total_candidates_extracted: number | null
          updated_at: string | null
        }
        Insert: {
          base_url?: string | null
          circuit_breaker?:
            | Database["public"]["Enums"]["circuit_breaker_state"]
            | null
          consecutive_errors?: number | null
          crawl_frequency_minutes?: number | null
          created_at?: string | null
          is_enabled?: boolean | null
          is_overdue?: never
          last_run_at?: string | null
          last_run_items_found?: number | null
          last_run_pages_fetched?: number | null
          minutes_since_run?: never
          name?: string | null
          pages_with_extractions?: never
          robots_cache_stale?: never
          robots_txt_allows_crawl?: boolean | null
          robots_txt_fetched_at?: string | null
          strategy?: never
          target_id?: string | null
          total_cached_pages?: never
          total_candidates_extracted?: never
          updated_at?: string | null
        }
        Update: {
          base_url?: string | null
          circuit_breaker?:
            | Database["public"]["Enums"]["circuit_breaker_state"]
            | null
          consecutive_errors?: number | null
          crawl_frequency_minutes?: number | null
          created_at?: string | null
          is_enabled?: boolean | null
          is_overdue?: never
          last_run_at?: string | null
          last_run_items_found?: number | null
          last_run_pages_fetched?: number | null
          minutes_since_run?: never
          name?: string | null
          pages_with_extractions?: never
          robots_cache_stale?: never
          robots_txt_allows_crawl?: boolean | null
          robots_txt_fetched_at?: string | null
          strategy?: never
          target_id?: string | null
          total_cached_pages?: never
          total_candidates_extracted?: never
          updated_at?: string | null
        }
        Relationships: []
      }
      v_ingestion_activity: {
        Row: {
          active_items: number | null
          duplicate_items: number | null
          is_enabled: boolean | null
          items_created_24h: number | null
          last_fetch_at: string | null
          norm_failed: number | null
          norm_queued: number | null
          raw_failed: number | null
          raw_last_24h: number | null
          raw_normalized: number | null
          raw_pending: number | null
          raw_skipped: number | null
          source_name: string | null
          source_type: string | null
          total_raw_records: number | null
        }
        Insert: {
          active_items?: never
          duplicate_items?: never
          is_enabled?: boolean | null
          items_created_24h?: never
          last_fetch_at?: string | null
          norm_failed?: never
          norm_queued?: never
          raw_failed?: never
          raw_last_24h?: never
          raw_normalized?: never
          raw_pending?: never
          raw_skipped?: never
          source_name?: string | null
          source_type?: never
          total_raw_records?: never
        }
        Update: {
          active_items?: never
          duplicate_items?: never
          is_enabled?: boolean | null
          items_created_24h?: never
          last_fetch_at?: string | null
          norm_failed?: never
          norm_queued?: never
          raw_failed?: never
          raw_last_24h?: never
          raw_normalized?: never
          raw_pending?: never
          raw_skipped?: never
          source_name?: string | null
          source_type?: never
          total_raw_records?: never
        }
        Relationships: []
      }
      v_pipeline_stage_health: {
        Row: {
          avg_duration_ms: number | null
          error_runs: number | null
          last_details: Json | null
          last_run_at: string | null
          last_status: string | null
          runs_last_7d: number | null
          source_name: string | null
          stage: string | null
          success_rate_pct: number | null
          total_failed: number | null
          total_processed: number | null
          warn_runs: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_enrichment:
        | {
            Args: {
              p_ends_at?: string
              p_explore_item_id: string
              p_hook_line?: string
              p_recurrence?: string
              p_starts_at?: string
              p_tags?: string[]
            }
            Returns: undefined
          }
        | {
            Args: {
              p_availability_json?: Json
              p_ends_at?: string
              p_explore_item_id: string
              p_hook_line?: string
              p_recurrence?: string
              p_starts_at?: string
              p_tags?: string[]
            }
            Returns: undefined
          }
        | {
            Args: {
              p_availability_json?: Json
              p_ends_at?: string
              p_explore_item_id: string
              p_hook_line?: string
              p_price_bucket?: Database["public"]["Enums"]["price_bucket"]
              p_recurrence?: string
              p_starts_at?: string
              p_tags?: string[]
            }
            Returns: undefined
          }
        | {
            Args: {
              p_availability_json?: Json
              p_description?: string
              p_ends_at?: string
              p_explore_item_id: string
              p_hook_line?: string
              p_price_bucket?: Database["public"]["Enums"]["price_bucket"]
              p_recurrence?: string
              p_starts_at?: string
              p_tags?: string[]
              p_time_text?: string
            }
            Returns: undefined
          }
      approve_quarantined_item: {
        Args: { p_item_id: string }
        Returns: undefined
      }
      assert_caller: { Args: { p_user_id: string }; Returns: undefined }
      check_rate_limit: {
        Args: {
          p_action: string
          p_limit: number
          p_user_id: string
          p_window_seconds: number
        }
        Returns: undefined
      }
      claim_enrichment_job: {
        Args: never
        Returns: {
          explore_item_id: string
          item_availability_json: Json
          item_category: string
          item_description: string
          item_hook_line: string
          item_price_bucket: Database["public"]["Enums"]["price_bucket"]
          item_recurrence: string
          item_schedule_text: string
          item_season: string
          item_tags: string[]
          item_time_text: string
          item_title: string
          job_id: string
        }[]
      }
      claim_normalization_job: {
        Args: never
        Returns: {
          external_id: string
          job_id: string
          raw_id: string
          raw_json: Json
          source_id: string
        }[]
      }
      cleanup_expired_reranker_cache: { Args: never; Returns: number }
      cleanup_old_health_logs: { Args: { p_days?: number }; Returns: number }
      complete_collector_run: {
        Args: {
          p_circuit_trip?: boolean
          p_errors: number
          p_items_found: number
          p_pages_fetched: number
          p_target_id: string
        }
        Returns: undefined
      }
      complete_enrichment_job: {
        Args: { p_error?: string; p_job_id: string; p_success: boolean }
        Returns: undefined
      }
      complete_fetch_partition: {
        Args: {
          p_error?: string
          p_partition_id: string
          p_result?: Json
          p_success: boolean
        }
        Returns: undefined
      }
      complete_normalization_job: {
        Args: { p_error?: string; p_job_id: string; p_success: boolean }
        Returns: undefined
      }
      compute_dedupe_key: {
        Args: {
          p_lat: number
          p_lng: number
          p_location_name?: string
          p_starts_at: string
          p_title: string
        }
        Returns: string
      }
      compute_item_confidence: { Args: { p_item_id: string }; Returns: number }
      count_filtered_explore_items: {
        Args: {
          p_categories?: string[]
          p_min_confidence?: number
          p_price_bucket?: string
          p_range_end?: string
          p_range_start?: string
          p_season?: string
          p_tags?: string[]
          p_time_of_day?: string
        }
        Returns: number
      }
      demote_stale_items: { Args: never; Returns: number }
      demote_stale_web_items: {
        Args: { p_stale_days?: number }
        Returns: number
      }
      filter_explore_items: {
        Args: {
          p_categories?: string[]
          p_limit?: number
          p_min_confidence?: number
          p_offset?: number
          p_price_bucket?: string
          p_range_end?: string
          p_range_start?: string
          p_season?: string
          p_tags?: string[]
          p_time_of_day?: string
        }
        Returns: {
          address: string | null
          availability_json: Json | null
          canonical_item_id: string | null
          category: string | null
          created_at: string
          created_by_user_id: string | null
          dedupe_key: string | null
          deleted_at: string | null
          description: string | null
          effort: Database["public"]["Enums"]["effort_level"]
          ends_at: string | null
          external_id: string | null
          hook_line: string | null
          id: string
          image_cached_at: string | null
          image_search_attempted_at: string | null
          image_source: string | null
          image_thumb_url: string | null
          image_url: string | null
          is_anchor: boolean
          is_duplicate: boolean
          is_hidden_gem: boolean
          kind: Database["public"]["Enums"]["explore_item_kind"]
          last_refreshed_at: string | null
          lat: number | null
          llm_enriched_at: string | null
          lng: number | null
          location_name: string | null
          normalized_confidence: number | null
          price_bucket: Database["public"]["Enums"]["price_bucket"]
          priority: number | null
          provenance: Json | null
          recurrence: string | null
          review_status: Database["public"]["Enums"]["review_status"] | null
          reviewed_at: string | null
          reviewed_by: string | null
          schedule_text: string | null
          season: string | null
          source_id: string | null
          source_url: string | null
          stale_reason: string | null
          starts_at: string | null
          sub_category: string | null
          tags: string[] | null
          time_text: string | null
          title: string
          town: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["event_visibility"] | null
          xp_value: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "explore_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_api_budget: {
        Args: { p_service: string }
        Returns: {
          requests_limit: number
          requests_remaining: number
          requests_used: number
        }[]
      }
      get_blocked_user_ids: { Args: never; Returns: string[] }
      get_cached_place_details: {
        Args: { p_explore_item_id: string }
        Returns: {
          editorial_summary: string
          fetched_at: string
          google_maps_uri: string
          is_expired: boolean
          opening_hours: Json
          phone_number: string
          photos: Json
          rating: number
          reviews: Json
          user_rating_count: number
          website_uri: string
        }[]
      }
      get_current_season: { Args: never; Returns: string }
      get_day_abbrev: { Args: { p_date?: string }; Returns: string }
      get_display_image: {
        Args: { p_category: string; p_image_thumb_url: string }
        Returns: string
      }
      get_enabled_collector_targets: {
        Args: never
        Returns: {
          allowed_paths: string[]
          base_url: string
          content_types: string[]
          crawl_frequency_minutes: number
          default_category: string
          discovery_urls: string[]
          dom_selectors: Json
          max_pages_per_run: number
          minutes_since_last_run: number
          name: string
          parsing_strategy: Database["public"]["Enums"]["parsing_strategy"]
          rate_limit_rpm: number
          request_delay_ms: number
          site_config: Json
          source_id: string
          target_id: string
          town: string
          user_agent: string
          venue_name: string
        }[]
      }
      get_fallback_image: { Args: { p_category: string }; Returns: string }
      get_friend_recommendations: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          avatar_url: string
          mutual_count: number
          user_id: string
          username: string
        }[]
      }
      get_friends_going_for_items: {
        Args: { p_item_ids: string[]; p_user_id: string }
        Returns: {
          explore_item_id: string
          friends_going_count: number
        }[]
      }
      get_image_coverage_stats: {
        Args: never
        Returns: {
          coverage_percentage: number
          curated_items: number
          curated_with_images: number
          google_places_items: number
          google_places_with_images: number
          items_needing_refresh: number
          items_never_searched: number
          items_searched_no_result: number
          items_with_cached_images: number
          items_without_images: number
          ticketmaster_items: number
          ticketmaster_with_images: number
          total_items: number
          web_collector_items: number
          web_collector_with_images: number
        }[]
      }
      get_items_needing_images: {
        Args: { p_limit?: number; p_source_type?: string }
        Returns: {
          external_id: string
          id: string
          lat: number
          lng: number
          location_name: string
          source_type: string
          title: string
          town: string
        }[]
      }
      get_quarantine_queue: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          category: string
          created_at: string
          description: string
          id: string
          location_name: string
          normalized_confidence: number
          provenance: Json
          source_url: string
          starts_at: string
          title: string
          town: string
        }[]
      }
      get_security_event_summary: {
        Args: { p_days?: number }
        Returns: {
          event_count: number
          event_date: string
          event_type: string
          severity: string
          unique_users: number
        }[]
      }
      get_stale_images: {
        Args: { p_limit?: number }
        Returns: {
          days_since_cache: number
          external_id: string
          id: string
          image_cached_at: string
          title: string
        }[]
      }
      get_user_tag_affinity: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          interaction_count: number
          score: number
          tag: string
        }[]
      }
      get_user_type_affinity: {
        Args: { p_user_id: string }
        Returns: {
          activity_bias: number
          event_bias: number
          total_interactions: number
        }[]
      }
      increment_api_usage: {
        Args: { p_count?: number; p_service: string }
        Returns: boolean
      }
      infer_category_from_tags: { Args: { p_tags: string[] }; Returns: string }
      invoke_cleanup_orphaned_media: { Args: never; Returns: undefined }
      is_available_at_time: {
        Args: { p_availability: Json; p_time_of_day: string }
        Returns: boolean
      }
      is_available_in_season: {
        Args: { p_availability: Json; p_season: string }
        Returns: boolean
      }
      is_available_on_day: {
        Args: { p_availability: Json; p_day: string }
        Returns: boolean
      }
      is_current_user_admin: { Args: never; Returns: boolean }
      is_item_available_in_range: {
        Args: {
          p_availability: Json
          p_range_end: string
          p_range_start: string
          p_starts_at: string
        }
        Returns: boolean
      }
      log_interaction_and_update_affinity: {
        Args: {
          p_event_type: string
          p_explore_item_id: string
          p_item_kind: string
          p_metadata?: Json
          p_user_id: string
        }
        Returns: undefined
      }
      log_security_event: {
        Args: { p_event_type: string; p_metadata?: Json; p_severity: string }
        Returns: undefined
      }
      mark_duplicates: {
        Args: never
        Returns: {
          groups_found: number
          items_marked: number
        }[]
      }
      mark_fuzzy_duplicates: {
        Args: never
        Returns: {
          items_marked: number
          pairs_found: number
        }[]
      }
      mark_image_search_attempted: {
        Args: { p_item_id: string }
        Returns: undefined
      }
      match_contacts: {
        Args: { p_hashed_phones: string[]; p_user_id: string }
        Returns: {
          avatar_url: string
          user_id: string
          username: string
        }[]
      }
      needs_image_refresh: {
        Args: { p_image_cached_at: string; p_refresh_days?: number }
        Returns: boolean
      }
      next_fetch_partition: {
        Args: { p_source_type?: string }
        Returns: {
          config_json: Json
          minutes_since_fetch: number
          partition_id: string
          partition_label: string
          source_id: string
          source_name: string
          source_type: string
        }[]
      }
      pipeline_health_snapshot: { Args: never; Returns: Json }
      queue_for_enrichment: {
        Args: { p_explore_item_id: string; p_priority?: number }
        Returns: undefined
      }
      quick_health_check: {
        Args: never
        Returns: {
          check_details: string
          check_name: string
          check_status: string
          check_value: string
        }[]
      }
      reject_quarantined_item: {
        Args: { p_item_id: string; p_reason?: string }
        Returns: undefined
      }
      reset_circuit_breaker: {
        Args: { p_target_id: string }
        Returns: undefined
      }
      reset_stale_enrichment_jobs: {
        Args: { p_timeout_minutes?: number }
        Returns: {
          jobs_reset: number
        }[]
      }
      save_phone_number: {
        Args: { p_phone_number: string; p_user_id: string }
        Returns: undefined
      }
      search_profiles: {
        Args: { query: string }
        Returns: {
          avatar_url: string
          id: string
          username: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      toggle_feature_flag: {
        Args: { p_flag_name: string; p_is_enabled: boolean }
        Returns: {
          flag_name: string
          is_enabled: boolean
          updated_at: string
        }[]
      }
      trip_circuit_breaker: {
        Args: { p_reason?: string; p_target_id: string }
        Returns: undefined
      }
      update_item_image: {
        Args: { p_image_url: string; p_item_id: string; p_thumb_url?: string }
        Returns: undefined
      }
      update_robots_cache: {
        Args: {
          p_allows_crawl: boolean
          p_robots_txt: string
          p_target_id: string
        }
        Returns: undefined
      }
      update_source_image: {
        Args: {
          p_image_url: string
          p_item_id: string
          p_source?: string
          p_thumb_url?: string
        }
        Returns: undefined
      }
      update_user_progression: {
        Args: { p_post_date: string; p_user_id: string; p_xp_amount: number }
        Returns: {
          new_streak: number
          new_xp: number
        }[]
      }
      update_user_tag_affinity: {
        Args: { p_tags: string[]; p_user_id: string; p_weight?: number }
        Returns: undefined
      }
      validate_availability_json: { Args: { p_avail: Json }; Returns: Json }
      web_collector_health_snapshot: { Args: never; Returns: Json }
    }
    Enums: {
      circuit_breaker_state: "closed" | "open" | "half_open"
      effort_level: "low" | "medium" | "high" | "unknown"
      event_source_type:
        | "curated_csv"
        | "api_ticketmaster"
        | "api_predicthq"
        | "api_eventbrite"
        | "api_yelp"
        | "api_google_places"
        | "manual"
        | "web_community_calendar"
        | "web_collector"
      event_visibility: "friends_only" | "public"
      explore_item_kind: "event" | "activity"
      ingest_status: "new" | "normalized" | "failed" | "skipped"
      job_status: "queued" | "running" | "done" | "failed"
      parsing_strategy: "jsonld" | "ics" | "rss" | "html_dom" | "hybrid"
      price_bucket: "free" | "$" | "$$" | "$$$" | "unknown"
      review_status: "auto_approved" | "quarantined" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      circuit_breaker_state: ["closed", "open", "half_open"],
      effort_level: ["low", "medium", "high", "unknown"],
      event_source_type: [
        "curated_csv",
        "api_ticketmaster",
        "api_predicthq",
        "api_eventbrite",
        "api_yelp",
        "api_google_places",
        "manual",
        "web_community_calendar",
        "web_collector",
      ],
      event_visibility: ["friends_only", "public"],
      explore_item_kind: ["event", "activity"],
      ingest_status: ["new", "normalized", "failed", "skipped"],
      job_status: ["queued", "running", "done", "failed"],
      parsing_strategy: ["jsonld", "ics", "rss", "html_dom", "hybrid"],
      price_bucket: ["free", "$", "$$", "$$$", "unknown"],
      review_status: ["auto_approved", "quarantined", "approved", "rejected"],
    },
  },
} as const
