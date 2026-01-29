# Migration Notes

## 023 Duplicate Resolution (2026-01-29)

**Problem**: Two migration files shared the number `023`:
- `023_add_posts_explore_item_id.sql` — adds `explore_item_id` FK to `posts`
- `023_upgrade_enrichment_pipeline.sql` — upgrades `apply_enrichment()` and `claim_enrichment_job()`

Both were already applied to the production database via the Supabase Dashboard SQL Editor.

**Fix**: Renamed `023_upgrade_enrichment_pipeline.sql` → `027_upgrade_enrichment_pipeline.sql`.

**Why this is safe**:
- Both files use idempotent DDL (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP FUNCTION IF EXISTS`)
- On existing environments: no re-application needed (already applied)
- On fresh environments: files sort correctly by filename prefix (023 before 027)
- 027's dependencies (enrichment_queue from 018, explore_items from 017) precede it in order

**Rollback**: Rename `027_upgrade_enrichment_pipeline.sql` back to `023_upgrade_enrichment_pipeline.sql`.

## Migration Sequence (current)

```
001 create_profiles
002 create_event_rsvps
003 create_posts
004 fix_posts_and_events
005 add_potsdam_events
006 fix_foreign_keys
007 add_more_local_events
008 fix_schema_cache
009 add_dual_camera_support
010 add_reactions_comments
011 add_friendships
012 add_profile_avatar_bio
013 add_friendship_status
014 add_xp_streak_progression
015 fix_streak_timezone
016 fix_current_streak
017 event_ingestion_architecture
018 add_llm_enrichment_fields
019 add_explore_item_rsvps
020 add_ticketmaster_source
021 add_availability_json
022 add_availability_filter_function
023 add_posts_explore_item_id
024 fix_profiles_rls_privacy
025 add_orphaned_media_cleanup_job
026 document_posts_fk_intent
027 upgrade_enrichment_pipeline
```

New Wave 1 migrations start at **028**.
