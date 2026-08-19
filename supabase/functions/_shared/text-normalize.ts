// Text normalization for ingestion — decode HTML entities so raw source markup
// (e.g. "Hiss Golden Messenger Solo &#8211; NIGHT 1", "Terrance Simien &amp; ...")
// never reaches the DB or the display layer. Applied in normalize-raw-events on
// title/description before upsert. Pure JS (Deno-safe), no dependency.

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", ndash: "–", mdash: "—",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  copy: "©", reg: "®", trade: "™", deg: "°",
  eacute: "é", egrave: "è", agrave: "à",
};

/**
 * Decode numeric (&#8211; / &#x2019;) and common named (&amp; &hellip; &rsquo;)
 * HTML entities. Unknown entities are left untouched. Null/undefined pass through.
 */
export function decodeHtmlEntities<T extends string | null | undefined>(input: T): T {
  if (typeof input !== "string" || input.indexOf("&") === -1) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, code: string) => {
    if (code[0] === "#") {
      const isHex = code[1] === "x" || code[1] === "X";
      const cp = isHex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    const named = NAMED[code.toLowerCase()];
    return named !== undefined ? named : m;
  }) as T;
}
