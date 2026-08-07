import fs from "fs";
import path from "path";
import { MAP_PIN_IMAGES, MAP_PIN_EMOJIS } from "../mapPinImages";

// Extract emoji values from mapEmoji.ts the same way the pin generator does, so
// this test fails if someone adds a new category emoji without regenerating pins
// (which would otherwise ship a place with no icon).
function extractTaxonomyEmojis(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/"([^"]*[^\x00-\x7F][^"]*)"/g)) {
    const s = m[1];
    if ([...s].length <= 8 && !/[a-zA-Z0-9 ]/.test(s)) out.add(s);
  }
  return [...out];
}

const mapEmojiSrc = fs.readFileSync(path.resolve(__dirname, "../mapEmoji.ts"), "utf8");
const taxonomyEmojis = extractTaxonomyEmojis(mapEmojiSrc);
const assetsDir = path.resolve(__dirname, "../../../assets/mappins");

describe("map pin images", () => {
  it("extracts a non-trivial set of taxonomy emojis", () => {
    expect(taxonomyEmojis.length).toBeGreaterThanOrEqual(30);
  });

  it("has a bundled pin for EVERY taxonomy emoji (no place can be iconless)", () => {
    const missing = taxonomyEmojis.filter((e) => !MAP_PIN_IMAGES[e]);
    expect(missing).toEqual([]);
  });

  it("includes the fallback pin (📍) so unknown emojis still render", () => {
    expect(MAP_PIN_IMAGES["📍"]).toBeDefined();
  });

  it("every pin key resolves to an asset file that exists on disk", () => {
    const files = new Set(fs.readdirSync(assetsDir).filter((f) => f.endsWith(".png")));
    // one asset per emoji key
    expect(files.size).toBe(MAP_PIN_EMOJIS.length);
    expect(files.size).toBeGreaterThanOrEqual(taxonomyEmojis.length);
  });

  it("every require() entry is defined (bundler resolved the asset)", () => {
    for (const emoji of MAP_PIN_EMOJIS) {
      expect(MAP_PIN_IMAGES[emoji]).toBeDefined();
    }
  });
});
