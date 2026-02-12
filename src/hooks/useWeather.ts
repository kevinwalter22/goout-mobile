/**
 * Weather Hook
 *
 * Fetches current weather using Open-Meteo API (free, no key required).
 * Caches results to minimize API calls.
 */

import { useState, useEffect, useRef } from "react";
import { RECOMMENDER_CONFIG } from "../config/recommenderConfig";

export interface WeatherData {
  isRaining: boolean;
  isSunny: boolean;
  temperature: number;
  cloudCover: number;
  precipitation: number;
  description: string;
}

const CACHE_DURATION_MS =
  RECOMMENDER_CONFIG.WEATHER.API_CACHE_MINUTES * 60 * 1000;

// In-memory cache shared across hook instances
const weatherCache: Map<
  string,
  { data: WeatherData; timestamp: number }
> = new Map();

export function useWeather(location?: { lat: number; lng: number } | null) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastLocation = useRef<string>("");

  useEffect(() => {
    if (!location) return;

    // Round location to 2 decimals for cache key (roughly 1km precision)
    const locationKey = `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`;
    const now = Date.now();

    // Check cache first
    const cached = weatherCache.get(locationKey);
    if (cached && now - cached.timestamp < CACHE_DURATION_MS) {
      if (locationKey !== lastLocation.current) {
        setWeather(cached.data);
        lastLocation.current = locationKey;
      }
      return;
    }

    async function fetchWeather() {
      setLoading(true);
      setError(null);

      try {
        // Open-Meteo API - free, no API key required
        // Use Fahrenheit since the app uses imperial units (miles)
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${location!.lat}&longitude=${location!.lng}&current=temperature_2m,precipitation,cloud_cover,weather_code&temperature_unit=fahrenheit`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Weather API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.current) {
          const weatherData: WeatherData = {
            isRaining: data.current.precipitation > 0,
            isSunny: data.current.cloud_cover < 30,
            temperature: data.current.temperature_2m,
            cloudCover: data.current.cloud_cover,
            precipitation: data.current.precipitation,
            description: getWeatherDescription(data.current.weather_code),
          };

          // Update cache
          weatherCache.set(locationKey, {
            data: weatherData,
            timestamp: Date.now(),
          });

          setWeather(weatherData);
          lastLocation.current = locationKey;
        }
      } catch (err) {
        console.log("[useWeather] Fetch failed:", err);
        setError(err instanceof Error ? err.message : "Weather fetch failed");
      } finally {
        setLoading(false);
      }
    }

    fetchWeather();
  }, [location?.lat, location?.lng]);

  return { weather, loading, error };
}

/**
 * Convert WMO weather code to human-readable description
 * https://open-meteo.com/en/docs
 */
function getWeatherDescription(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code >= 45 && code <= 48) return "Foggy";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 56 && code <= 57) return "Freezing drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 66 && code <= 67) return "Freezing rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code >= 96 && code <= 99) return "Thunderstorm with hail";
  return "Unknown";
}

/**
 * Clear the weather cache (useful for testing)
 */
export function clearWeatherCache(): void {
  weatherCache.clear();
}
