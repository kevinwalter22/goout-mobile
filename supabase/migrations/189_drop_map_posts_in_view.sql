-- 189_drop_map_posts_in_view.sql
--
-- Re-scope: check-in posts move OFF the Explore discovery map (they belong on the social
-- surfaces — profile + feed). The map_posts_in_view RPC (mig 188) existed only to feed the
-- Explore-map layer, which is being removed. The profile/feed maps reuse the EXISTING post
-- hooks (useUserPosts / usePosts) — the exact same query + visibility gate as the grid/feed —
-- so no dedicated RPC (and no new data-access surface) is needed. Drop it.
--
-- mig 188 never reached prod; this keeps the migration history forward-only.
-- ROLLBACK: re-run mig 188's body.

drop function if exists public.map_posts_in_view(numeric, numeric, numeric, numeric, integer);
