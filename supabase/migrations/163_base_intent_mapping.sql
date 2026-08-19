-- 163_base_intent_mapping.sql
--
-- The base intent mapping as a re-runnable FUNCTION (was a staging-direct script).
-- Catalog-agnostic: maps items by their attributes (kind/category/sub_category/title/
-- tags/notability), so it re-runs on prod's own catalog to produce prod's item_intents
-- — not a copy of staging's rows. Carries Bug 1/2 + RC1 (event-nature routing) + RC2
-- (café split) + the optional type-correction override (empty => generic rules apply).
--
-- Idempotent: DELETE source='base' then re-INSERT. Backfilled at the end.

create or replace function public.refresh_base_intent_mappings()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_n integer;
begin
  delete from public.item_intents where source = 'base';

  with sig as (
    select ei.id, ei.kind, ei.category, ei.title,
      lower(coalesce(ei.sub_category,'')) as sc,
      coalesce(ei.notability_score,0) as notab,
      lower(coalesce(ei.sub_category,'')) = any(array['bar','pub','brewery','night club','wine bar','distillery','winery','cocktail bar','taproom','sports bar','beer garden','irish pub','gastropub']) as drink_sub,
      lower(coalesce(ei.sub_category,'')) = any(array['restaurant','diner','meal takeaway','sandwich shop','food court','deli','steak house','pizza restaurant','seafood restaurant','breakfast restaurant','hamburger restaurant','mexican restaurant','italian restaurant','sushi restaurant','barbecue restaurant','fine dining restaurant','fast food restaurant','american restaurant','thai restaurant','chinese restaurant','indian restaurant','french restaurant','vegetarian restaurant','ramen restaurant','food','meal delivery','buffet restaurant','brunch restaurant']) as bite_sub,
      lower(coalesce(ei.sub_category,'')) = any(array['cafe','coffee shop','tea house']) as cafe_sub,
      lower(coalesce(ei.sub_category,'')) = any(array['bakery','ice cream shop','dessert shop','chocolate shop','donut shop','candy store','juice shop']) as bakery_sub,
      lower(coalesce(ei.sub_category,'')) = any(array['park','hiking area','campground','beach','national park','state park','garden','botanical garden','nature preserve','marina','golf course','scenic spot','ski resort','swimming pool','dog park','wildlife refuge','wildlife park','picnic ground','farm','trailhead','summit hike','cross-country skiing','ice skating','skiing','national forest','lake','river','harbor','pier','off roading area','rv park','athletic field']) as outside_sub,
      lower(coalesce(ei.sub_category,'')) = any(array['museum','art gallery','tourist attraction','historical landmark','historical place','monument','performing arts theater','aquarium','planetarium','observation deck','cultural center','visitor center','art center','history museum','science museum','childrens museum','observatory','sculpture','opera house','concert hall']) as see_sub,
      lower(coalesce(ei.sub_category,'')) = any(array['bowling alley','movie theater','amusement center','video arcade','arcade','miniature golf course','amusement park','water park','go-kart track','go karting venue','escape room','trampoline park','laser tag','axe throwing','paintball','comedy club','karaoke','roller skating rink','ice skating rink','skating rink','adventure sports center','zip line park','disc golf course','indoor playground','family entertainment center']) as goplay_sub,
      lower(coalesce(ei.sub_category,'')) = any(array['gym','sports activity location','local business','yoga studio','fitness center','sports club','sports complex','martial arts school','dance school','recreation center','event venue']) as phys_bucket,
      lower(coalesce(ei.sub_category,'')) = any(array['sports activity location','local business']) as generic_bucket,
      (ei.title ~* '(climb|escalade|boulder|rock gym|vertical endeavor|gravity vault|salt pump|trampoline|sky.?zone|urban air|\ybounce\y|\yaxe\y|throwing axe|laser (tag|quest)|go.?kart|karting|speedway|ninja|rage room|escape|paintball|trapeze|aerial|adventure park|arcade)'
       or coalesce(ei.tags,'{}') && array['climbing','bouldering']) as active_play,
      (ei.title ~* '(brew|distiller|\bwinery\b|vineyard|cider house|meadery|taproom|tap room)') as brew_name,
      lower(coalesce(ei.sub_category,'')) = any(array['gym','sports school','fitness center','yoga studio','martial arts school','dance school','sports activity location','sports complex','sports club','stadium','arena','physical fitness program','spa','nail salon','hair salon','beauty salon','barber shop','massage','library','community center','church','synagogue','place of worship','lodging','hotel','motel','resort hotel','bank','atm','store','shopping mall','shopping center','clothing store','thrift store','home goods store','book store','grocery store','food store','supermarket','sporting goods store','pet store','liquor store','gift shop','jewelry store','furniture store','hardware store','department store','convenience store','gas station','car repair','car wash','storage','doctor','dentist','hospital','pharmacy','post office','school','university','government office','city hall','courthouse','laundry','veterinary care','real estate agency','insurance agency','local business','corporate office','association or organization']) as residue_sub,
      coalesce(ei.tags,'{}') && array['food','dining'] as food_tag,
      coalesce(ei.tags,'{}') && array['drinks','bar','brewery','nightlife'] as drink_tag,
      coalesce(ei.tags,'{}') && array['coffee'] as coffee_tag,
      coalesce(ei.tags,'{}') && array['outdoors','nature','parks','hiking','trail','scenic','water_activity','swimming','winter_activity','skiing','camping','adventure'] as outside_tag,
      coalesce(ei.tags,'{}') && array['cultural','museum','theater'] as see_tag,
      coalesce(ei.tags,'{}') && array['bar'] as bar_tag,
      coalesce(ei.tags,'{}') && array['drinks'] as drinks_tag,
      coalesce(ei.tags,'{}') && array['nightlife'] as nightlife_tag,
      (ei.title ~* '(cocktail|\ypub\y|public house|tavern|saloon|speakeasy|ale house|beer hall|biergarten|brewpub|wine bar|beer garden|taproom)') as drink_venue_name,
      (ei.category = 'Nightlife') as nightlife_cat,
      (lower(coalesce(ei.sub_category,'')) = any(array['golf course','bowling alley','live music venue'])
       or ei.title ~* '(mini ?golf|puttery|music hall|comedy)') as elsewhere_playsee,
      ei.starts_at,
      (
        lower(coalesce(ei.sub_category,'')) = any(array['farmers market','flea market','public market','market day'])
        or ei.title ~* '(farmers.?market|flea.?market|flea.?for.?all|public market|night market|holiday market|makers?.?market)'
        or ei.title ~* '(festival|\yfair\y|\yfest\y|fairgrounds|craft fair|art walk|\yexpo\y)'
        or lower(coalesce(ei.sub_category,'')) = any(array['live music venue','event venue','concert hall','amphitheater','performing arts theater'])
        or ei.title ~* '(music hall|house of music|amphitheat|bandshell|events? center|playhouse|opera house)'
      ) as is_event_nature,
      (ei.title ~* '^(state theatre|biddeford city theater)') as is_landmark_venue,
      (ei.title ~* '(coffee|espresso|roaster)' or lower(coalesce(ei.sub_category,'')) = any(array['coffee shop','tea house'])) as coffee_first,
      tc.model_intent as corrected_intent
    from public.explore_items ei
    left join public.type_corrections tc on tc.item_id = ei.id and tc.applied
    where ei.relevance_tier >= 1 and coalesce(ei.is_admin_suppressed,false) = false
  ),
  prim as (
    select s.*,
      case
        when corrected_intent is not null then nullif(corrected_intent,'residue')
        when kind='event' and starts_at is not null then 'whats_happening'
        when kind='event' then null
        when title ~* '^hot suppa' then 'get_a_bite'
        when title ~* '^ocotillo'  then 'grab_a_drink'
        when title ~* '(adaptive outdoor education|logrea dance)' then null
        when is_landmark_venue then 'see_something'
        when is_event_nature and starts_at is not null then 'whats_happening'
        when is_event_nature then null
        when goplay_sub or (phys_bucket and active_play) then 'go_play'
        when generic_bucket and outside_tag then 'get_outside'
        when residue_sub then null
        when (drink_venue_name or nightlife_cat) and not elsewhere_playsee then 'grab_a_drink'
        when category in ('Food & Drink','Nightlife') then
          case
            when brew_name then 'grab_a_drink'
            when drink_sub then 'grab_a_drink'
            when coffee_first then 'grab_a_drink'
            when bite_sub or bakery_sub then 'get_a_bite'
            when cafe_sub then 'get_a_bite'
            when drink_tag and not food_tag then 'grab_a_drink'
            when food_tag then 'get_a_bite'
            when category='Nightlife' or drink_tag then 'grab_a_drink'
            else 'get_a_bite'
          end
        when brew_name then 'grab_a_drink'
        when drink_sub then 'grab_a_drink'
        when coffee_first then 'grab_a_drink'
        when bite_sub or bakery_sub then 'get_a_bite'
        when cafe_sub then 'get_a_bite'
        when see_sub then 'see_something'
        when outside_sub then case when notab >= 4.3 and see_tag then 'see_something' else 'get_outside' end
        when category='Arts & Culture' then 'see_something'
        when category in ('Outdoor','Winter Activities') then case when notab >= 4.3 and see_tag then 'see_something' else 'get_outside' end
        when category='Sports & Recreation' and outside_tag then 'get_outside'
        when food_tag then 'get_a_bite'
        when drink_tag or coffee_tag then 'grab_a_drink'
        when outside_tag then 'get_outside'
        when see_tag then 'see_something'
        else null
      end as primary_slug
    from sig s
  ),
  mapped as (
    select id, primary_slug,
      array_remove(array[
        case when primary_slug='grab_a_drink'  and (food_tag or bite_sub or bakery_sub) then 'get_a_bite' end,
        case when primary_slug='get_a_bite'    and (drink_tag or cafe_sub or coffee_tag) then 'grab_a_drink' end,
        case when primary_slug='get_outside'   and (see_tag or see_sub) then 'see_something' end,
        case when primary_slug='see_something' and (outside_tag or outside_sub) then 'get_outside' end
      ], null) as secondary_slugs
    from prim
    where primary_slug is not null
  )
  insert into public.item_intents (item_id, intent_id, is_primary, source)
  select m.id, i.id, true, 'base'
  from mapped m join public.intents i on i.slug = m.primary_slug
  union all
  select m.id, i.id, false, 'base'
  from mapped m
  cross join lateral unnest(m.secondary_slugs) as s(slug)
  join public.intents i on i.slug = s.slug
  on conflict (item_id, intent_id) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- Backfill on deploy (catalog-agnostic; safe on prod's own catalog).
select public.refresh_base_intent_mappings();
