-- Add more events very close to 23 Pierrepont Ave, Potsdam NY
-- Base coordinates: 44.6697° N, -74.9810° W
-- Adding events within 100 meters for easier testing

INSERT INTO events (title, starts_at, venue_name, city, category, latitude, longitude)
VALUES
  -- Right at your location
  (
    'House Party',
    NOW() + INTERVAL '1 day',
    '23 Pierrepont Ave',
    'Potsdam',
    'social',
    44.6697,
    -74.9810
  ),
  -- 50 meters north
  (
    'Street Hockey',
    NOW() + INTERVAL '2 days',
    'Pierrepont Avenue',
    'Potsdam',
    'sports',
    44.6701,
    -74.9810
  ),
  -- 50 meters south
  (
    'Yard Sale',
    NOW() + INTERVAL '3 days',
    'Pierrepont Avenue',
    'Potsdam',
    'market',
    44.6693,
    -74.9810
  ),
  -- 75 meters east
  (
    'Block Party',
    NOW() + INTERVAL '1 day',
    'Near Pierrepont',
    'Potsdam',
    'social',
    44.6697,
    -74.9800
  ),
  -- 75 meters west
  (
    'Community Gathering',
    NOW() + INTERVAL '2 days',
    'Pierrepont Area',
    'Potsdam',
    'social',
    44.6697,
    -74.9820
  ),
  -- Corner location (100m northeast)
  (
    'Coffee Popup',
    NOW() + INTERVAL '4 days',
    'Pierrepont Corner',
    'Potsdam',
    'food',
    44.6702,
    -74.9805
  )
ON CONFLICT DO NOTHING;
