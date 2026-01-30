/**
 * Source Adapter Registry
 *
 * Central registry for all event source adapters.
 * Add new sources here to enable automatic normalization.
 *
 * To add a new source:
 * 1. Create a new file in this directory (e.g., predicthq.ts)
 * 2. Export a normalize function: normalizePredicthqEvent(raw: any): NormalizedEvent
 * 3. Register it in the ADAPTERS map below
 * 4. Create the corresponding ingest function
 */

import {
  normalizeTicketmasterEvent,
  type NormalizedEvent,
} from "./ticketmaster.ts";
import { normalizeEventbriteEvent } from "./eventbrite.ts";

export type { NormalizedEvent };

/**
 * Adapter function type
 * Takes raw JSON from source and returns normalized event
 */
export type NormalizeFunction = (raw: any) => NormalizedEvent;

/**
 * Registry of source adapters
 * Key = event_sources.type value
 */
export const ADAPTERS: Record<string, NormalizeFunction> = {
  api_ticketmaster: normalizeTicketmasterEvent,
  api_eventbrite: normalizeEventbriteEvent,
  // Add more adapters here:
  // api_predicthq: normalizePredicthqEvent,
};

/**
 * Get adapter for a source type
 */
export function getAdapter(sourceType: string): NormalizeFunction | null {
  return ADAPTERS[sourceType] || null;
}

/**
 * Check if we have an adapter for a source type
 */
export function hasAdapter(sourceType: string): boolean {
  return sourceType in ADAPTERS;
}

/**
 * Get all supported source types
 */
export function getSupportedSourceTypes(): string[] {
  return Object.keys(ADAPTERS);
}
