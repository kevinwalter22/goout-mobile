import {
  moderateText,
  checkBeforeSubmit,
  shouldEscalateToLLM,
} from "../textModeration";

describe("textModeration", () => {
  // ── Clean content ───────────────────────────────────────
  describe("clean content", () => {
    it.each([
      "Great event tonight!",
      "Who's going?",
      "See you at 8pm",
      "",
      "   ",
    ])('allows "%s"', (text) => {
      const result = moderateText(text);
      expect(result.action).toBe("allow");
      expect(result.severity).toBe(0);
      expect(result.categories).toEqual([]);
    });
  });

  // ── Mild profanity ──────────────────────────────────────
  describe("mild profanity", () => {
    it("allows mild profanity in captions", () => {
      const result = moderateText("That was fucking awesome", "caption");
      expect(result.action).toBe("allow");
      expect(result.severity).toBe(20);
      expect(result.categories).toContain("mild_profanity");
    });

    it("allows mild profanity in comments", () => {
      const result = moderateText("holy shit what a night", "comment");
      expect(result.action).toBe("allow");
      expect(result.severity).toBe(20);
    });

    it("blocks mild profanity in bio", () => {
      const result = moderateText("shit happens", "bio");
      expect(result.action).toBe("block");
      expect(result.categories).toContain("mild_profanity");
    });

    it("blocks mild profanity in username", () => {
      const result = moderateText("fuck you", "username");
      expect(result.action).toBe("block");
    });
  });

  // ── Hate speech ─────────────────────────────────────────
  describe("hate speech", () => {
    it.each([
      "you stupid nigger",
      "all those faggots",
      "what a retard",
      "heil hitler",
      "white power",
    ])('blocks "%s" with severity 95', (text) => {
      const result = moderateText(text);
      expect(result.action).toBe("block");
      expect(result.severity).toBe(95);
      expect(result.categories).toContain("hate_speech");
    });
  });

  // ── Sexual content ──────────────────────────────────────
  describe("sexual content", () => {
    it.each([
      "send nudes",
      "anyone want a blowjob",
      "cumshot compilation",
    ])('blocks "%s" with severity 85', (text) => {
      const result = moderateText(text);
      expect(result.action).toBe("block");
      expect(result.severity).toBe(85);
      expect(result.categories).toContain("sexual_content");
    });
  });

  // ── Harassment ──────────────────────────────────────────
  describe("harassment", () => {
    it.each([
      "kill yourself",
      "kys",
      "hope you die",
      "I'll kill you",
    ])('blocks "%s" with severity 90', (text) => {
      const result = moderateText(text);
      expect(result.action).toBe("block");
      expect(result.severity).toBe(90);
      expect(result.categories).toContain("harassment");
    });
  });

  // ── Doxxing ─────────────────────────────────────────────
  describe("doxxing", () => {
    it("quarantines doxxing mentions", () => {
      const result = moderateText("I doxxed that guy");
      expect(result.action).toBe("quarantine");
      expect(result.severity).toBe(70);
      expect(result.categories).toContain("doxxing");
    });

    it("quarantines address sharing", () => {
      const result = moderateText("their address is 123 Main St");
      expect(result.action).toBe("quarantine");
      expect(result.categories).toContain("doxxing");
    });
  });

  // ── Illegal content ─────────────────────────────────────
  describe("illegal content", () => {
    it.each([
      "selling molly at the venue",
      "child pornography",
    ])('blocks "%s" with severity 95', (text) => {
      const result = moderateText(text);
      expect(result.action).toBe("block");
      expect(result.severity).toBe(95);
      expect(result.categories).toContain("illegal");
    });
  });

  // ── Multi-category detection ────────────────────────────
  describe("multi-category detection", () => {
    it("detects multiple categories", () => {
      const result = moderateText("fuck you nigger");
      expect(result.categories).toContain("hate_speech");
      expect(result.categories).toContain("mild_profanity");
      expect(result.severity).toBe(95); // highest wins
      expect(result.action).toBe("block");
    });

    it("returns highest severity across categories", () => {
      // doxxing (70) + mild profanity (20) → severity = 70
      const result = moderateText("I doxxed that shit");
      expect(result.categories).toContain("doxxing");
      expect(result.categories).toContain("mild_profanity");
      expect(result.severity).toBe(70);
      expect(result.action).toBe("quarantine");
    });
  });

  // ── PII detection in bio ────────────────────────────────
  describe("PII in bio context", () => {
    it("quarantines phone number in bio", () => {
      const result = moderateText("Call me 555-123-4567", "bio");
      expect(result.action).toBe("quarantine");
      expect(result.categories).toContain("doxxing");
    });

    it("quarantines email in bio", () => {
      const result = moderateText("email me user@example.com", "bio");
      expect(result.action).toBe("quarantine");
      expect(result.categories).toContain("doxxing");
    });

    it("does not flag phone number in captions", () => {
      const result = moderateText("Call 555-123-4567 for info", "caption");
      expect(result.categories).not.toContain("doxxing");
    });
  });

  // ── Reason string ───────────────────────────────────────
  describe("reason string", () => {
    it("includes category labels in reason", () => {
      const result = moderateText("kill yourself");
      expect(result.reason).toContain("Harassment");
    });

    it("says Blocked for blocked content", () => {
      const result = moderateText("send nudes");
      expect(result.reason).toMatch(/^Blocked:/);
    });

    it("says Held for review for quarantined content", () => {
      const result = moderateText("I doxxed someone");
      expect(result.reason).toMatch(/^Held for review:/);
    });

    it("returns clean for empty text", () => {
      const result = moderateText("");
      expect(result.reason).toBe("empty");
    });
  });

  // ── checkBeforeSubmit ───────────────────────────────────
  describe("checkBeforeSubmit", () => {
    it("allows clean text", () => {
      const check = checkBeforeSubmit("Great party!", "caption");
      expect(check.allowed).toBe(true);
    });

    it("allows mild profanity in comments", () => {
      const check = checkBeforeSubmit("holy shit", "comment");
      expect(check.allowed).toBe(true);
    });

    it("blocks hate speech with user-friendly message", () => {
      const check = checkBeforeSubmit("white power", "comment");
      expect(check.allowed).toBe(false);
      if (!check.allowed) {
        expect(check.reason).toContain("community guidelines");
      }
    });

    it("blocks profanity in username with specific message", () => {
      const check = checkBeforeSubmit("shit lord", "username");
      expect(check.allowed).toBe(false);
      if (!check.allowed) {
        expect(check.reason).toContain("Profanity");
      }
    });

    it("allows quarantined content through (handled server-side)", () => {
      const check = checkBeforeSubmit("I doxxed that guy", "comment");
      expect(check.allowed).toBe(true);
    });

    it("allows empty text", () => {
      const check = checkBeforeSubmit("", "caption");
      expect(check.allowed).toBe(true);
    });
  });

  // ── shouldEscalateToLLM ─────────────────────────────────
  describe("shouldEscalateToLLM", () => {
    it("returns true for doxxing (severity 70)", () => {
      const result = moderateText("I doxxed that guy");
      expect(shouldEscalateToLLM(result)).toBe(true);
    });

    it("returns false for clean content (severity 0)", () => {
      const result = moderateText("Hello world");
      expect(shouldEscalateToLLM(result)).toBe(false);
    });

    it("returns false for hate speech (severity 95)", () => {
      const result = moderateText("white power");
      expect(shouldEscalateToLLM(result)).toBe(false);
    });

    it("returns false for mild profanity (severity 20)", () => {
      const result = moderateText("oh shit", "comment");
      expect(shouldEscalateToLLM(result)).toBe(false);
    });
  });

  // ── False positive guards ───────────────────────────────
  describe("avoids false positives", () => {
    it.each([
      "classic rock night",
      "grassy field event",
      "hello world",
      "The band killed it",
      "assassin's creed gaming event",
    ])('does not block "%s"', (text) => {
      const result = moderateText(text);
      expect(result.action).toBe("allow");
    });
  });
});
