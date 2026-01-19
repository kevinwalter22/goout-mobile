-- Add test events near Potsdam, NY for local testing
-- Coordinates: 44.6697° N, -74.9810° W (23 Pierrepont Ave area)

INSERT INTO events (title, starts_at, venue_name, city, category, latitude, longitude)
VALUES
  -- Downtown Potsdam events
  (
    'Live Music at Maxfield''s',
    NOW() + INTERVAL '2 days',
    'Maxfield''s',
    'Potsdam',
    'music',
    44.6697,
    -74.9810
  ),
  (
    'Community Market Day',
    NOW() + INTERVAL '3 days',
    'Potsdam Village Green',
    'Potsdam',
    'market',
    44.6708,
    -74.9815
  ),
  (
    'Pickup Basketball',
    NOW() + INTERVAL '1 day',
    'SUNY Potsdam Recreation Center',
    'Potsdam',
    'sports',
    44.6695,
    -74.9805
  ),
  -- Campus area events
  (
    'Open Mic Night',
    NOW() + INTERVAL '4 days',
    'The Barrington Room',
    'Potsdam',
    'music',
    44.6689,
    -74.9823
  ),
  (
    'Farmers Market',
    NOW() + INTERVAL '5 days',
    'Park Street',
    'Potsdam',
    'market',
    44.6715,
    -74.9801
  ),
  -- Near your location (23 Pierrepont Ave)
  (
    'Neighborhood Cleanup',
    NOW() + INTERVAL '6 days',
    'Pierrepont Avenue',
    'Potsdam',
    'outdoors',
    44.6697,
    -74.9810
  ),
  (
    'Coffee Meetup',
    NOW() + INTERVAL '1 day',
    'Sergi''s Italian Pastries',
    'Potsdam',
    'food',
    44.6702,
    -74.9818
  )
ON CONFLICT DO NOTHING;
