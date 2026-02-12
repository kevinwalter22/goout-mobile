/**
 * Web Extractors — Deterministic Event Extraction Pipeline (W4-3)
 *
 * Extraction priority order (highest quality first):
 * 1. JSON-LD schema.org Event extraction
 * 2. ICS/iCal feed parsing
 * 3. RSS/Atom feed parsing
 * 4. HTML DOM extraction with site-specific selectors
 *
 * Rules:
 * - Extract from CACHED HTML only (never live browsing)
 * - Validate candidates: reject missing title, temporal signal, or source_url
 * - Store evidence (snippets) for each extracted field
 * - Calculate confidence scores based on extraction quality
 */

import type {
  EventCandidate,
  ExtractionEvidence,
  ParsingStrategy,
  CollectorTarget,
} from "./web-collector.ts";

// ============================================================================
// Main Extraction Orchestrator
// ============================================================================

/**
 * Extract event candidates from cached HTML using the target's parsing strategy.
 * Returns candidates with validation status and confidence scores.
 */
export async function extractCandidates(
  html: string,
  url: string,
  target: CollectorTarget,
): Promise<{ candidates: EventCandidate[]; errors: string[] }> {
  const candidates: EventCandidate[] = [];
  const errors: string[] = [];

  const strategy = target.parsing_strategy;

  try {
    // Detect content type for ICS/RSS
    const contentType = detectContentType(html, url);

    if (strategy === "jsonld" || strategy === "hybrid") {
      const jsonldCandidates = extractFromJsonLd(html, url);
      candidates.push(...jsonldCandidates);
    }

    if (strategy === "ics" || (strategy === "hybrid" && contentType === "ics")) {
      const icsCandidates = extractFromIcs(html, url);
      candidates.push(...icsCandidates);
    }

    if (strategy === "rss" || (strategy === "hybrid" && contentType === "rss")) {
      const rssCandidates = extractFromRss(html, url);
      candidates.push(...rssCandidates);
    }

    // HTML DOM extraction (always tried in hybrid mode if few candidates found)
    if (strategy === "html_dom" || (strategy === "hybrid" && candidates.length < 3)) {
      const domCandidates = extractFromDom(html, url, target.dom_selectors);
      candidates.push(...domCandidates);
    }

    // Validate all candidates
    const minTitleLen = (target.site_config as any)?.min_title_length ?? 3;
    for (const candidate of candidates) {
      validateCandidate(candidate, minTitleLen);
    }

    // Filter candidates by site_config ignore patterns
    const ignorePatterns: RegExp[] = ((target.site_config as any)?.ignore_patterns || [])
      .map((p: string) => { try { return new RegExp(p, "i"); } catch { return null; } })
      .filter(Boolean) as RegExp[];

    const filtered = ignorePatterns.length > 0
      ? candidates.filter((c) => !ignorePatterns.some((re) => re.test(c.title)))
      : candidates;

    // Deduplicate candidates by title + starts_at
    const uniqueCandidates = deduplicateCandidates(filtered);

    return { candidates: uniqueCandidates, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Extraction failed");
    return { candidates: [], errors };
  }
}

// ============================================================================
// Content Type Detection
// ============================================================================

function detectContentType(content: string, url: string): "html" | "ics" | "rss" {
  const urlLower = url.toLowerCase();

  // URL-based detection
  if (urlLower.endsWith(".ics") || urlLower.includes("/calendar.ics")) {
    return "ics";
  }
  if (urlLower.endsWith("/feed") || urlLower.endsWith(".rss") || urlLower.endsWith("/rss")) {
    return "rss";
  }

  // Content-based detection
  const trimmed = content.trim();

  if (trimmed.startsWith("BEGIN:VCALENDAR")) {
    return "ics";
  }

  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<rss") || trimmed.startsWith("<feed")) {
    if (trimmed.includes("<rss") || trimmed.includes("<feed") || trimmed.includes("<channel>")) {
      return "rss";
    }
  }

  return "html";
}

// ============================================================================
// JSON-LD Extraction (Highest Quality)
// ============================================================================

interface JsonLdEvent {
  "@type": string;
  name?: string;
  startDate?: string;
  endDate?: string;
  location?: JsonLdLocation | string;
  description?: string;
  image?: string | { url: string };
  url?: string;
  eventSchedule?: JsonLdSchedule | JsonLdSchedule[];
}

interface JsonLdLocation {
  "@type"?: string;
  name?: string;
  address?: string | { streetAddress?: string; addressLocality?: string };
  geo?: { latitude?: number; longitude?: number };
}

interface JsonLdSchedule {
  "@type"?: string;
  repeatFrequency?: string;
  byDay?: string | string[];
  startTime?: string;
  endTime?: string;
  scheduleTimezone?: string;
}

function extractFromJsonLd(html: string, sourceUrl: string): EventCandidate[] {
  const candidates: EventCandidate[] = [];

  // Find all JSON-LD script blocks
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonText = match[1].trim();
      const jsonData = JSON.parse(jsonText);

      // Handle both single objects and arrays
      const items = Array.isArray(jsonData) ? jsonData : [jsonData];

      for (const item of items) {
        // Check @graph for nested items
        if (item["@graph"]) {
          items.push(...item["@graph"]);
          continue;
        }

        // Only process Event types
        const itemType = item["@type"];
        if (!itemType) continue;

        const types = Array.isArray(itemType) ? itemType : [itemType];
        if (!types.some((t) => t === "Event" || t.includes("Event"))) continue;

        const candidate = parseJsonLdEvent(item as JsonLdEvent, sourceUrl, jsonText);
        if (candidate) {
          candidates.push(candidate);
        }
      }
    } catch (err) {
      // Invalid JSON-LD, skip silently
      continue;
    }
  }

  return candidates;
}

function parseJsonLdEvent(event: JsonLdEvent, sourceUrl: string, rawJson: string): EventCandidate | null {
  const evidence: ExtractionEvidence[] = [];
  let confidence = 70; // Base confidence for JSON-LD

  // Title (required)
  const title = event.name?.trim();
  if (!title) return null;

  evidence.push({
    field: "title",
    source: "jsonld",
    value: title,
    raw_snippet: rawJson.substring(0, 500),
  });

  // Start date
  let starts_at: string | undefined;
  if (event.startDate) {
    starts_at = normalizeDateTime(event.startDate);
    evidence.push({
      field: "starts_at",
      source: "jsonld",
      value: event.startDate,
    });
    confidence += 10;
  }

  // End date
  let ends_at: string | undefined;
  if (event.endDate) {
    ends_at = normalizeDateTime(event.endDate);
    evidence.push({
      field: "ends_at",
      source: "jsonld",
      value: event.endDate,
    });
  }

  // Recurrence (from eventSchedule)
  let recurrence_text: string | undefined;
  if (event.eventSchedule) {
    const schedules = Array.isArray(event.eventSchedule)
      ? event.eventSchedule
      : [event.eventSchedule];
    recurrence_text = formatScheduleText(schedules);
    if (recurrence_text) {
      evidence.push({
        field: "recurrence_text",
        source: "jsonld",
        value: recurrence_text,
      });
    }
  }

  // Location
  let location_name: string | undefined;
  let address: string | undefined;
  let lat: number | undefined;
  let lng: number | undefined;

  if (event.location) {
    if (typeof event.location === "string") {
      location_name = event.location;
    } else {
      location_name = event.location.name;
      if (event.location.address) {
        if (typeof event.location.address === "string") {
          address = event.location.address;
        } else {
          address = [
            event.location.address.streetAddress,
            event.location.address.addressLocality,
          ].filter(Boolean).join(", ");
        }
      }
      if (event.location.geo) {
        lat = event.location.geo.latitude;
        lng = event.location.geo.longitude;
      }
    }

    if (location_name || address) {
      evidence.push({
        field: "location",
        source: "jsonld",
        value: location_name || address || "",
      });
      confidence += 5;
    }
  }

  // Description
  let description_snippet: string | undefined;
  if (event.description) {
    description_snippet = event.description.substring(0, 500).trim();
    evidence.push({
      field: "description",
      source: "jsonld",
      value: description_snippet,
    });
  }

  // Image
  let image_url: string | undefined;
  if (event.image) {
    image_url = typeof event.image === "string" ? event.image : event.image.url;
    if (image_url) {
      evidence.push({
        field: "image_url",
        source: "jsonld",
        value: image_url,
      });
    }
  }

  // URL
  const eventUrl = event.url || sourceUrl;

  return {
    title,
    source_url: eventUrl,
    starts_at,
    ends_at,
    recurrence_text,
    location_name,
    address,
    lat,
    lng,
    description_snippet,
    image_url,
    evidence,
    extraction_strategy: "jsonld",
    confidence: Math.min(confidence, 95),
    validation_errors: [],
    is_valid: false, // Will be set by validateCandidate
  };
}

function formatScheduleText(schedules: JsonLdSchedule[]): string | undefined {
  const parts: string[] = [];

  for (const schedule of schedules) {
    const dayParts: string[] = [];

    if (schedule.repeatFrequency) {
      dayParts.push(schedule.repeatFrequency);
    }

    if (schedule.byDay) {
      const days = Array.isArray(schedule.byDay) ? schedule.byDay : [schedule.byDay];
      dayParts.push(days.join(", "));
    }

    if (schedule.startTime) {
      dayParts.push(`at ${schedule.startTime}`);
    }

    if (dayParts.length > 0) {
      parts.push(dayParts.join(" "));
    }
  }

  return parts.length > 0 ? parts.join("; ") : undefined;
}

// ============================================================================
// ICS/iCal Extraction
// ============================================================================

function extractFromIcs(content: string, sourceUrl: string): EventCandidate[] {
  const candidates: EventCandidate[] = [];

  // Simple ICS parser (handles VEVENT blocks)
  const veventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi;
  let match;

  while ((match = veventRegex.exec(content)) !== null) {
    const eventBlock = match[1];
    const candidate = parseIcsEvent(eventBlock, sourceUrl);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function parseIcsEvent(eventBlock: string, sourceUrl: string): EventCandidate | null {
  const evidence: ExtractionEvidence[] = [];
  let confidence = 75; // Base confidence for ICS

  // Parse ICS properties
  const props = parseIcsProperties(eventBlock);

  // Title (SUMMARY)
  const title = props.SUMMARY?.trim();
  if (!title) return null;

  evidence.push({
    field: "title",
    source: "ics",
    value: title,
    raw_snippet: eventBlock.substring(0, 300),
  });

  // Start date (DTSTART)
  let starts_at: string | undefined;
  if (props.DTSTART) {
    starts_at = parseIcsDateTime(props.DTSTART);
    evidence.push({
      field: "starts_at",
      source: "ics",
      value: props.DTSTART,
    });
    confidence += 10;
  }

  // End date (DTEND)
  let ends_at: string | undefined;
  if (props.DTEND) {
    ends_at = parseIcsDateTime(props.DTEND);
    evidence.push({
      field: "ends_at",
      source: "ics",
      value: props.DTEND,
    });
  }

  // Recurrence (RRULE)
  let recurrence_text: string | undefined;
  if (props.RRULE) {
    recurrence_text = formatRruleText(props.RRULE);
    evidence.push({
      field: "recurrence_text",
      source: "ics",
      value: props.RRULE,
    });
  }

  // Location (LOCATION)
  let location_name: string | undefined;
  if (props.LOCATION) {
    location_name = props.LOCATION;
    evidence.push({
      field: "location",
      source: "ics",
      value: location_name,
    });
    confidence += 5;
  }

  // Description (DESCRIPTION)
  let description_snippet: string | undefined;
  if (props.DESCRIPTION) {
    description_snippet = props.DESCRIPTION.substring(0, 500).trim();
    evidence.push({
      field: "description",
      source: "ics",
      value: description_snippet,
    });
  }

  // URL
  const eventUrl = props.URL || sourceUrl;

  return {
    title,
    source_url: eventUrl,
    starts_at,
    ends_at,
    recurrence_text,
    location_name,
    description_snippet,
    evidence,
    extraction_strategy: "ics",
    confidence: Math.min(confidence, 90),
    validation_errors: [],
    is_valid: false,
  };
}

function parseIcsProperties(block: string): Record<string, string> {
  const props: Record<string, string> = {};
  const lines = block.split(/\r?\n/);

  let currentKey = "";
  let currentValue = "";

  for (const line of lines) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      // Continuation of previous line
      currentValue += line.substring(1);
    } else {
      // Save previous property
      if (currentKey) {
        props[currentKey] = currentValue
          .replace(/\\n/g, "\n")
          .replace(/\\,/g, ",")
          .replace(/\\;/g, ";");
      }

      // Parse new property
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const keyPart = line.substring(0, colonIndex);
        // Handle parameters (e.g., DTSTART;VALUE=DATE:20240101)
        const key = keyPart.split(";")[0].toUpperCase();
        currentKey = key;
        currentValue = line.substring(colonIndex + 1);
      } else {
        currentKey = "";
        currentValue = "";
      }
    }
  }

  // Save last property
  if (currentKey) {
    props[currentKey] = currentValue
      .replace(/\\n/g, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";");
  }

  return props;
}

function parseIcsDateTime(value: string): string | undefined {
  // Handle various ICS date formats
  // 20240115T190000Z (UTC)
  // 20240115T190000 (local)
  // 20240115 (date only)

  const cleanValue = value.replace(/[^0-9TZ]/g, "");

  if (cleanValue.length >= 8) {
    const year = cleanValue.substring(0, 4);
    const month = cleanValue.substring(4, 6);
    const day = cleanValue.substring(6, 8);

    let time = "00:00:00";
    if (cleanValue.length >= 15) {
      const hour = cleanValue.substring(9, 11);
      const minute = cleanValue.substring(11, 13);
      const second = cleanValue.substring(13, 15);
      time = `${hour}:${minute}:${second}`;
    }

    const isUtc = cleanValue.endsWith("Z");
    return `${year}-${month}-${day}T${time}${isUtc ? "Z" : ""}`;
  }

  return undefined;
}

function formatRruleText(rrule: string): string {
  // Simple RRULE to human-readable
  const parts = rrule.split(";");
  const ruleMap: Record<string, string> = {};

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key && value) {
      ruleMap[key.toUpperCase()] = value;
    }
  }

  const freq = ruleMap.FREQ || "";
  const byday = ruleMap.BYDAY || "";
  const interval = ruleMap.INTERVAL || "1";

  const freqMap: Record<string, string> = {
    DAILY: "Daily",
    WEEKLY: "Weekly",
    MONTHLY: "Monthly",
    YEARLY: "Yearly",
  };

  let text = freqMap[freq] || freq;

  if (interval !== "1") {
    text = `Every ${interval} ${text.toLowerCase()}s`;
  }

  if (byday) {
    const dayMap: Record<string, string> = {
      MO: "Monday",
      TU: "Tuesday",
      WE: "Wednesday",
      TH: "Thursday",
      FR: "Friday",
      SA: "Saturday",
      SU: "Sunday",
    };
    const days = byday.split(",").map((d) => dayMap[d] || d).join(", ");
    text += ` on ${days}`;
  }

  return text;
}

// ============================================================================
// RSS/Atom Extraction
// ============================================================================

function extractFromRss(content: string, sourceUrl: string): EventCandidate[] {
  const candidates: EventCandidate[] = [];

  // Simple RSS/Atom parser using regex (no external deps)
  const itemRegex = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = itemRegex.exec(content)) !== null) {
    const itemBlock = match[1] || match[2];
    const candidate = parseRssItem(itemBlock, sourceUrl);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function parseRssItem(itemBlock: string, sourceUrl: string): EventCandidate | null {
  const evidence: ExtractionEvidence[] = [];
  let confidence = 50; // Lower base confidence for RSS (less structured)

  // Title
  const titleMatch = itemBlock.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
  const title = titleMatch?.[1]?.trim();
  if (!title) return null;

  evidence.push({
    field: "title",
    source: "rss",
    value: title,
    raw_snippet: itemBlock.substring(0, 300),
  });

  // Link
  const linkMatch = itemBlock.match(/<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i) ||
    itemBlock.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  const eventUrl = linkMatch?.[1]?.trim() || sourceUrl;

  evidence.push({
    field: "source_url",
    source: "rss",
    value: eventUrl,
  });

  // Publication date (pubDate or published)
  const dateMatch = itemBlock.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i) ||
    itemBlock.match(/<published[^>]*>(.*?)<\/published>/i) ||
    itemBlock.match(/<dc:date[^>]*>(.*?)<\/dc:date>/i);

  let starts_at: string | undefined;
  if (dateMatch?.[1]) {
    starts_at = normalizeDateTime(dateMatch[1]);
    if (starts_at) {
      evidence.push({
        field: "starts_at",
        source: "rss",
        value: dateMatch[1],
      });
      confidence += 10;
    }
  }

  // Description
  const descMatch = itemBlock.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) ||
    itemBlock.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i) ||
    itemBlock.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i);

  let description_snippet: string | undefined;
  if (descMatch?.[1]) {
    // Strip HTML tags from description
    description_snippet = descMatch[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 500);

    evidence.push({
      field: "description",
      source: "rss",
      value: description_snippet,
    });
  }

  // Try to extract date/time from description if not found
  if (!starts_at && description_snippet) {
    const extractedDate = extractDateFromText(description_snippet);
    if (extractedDate) {
      starts_at = extractedDate;
      evidence.push({
        field: "starts_at",
        source: "rss",
        value: `Extracted from description: ${extractedDate}`,
      });
    }
  }

  return {
    title,
    source_url: eventUrl,
    starts_at,
    description_snippet,
    evidence,
    extraction_strategy: "rss",
    confidence: Math.min(confidence, 70),
    validation_errors: [],
    is_valid: false,
  };
}

// ============================================================================
// HTML DOM Extraction (Site-Specific)
// ============================================================================

function extractFromDom(
  html: string,
  sourceUrl: string,
  selectors: Record<string, string>,
): EventCandidate[] {
  const candidates: EventCandidate[] = [];

  // If no selectors provided, try common patterns
  const effectiveSelectors = Object.keys(selectors).length > 0
    ? selectors
    : getDefaultSelectors();

  // Find event containers
  const containerSelector = effectiveSelectors.event_container || ".event";
  const containers = findElementsBySelector(html, containerSelector);

  for (const container of containers) {
    const candidate = parseDomEvent(container, sourceUrl, effectiveSelectors);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function getDefaultSelectors(): Record<string, string> {
  return {
    event_container: ".event, .event-item, [itemtype*='Event'], article.event",
    title: ".event-title, .title, h2, h3, [itemprop='name']",
    date: ".event-date, .date, time, [itemprop='startDate'], [datetime]",
    location: ".event-location, .location, .venue, [itemprop='location']",
    description: ".event-description, .description, .summary, [itemprop='description']",
    link: "a.event-link, a.more-link, a[href*='event']",
    image: "img.event-image, img[itemprop='image'], .event-thumbnail img",
  };
}

function findElementsBySelector(html: string, selector: string): string[] {
  // Simple regex-based element finder (no DOM parser in Deno)
  // Handles common patterns like .class, #id, tag.class

  const elements: string[] = [];
  const selectors = selector.split(",").map((s) => s.trim());

  for (const sel of selectors) {
    // Handle class selector: .event-item
    if (sel.startsWith(".")) {
      const className = sel.substring(1).replace(/[^a-zA-Z0-9_-]/g, "");
      const regex = new RegExp(
        `<[a-z][a-z0-9]*[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[a-z][a-z0-9]*>`,
        "gi",
      );
      let match;
      while ((match = regex.exec(html)) !== null) {
        elements.push(match[0]);
      }
    }

    // Handle itemtype attribute: [itemtype*='Event']
    if (sel.includes("itemtype")) {
      const regex = /<[a-z][a-z0-9]*[^>]*itemtype=["'][^"']*Event[^"']*["'][^>]*>([\s\S]*?)<\/[a-z][a-z0-9]*>/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        elements.push(match[0]);
      }
    }

    // Handle tag.class: article.event
    const tagClassMatch = sel.match(/^([a-z]+)\.([a-zA-Z0-9_-]+)$/);
    if (tagClassMatch) {
      const [, tag, className] = tagClassMatch;
      const regex = new RegExp(
        `<${tag}[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`,
        "gi",
      );
      let match;
      while ((match = regex.exec(html)) !== null) {
        elements.push(match[0]);
      }
    }
  }

  return elements;
}

function parseDomEvent(
  containerHtml: string,
  sourceUrl: string,
  selectors: Record<string, string>,
): EventCandidate | null {
  const evidence: ExtractionEvidence[] = [];
  let confidence = 40; // Lower base confidence for DOM extraction

  // Extract title
  const title = extractTextBySelector(containerHtml, selectors.title);
  if (!title) return null;

  evidence.push({
    field: "title",
    source: "dom",
    value: title,
    selector: selectors.title,
    raw_snippet: containerHtml.substring(0, 200),
  });

  // Extract date
  let starts_at: string | undefined;
  const dateText = extractTextBySelector(containerHtml, selectors.date);
  if (dateText) {
    starts_at = normalizeDateTime(dateText);
    if (starts_at) {
      evidence.push({
        field: "starts_at",
        source: "dom",
        value: dateText,
        selector: selectors.date,
      });
      confidence += 15;
    }
  }

  // Also check for datetime attribute
  const datetimeMatch = containerHtml.match(/datetime=["']([^"']+)["']/i);
  if (!starts_at && datetimeMatch?.[1]) {
    starts_at = normalizeDateTime(datetimeMatch[1]);
    if (starts_at) {
      evidence.push({
        field: "starts_at",
        source: "dom",
        value: datetimeMatch[1],
        selector: "[datetime]",
      });
      confidence += 15;
    }
  }

  // Extract location
  const location_name = extractTextBySelector(containerHtml, selectors.location);
  if (location_name) {
    evidence.push({
      field: "location",
      source: "dom",
      value: location_name,
      selector: selectors.location,
    });
    confidence += 5;
  }

  // Extract description
  const description_snippet = extractTextBySelector(containerHtml, selectors.description)
    ?.substring(0, 500);
  if (description_snippet) {
    evidence.push({
      field: "description",
      source: "dom",
      value: description_snippet,
      selector: selectors.description,
    });
  }

  // Extract link
  let eventUrl = sourceUrl;
  const linkMatch = containerHtml.match(/<a[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (linkMatch?.[1]) {
    eventUrl = resolveUrl(linkMatch[1], sourceUrl);
    evidence.push({
      field: "source_url",
      source: "dom",
      value: eventUrl,
    });
  }

  // Extract image
  let image_url: string | undefined;
  const imgMatch = containerHtml.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
  if (imgMatch?.[1]) {
    image_url = resolveUrl(imgMatch[1], sourceUrl);
    evidence.push({
      field: "image_url",
      source: "dom",
      value: image_url,
    });
  }

  // Try to extract recurrence from text
  let recurrence_text: string | undefined;
  const textContent = containerHtml.replace(/<[^>]+>/g, " ");
  const recurrenceMatch = textContent.match(
    /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|day)/i,
  );
  if (recurrenceMatch) {
    recurrence_text = recurrenceMatch[0];
    evidence.push({
      field: "recurrence_text",
      source: "dom",
      value: recurrence_text,
    });
  }

  return {
    title,
    source_url: eventUrl,
    starts_at,
    recurrence_text,
    location_name,
    description_snippet,
    image_url,
    evidence,
    extraction_strategy: "html_dom",
    confidence: Math.min(confidence, 70),
    validation_errors: [],
    is_valid: false,
  };
}

function extractTextBySelector(html: string, selector: string | undefined): string | undefined {
  if (!selector) return undefined;

  const selectors = selector.split(",").map((s) => s.trim());

  for (const sel of selectors) {
    let regex: RegExp | null = null;

    // Handle class selector
    if (sel.startsWith(".")) {
      const className = sel.substring(1).replace(/[^a-zA-Z0-9_-]/g, "");
      regex = new RegExp(
        `<[a-z][a-z0-9]*[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[a-z][a-z0-9]*>`,
        "i",
      );
    }

    // Handle tag selector
    if (/^[a-z]+[0-9]?$/i.test(sel)) {
      regex = new RegExp(`<${sel}[^>]*>([\\s\\S]*?)<\\/${sel}>`, "i");
    }

    // Handle itemprop selector
    if (sel.includes("itemprop")) {
      const propMatch = sel.match(/\[itemprop=['"]?([^'"\]]+)['"]?\]/);
      if (propMatch) {
        regex = new RegExp(
          `<[a-z][a-z0-9]*[^>]*itemprop=["']${propMatch[1]}["'][^>]*>([\\s\\S]*?)<\\/[a-z][a-z0-9]*>`,
          "i",
        );
      }
    }

    if (regex) {
      const match = html.match(regex);
      if (match?.[1]) {
        // Strip inner HTML tags and clean up
        return match[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }

  return undefined;
}

// ============================================================================
// Utilities
// ============================================================================

function normalizeDateTime(value: string): string | undefined {
  // Try to parse various date formats
  const cleaned = value.trim();

  // ISO 8601 format
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(cleaned)) {
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // RFC 2822 format (common in RSS)
  const rfc2822 = new Date(cleaned);
  if (!isNaN(rfc2822.getTime())) {
    return rfc2822.toISOString();
  }

  // Try extracting date components
  const extracted = extractDateFromText(cleaned);
  if (extracted) {
    return extracted;
  }

  return undefined;
}

function extractDateFromText(text: string): string | undefined {
  // Common date patterns

  // "January 15, 2024" or "Jan 15, 2024"
  const pattern1 = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i,
  );
  if (pattern1) {
    const date = new Date(`${pattern1[1]} ${pattern1[2]}, ${pattern1[3]}`);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // "15 January 2024" or "15 Jan 2024"
  const pattern2 = text.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i,
  );
  if (pattern2) {
    const date = new Date(`${pattern2[2]} ${pattern2[1]}, ${pattern2[3]}`);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // "01/15/2024" or "1/15/24"
  const pattern3 = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (pattern3) {
    const year = pattern3[3].length === 2 ? `20${pattern3[3]}` : pattern3[3];
    const date = new Date(`${year}-${pattern3[1].padStart(2, "0")}-${pattern3[2].padStart(2, "0")}`);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // "2024-01-15"
  const pattern4 = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (pattern4) {
    const date = new Date(`${pattern4[1]}-${pattern4[2]}-${pattern4[3]}`);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return undefined;
}

function resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

// ============================================================================
// Garbage Title Patterns — reject obviously invalid candidates
// ============================================================================

const GARBAGE_PATTERNS: RegExp[] = [
  /^(home|menu|about|contact|login|sign up|search|navigation)/i,
  /^(click here|read more|learn more|see all|view all)/i,
  /^(cookie|privacy|terms|copyright)/i,
  /^.{0,2}$/,       // too short (0-2 chars)
  /^.{200,}$/,      // too long (likely a paragraph, not a title)
  /^[A-Z\s]{20,}$/, // all-caps spam
];

function isGarbageTitle(title: string): boolean {
  return GARBAGE_PATTERNS.some((pattern) => pattern.test(title.trim()));
}

// ============================================================================
// Validation
// ============================================================================

function validateCandidate(candidate: EventCandidate, minTitleLength = 3): void {
  candidate.validation_errors = [];

  // Reject garbage titles outright
  if (candidate.title && isGarbageTitle(candidate.title)) {
    candidate.validation_errors.push("Title matches garbage pattern");
    candidate.is_valid = false;
    candidate.confidence = 0;
    return;
  }

  // Required: title
  if (!candidate.title || candidate.title.length < minTitleLength) {
    candidate.validation_errors.push("Missing or too short title");
  }

  // Required: source_url
  if (!candidate.source_url) {
    candidate.validation_errors.push("Missing source_url");
  }

  // Required: temporal signal (starts_at OR recurrence_text)
  if (!candidate.starts_at && !candidate.recurrence_text) {
    candidate.validation_errors.push("Missing temporal signal (starts_at or recurrence_text)");
  }

  // Validate date is not in the distant past
  if (candidate.starts_at) {
    const startDate = new Date(candidate.starts_at);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    if (startDate < sixMonthsAgo) {
      candidate.validation_errors.push("Event date is more than 6 months in the past");
    }
  }

  // Penalize confidence for missing fields
  if (!candidate.location_name) {
    candidate.confidence -= 5;
  }
  if (!candidate.description_snippet) {
    candidate.confidence -= 5;
  }

  // Set validity
  candidate.is_valid = candidate.validation_errors.length === 0;
  candidate.confidence = Math.max(0, Math.min(100, candidate.confidence));
}

// ============================================================================
// Deduplication
// ============================================================================

function deduplicateCandidates(candidates: EventCandidate[]): EventCandidate[] {
  const seen = new Map<string, EventCandidate>();

  for (const candidate of candidates) {
    // Create dedup key from normalized title + date (if available)
    const normalizedTitle = candidate.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    const dateKey = candidate.starts_at
      ? new Date(candidate.starts_at).toISOString().split("T")[0]
      : "nodate";
    const dedupKey = `${normalizedTitle}::${dateKey}`;

    const existing = seen.get(dedupKey);
    if (!existing || candidate.confidence > existing.confidence) {
      seen.set(dedupKey, candidate);
    }
  }

  return Array.from(seen.values());
}

// ============================================================================
// Review Status Computation (Phase B quality gate)
// ============================================================================

/**
 * Determine whether a web-collected candidate should be auto-approved or
 * quarantined for admin review.  Called by the web_collector adapter before
 * normalization upserts into explore_items.
 */
export function computeReviewStatus(
  candidate: { confidence: number; title?: string; starts_at?: string; recurrence_text?: string; location_name?: string; address?: string },
  kind: string,
): "auto_approved" | "quarantined" {
  // High-confidence with full data → auto-approve
  if (
    candidate.confidence >= 70 &&
    candidate.title &&
    candidate.starts_at &&
    (candidate.location_name || candidate.address)
  ) {
    return "auto_approved";
  }

  // Medium-confidence with temporal signal → auto-approve
  if (
    candidate.confidence >= 50 &&
    candidate.title &&
    (candidate.starts_at || candidate.recurrence_text)
  ) {
    return "auto_approved";
  }

  // Events without starts_at → quarantine
  if (kind === "event" && !candidate.starts_at) {
    return "quarantined";
  }

  // Low confidence → quarantine
  if (candidate.confidence < 50) {
    return "quarantined";
  }

  return "auto_approved";
}
