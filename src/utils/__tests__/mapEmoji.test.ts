import { emojiForItem, tintForItem } from "../mapEmoji";

type P = Parameters<typeof emojiForItem>[0];
const item = (over: Partial<P>): P => ({ category: null, sub_category: null, kind: "activity", ...over });

describe("emojiForItem", () => {
  it("uses sub_category when mapped", () => {
    expect(emojiForItem(item({ sub_category: "brewery" }))).toBe("🍺");
    expect(emojiForItem(item({ sub_category: "bar" }))).toBe("🍸");
    expect(emojiForItem(item({ sub_category: "art gallery" }))).toBe("🖼️");
    expect(emojiForItem(item({ sub_category: "hiking area" }))).toBe("🥾");
  });

  it("normalizes underscores/case in sub_category", () => {
    expect(emojiForItem(item({ sub_category: "Movie_Theater" }))).toBe("🎬");
    expect(emojiForItem(item({ sub_category: "NIGHT CLUB" }))).toBe("🪩");
  });

  it("falls back to category when sub_category is unmapped (e.g. 'jsonld')", () => {
    expect(emojiForItem(item({ sub_category: "jsonld", category: "Food & Drink" }))).toBe("🍽️");
    expect(emojiForItem(item({ sub_category: null, category: "Arts & Culture" }))).toBe("🎭");
  });

  it("matches category partially across source spellings", () => {
    expect(emojiForItem(item({ category: "live_music" }))).toBe("🎵");
  });

  it("falls back to kind when nothing maps", () => {
    expect(emojiForItem(item({ kind: "event", category: "??" }))).toBe("📅");
    expect(emojiForItem(item({ kind: "activity", category: null }))).toBe("📍");
  });
});

describe("tintForItem", () => {
  it("tints events and activities differently", () => {
    expect(tintForItem({ kind: "event" })).not.toBe(tintForItem({ kind: "activity" }));
  });
});
