-- ============================================================================
-- 160_base_intent_mapping.sql  (Layer 2 foundation — base mapping, task 2)
-- ============================================================================
-- Version-controls the Kevin-calibrated base-intent mapping as a re-runnable
-- function so item_intents is reproducible (not a one-off backfill) and can be
-- refreshed after ingestion. Populates PRIMARY (mutually exclusive) + conservative
-- strong-signal SECONDARY intents from kind/category/tags/sub_category/notability.
-- Calibrated against the live catalog (see docs/intent_taxonomy.md §4): café->bite,
-- brewery-by-name->drink, fitness-vs-active-play split (climbing/axe -> Go Play,
-- fitness gym -> residue), generic+outdoor -> Get Outside, landmark override,
-- anti-inventory residue -> no rows. source='base' rows only (discovery/manual untouched).
-- Rollback: DROP FUNCTION public.refresh_base_intent_mappings();
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refresh_base_intent_mappings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $FN$
DECLARE v_n integer;
BEGIN
DELETE FROM public.item_intents WHERE source='base';

WITH sig AS (
  SELECT ei.id, ei.kind, ei.category, ei.title,
    lower(coalesce(ei.sub_category,'')) AS sc,
    coalesce(ei.notability_score,0) AS notab,
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['bar','pub','brewery','night club','wine bar','distillery','winery','cocktail bar','taproom','sports bar','beer garden','irish pub','gastropub']) AS drink_sub,
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['restaurant','diner','meal takeaway','sandwich shop','food court','deli','steak house','pizza restaurant','seafood restaurant','breakfast restaurant','hamburger restaurant','mexican restaurant','italian restaurant','sushi restaurant','barbecue restaurant','fine dining restaurant','fast food restaurant','american restaurant','thai restaurant','chinese restaurant','indian restaurant','french restaurant','vegetarian restaurant','ramen restaurant','food','meal delivery','buffet restaurant','brunch restaurant']) AS bite_sub,
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['cafe','coffee shop','tea house']) AS cafe_sub,
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['bakery','ice cream shop','dessert shop','chocolate shop','donut shop','candy store','juice shop']) AS bakery_sub,
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['park','hiking area','campground','beach','national park','state park','garden','botanical garden','nature preserve','marina','golf course','scenic spot','ski resort','swimming pool','dog park','wildlife refuge','wildlife park','picnic ground','farm','trailhead','summit hike','cross-country skiing','ice skating','skiing','national forest','lake','river','harbor','pier','off roading area','rv park','athletic field']) AS outside_sub,
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['museum','art gallery','tourist attraction','historical landmark','historical place','monument','performing arts theater','aquarium','planetarium','observation deck','cultural center','visitor center','art center','history museum','science museum','childrens museum','observatory','sculpture','opera house','concert hall']) AS see_sub,
    -- GO PLAY: clear entertainment sub_categories
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['bowling alley','movie theater','amusement center','video arcade','arcade','miniature golf course','amusement park','water park','go-kart track','go karting venue','escape room','trampoline park','laser tag','axe throwing','paintball','comedy club','karaoke','roller skating rink','ice skating rink','skating rink','adventure sports center','zip line park','disc golf course','indoor playground','family entertainment center']) AS goplay_sub,
    -- physical/generic bucket that can hold active-play OR fitness OR (for generic) outdoor rec
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['gym','sports activity location','local business','yoga studio','fitness center','sports club','sports complex','martial arts school','dance school','recreation center','event venue']) AS phys_bucket,
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['sports activity location','local business']) AS generic_bucket,
    -- ACTIVE-PLAY signal: name reads climbing/axe/escape/karting/etc. OR a climbing tag
    (ei.title ~* '(climb|escalade|boulder|rock gym|vertical endeavor|gravity vault|salt pump|trampoline|sky.?zone|urban air|\ybounce\y|\yaxe\y|throwing axe|laser (tag|quest)|go.?kart|karting|speedway|ninja|rage room|escape|paintball|trapeze|aerial|adventure park|arcade)'
     OR coalesce(ei.tags,'{}') && ARRAY['climbing','bouldering']) AS active_play,
    -- #1: brewery/distillery/winery by NAME (catches ones Google typed 'tourist attraction')
    (ei.title ~* '(brew|distiller|\bwinery\b|vineyard|cider house|meadery|taproom|tap room)') AS brew_name,
    -- true residue: fitness / services / errands / retail
    lower(coalesce(ei.sub_category,'')) = ANY(ARRAY['gym','sports school','fitness center','yoga studio','martial arts school','dance school','sports activity location','sports complex','sports club','stadium','arena','physical fitness program','spa','nail salon','hair salon','beauty salon','barber shop','massage','library','community center','church','synagogue','place of worship','lodging','hotel','motel','resort hotel','bank','atm','store','shopping mall','shopping center','clothing store','thrift store','home goods store','book store','grocery store','food store','supermarket','sporting goods store','pet store','liquor store','gift shop','jewelry store','furniture store','hardware store','department store','convenience store','gas station','car repair','car wash','storage','doctor','dentist','hospital','pharmacy','post office','school','university','government office','city hall','courthouse','laundry','veterinary care','real estate agency','insurance agency','local business','corporate office','association or organization']) AS residue_sub,
    coalesce(ei.tags,'{}') && ARRAY['food','dining'] AS food_tag,
    coalesce(ei.tags,'{}') && ARRAY['drinks','bar','brewery','nightlife'] AS drink_tag,
    coalesce(ei.tags,'{}') && ARRAY['coffee'] AS coffee_tag,
    coalesce(ei.tags,'{}') && ARRAY['outdoors','nature','parks','hiking','trail','scenic','water_activity','swimming','winter_activity','skiing','camping','adventure'] AS outside_tag,
    coalesce(ei.tags,'{}') && ARRAY['cultural','museum','theater'] AS see_tag
  FROM public.explore_items ei
  WHERE ei.relevance_tier >= 1 AND coalesce(ei.is_admin_suppressed,false) = false
),
prim AS (
  SELECT s.*,
    CASE
      WHEN kind='event' THEN 'whats_happening'
      -- GO PLAY: clear entertainment, or active-play in a physical/generic bucket (NOT stadium)
      WHEN goplay_sub OR (phys_bucket AND active_play) THEN 'go_play'
      -- Class 2 rescue: generic bucket + outdoor tags + not active-play -> Get Outside
      WHEN generic_bucket AND outside_tag THEN 'get_outside'
      -- ANTI-INVENTORY: true residue (fitness/services/errands) never maps
      WHEN residue_sub THEN NULL
      WHEN category IN ('Food & Drink','Nightlife') THEN
        CASE
          WHEN brew_name THEN 'grab_a_drink'              -- #1 fix
          WHEN drink_sub THEN 'grab_a_drink'
          WHEN bite_sub OR bakery_sub THEN 'get_a_bite'
          WHEN cafe_sub THEN 'get_a_bite'
          WHEN drink_tag AND NOT food_tag THEN 'grab_a_drink'
          WHEN food_tag THEN 'get_a_bite'
          WHEN category='Nightlife' OR drink_tag THEN 'grab_a_drink'
          ELSE 'get_a_bite'
        END
      WHEN brew_name THEN 'grab_a_drink'                  -- brewery outside the Food&Drink category
      WHEN drink_sub THEN 'grab_a_drink'
      WHEN bite_sub OR bakery_sub THEN 'get_a_bite'
      WHEN cafe_sub THEN 'get_a_bite'
      WHEN see_sub THEN 'see_something'
      WHEN outside_sub THEN
        CASE WHEN notab >= 4.3 AND see_tag THEN 'see_something' ELSE 'get_outside' END
      WHEN category='Arts & Culture' THEN 'see_something'
      WHEN category IN ('Outdoor','Winter Activities') THEN
        CASE WHEN notab >= 4.3 AND see_tag THEN 'see_something' ELSE 'get_outside' END
      WHEN category='Sports & Recreation' AND outside_tag THEN 'get_outside'
      WHEN food_tag THEN 'get_a_bite'
      WHEN drink_tag OR coffee_tag THEN 'grab_a_drink'
      WHEN outside_tag THEN 'get_outside'
      WHEN see_tag THEN 'see_something'
      ELSE NULL
    END AS primary_slug
  FROM sig s
),
mapped AS (
  SELECT id, primary_slug,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN primary_slug='grab_a_drink'  AND (food_tag OR bite_sub OR bakery_sub) THEN 'get_a_bite' END,
      CASE WHEN primary_slug='get_a_bite'    AND (drink_tag OR cafe_sub OR coffee_tag) THEN 'grab_a_drink' END,
      CASE WHEN primary_slug='get_outside'   AND (see_tag OR see_sub) THEN 'see_something' END,
      CASE WHEN primary_slug='see_something' AND (outside_tag OR outside_sub) THEN 'get_outside' END
    ], NULL) AS secondary_slugs
  FROM prim
  WHERE primary_slug IS NOT NULL
)
INSERT INTO public.item_intents (item_id, intent_id, is_primary, source)
SELECT m.id, i.id, true, 'base'
FROM mapped m JOIN public.intents i ON i.slug = m.primary_slug
UNION ALL
SELECT m.id, i.id, false, 'base'
FROM mapped m
CROSS JOIN LATERAL unnest(m.secondary_slugs) AS s(slug)
JOIN public.intents i ON i.slug = s.slug
ON CONFLICT (item_id, intent_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $FN$;

REVOKE ALL ON FUNCTION public.refresh_base_intent_mappings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_base_intent_mappings() TO service_role;

-- Backfill on deploy (idempotent — DELETEs source='base' then re-inserts).
SELECT public.refresh_base_intent_mappings();
