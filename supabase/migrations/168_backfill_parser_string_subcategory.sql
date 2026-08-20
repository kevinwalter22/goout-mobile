-- 168_backfill_parser_string_subcategory.sql
--
-- Clean the sub_category dirty-data: the web_collector adapter used to store the
-- extraction strategy (jsonld/ics/html_dom/rss) in sub_category "for reference" — but
-- sub_category feeds the intent mapping, and a 'jsonld' value matches no rule + pollutes
-- curation. Fixed at source (web_collector.ts now writes null). This backfills the rows
-- that already carry a parser-string. Idempotent + re-runnable.
--
-- These are web-collected EVENTS (kind='event'), which route to What's Happening by kind,
-- not by sub_category — so nulling it doesn't change their mapping, only removes the junk.
--
-- ROLLBACK: none needed (nulling junk is not reversible-worth; the values were meaningless).

update public.explore_items
set sub_category = null, updated_at = now()
where lower(sub_category) in
  ('jsonld','ics','html_dom','json_ld','rss','html','xml','microdata','microformats');
