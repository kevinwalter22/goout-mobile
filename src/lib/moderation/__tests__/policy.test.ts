import { classify, getAction } from "../policy";
import type { ContentContext } from "../policy";

describe("moderation policy", () => {
  // ── Clean content ───────────────────────────────────────
  describe("clean content", () => {
    it.each([
      "Great event!",
      "Who's going tonight?",
      "See you at 8pm",
      "The DJ was amazing",
      "",
    ])('allows "%s"', (text) => {
      const result = classify(text);
      expect(result.category).toBe("clean");
      expect(result.action).toBe("allow");
    });
  });

  // ── Mild profanity ─────────────────────────────────────
  describe("mild profanity", () => {
    it.each([
      "That was fucking awesome",
      "holy shit what a night",
      "damn good party",
      "this DJ is the shit",
      "what an asshole",
      "oh hell yeah",
      "bullshit excuse",
    ])('allows "%s" in captions/comments', (text) => {
      const result = classify(text, "caption");
      expect(result.category).toBe("mild_profanity");
      expect(result.action).toBe("allow");
    });

    it.each(["bio", "username"] as ContentContext[])(
      "blocks mild profanity in %s context",
      (context) => {
        const result = classify("shit happens", context);
        expect(result.category).toBe("mild_profanity");
        expect(result.action).toBe("block");
      },
    );
  });

  // ── Hate speech ────────────────────────────────────────
  describe("hate speech", () => {
    it.each([
      "you stupid nigger",
      "all those faggots",
      "what a retard",
      "heil hitler",
      "white power",
      "kill all immigrants",
    ])('blocks "%s"', (text) => {
      const result = classify(text);
      expect(result.category).toBe("hate_speech");
      expect(result.action).toBe("block");
    });
  });

  // ── Sexual content ─────────────────────────────────────
  describe("sexual content", () => {
    it.each([
      "send nudes",
      "anyone want a blowjob",
      "cumshot compilation",
    ])('blocks "%s"', (text) => {
      const result = classify(text);
      expect(result.category).toBe("sexual_content");
      expect(result.action).toBe("block");
    });
  });

  // ── Harassment ─────────────────────────────────────────
  describe("harassment", () => {
    it.each([
      "kill yourself",
      "kys",
      "hope you die",
      "I'll kill you",
      "go die",
    ])('blocks "%s"', (text) => {
      const result = classify(text);
      expect(result.category).toBe("harassment");
      expect(result.action).toBe("block");
    });
  });

  // ── Doxxing ────────────────────────────────────────────
  describe("doxxing", () => {
    it.each([
      "I doxxed that guy",
      "their address is 123 Main St",
      "his home address is on file",
    ])('quarantines "%s"', (text) => {
      const result = classify(text);
      expect(result.category).toBe("doxxing");
      expect(result.action).toBe("quarantine");
    });
  });

  // ── Illegal content ────────────────────────────────────
  describe("illegal content", () => {
    it.each([
      "selling molly at the venue",
      "I can sell drugs",
      "child pornography",
    ])('blocks "%s"', (text) => {
      const result = classify(text);
      expect(result.category).toBe("illegal");
      expect(result.action).toBe("block");
    });
  });

  // ── Severity priority ─────────────────────────────────
  describe("severity priority", () => {
    it("hate speech takes priority over profanity", () => {
      const result = classify("fuck you nigger");
      expect(result.category).toBe("hate_speech");
    });

    it("illegal takes priority over sexual content", () => {
      const result = classify("child pornography site");
      expect(result.category).toBe("illegal");
    });
  });

  // ── getAction ──────────────────────────────────────────
  describe("getAction", () => {
    it("returns allow for clean content", () => {
      expect(getAction("clean")).toBe("allow");
    });

    it("returns allow for mild profanity in comment", () => {
      expect(getAction("mild_profanity", "comment")).toBe("allow");
    });

    it("returns block for mild profanity in username", () => {
      expect(getAction("mild_profanity", "username")).toBe("block");
    });

    it("returns block for hate speech in any context", () => {
      expect(getAction("hate_speech", "comment")).toBe("block");
      expect(getAction("hate_speech", "bio")).toBe("block");
    });

    it("returns quarantine for doxxing", () => {
      expect(getAction("doxxing")).toBe("quarantine");
    });
  });

  // ── False positive guards ─────────────────────────────
  describe("avoids false positives", () => {
    it.each([
      "classic rock night",    // "ass" inside "classic"
      "grassy field event",    // "ass" inside "grassy"
      "Dick's Sporting Goods", // "Dick" as proper noun — still flags (known trade-off)
      "hello world",
      "The band killed it",    // "kill" not in threat context
      "assassin's creed",      // "ass" inside "assassin"
    ])('does not block "%s" as hate/harassment', (text) => {
      const result = classify(text);
      expect(result.category).not.toBe("hate_speech");
      expect(result.category).not.toBe("harassment");
    });
  });
});
