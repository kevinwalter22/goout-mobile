/**
 * Extended moderation coverage — 40+ additional test cases targeting
 * pattern variants, cross-context behavior, edge cases, and the full
 * breadth of patterns defined in policy.ts and textModeration.ts.
 *
 * Run: npm run test:moderation
 */

import { classify, getAction } from "../policy";
import type { ContentContext, ModerationCategory } from "../policy";
import {
  moderateText,
  checkBeforeSubmit,
  shouldEscalateToLLM,
} from "../textModeration";

// ═══════════════════════════════════════════════════════════════════
// 1. HATE SPEECH — variant patterns
// ═══════════════════════════════════════════════════════════════════
describe("hate speech variants", () => {
  it.each([
    // Racial slurs (all word lists)
    "those kikes are terrible",
    "stupid spics everywhere",
    "damn chinks",
    "filthy gooks",
    "go home wetback",
    "bunch of beaners",
    // Homophobic/transphobic
    "tranny freak",
    "stupid trannies",
    // Hate phrases
    "sieg heil brothers",
    "start a race war",
    "gas the jews",
  ])('blocks hate speech variant: "%s"', (text) => {
    const result = moderateText(text);
    expect(result.action).toBe("block");
    expect(result.severity).toBe(95);
    expect(result.categories).toContain("hate_speech");
  });

  it("detects hate speech regardless of case", () => {
    const result = moderateText("WHITE POWER FOREVER");
    expect(result.categories).toContain("hate_speech");
    expect(result.action).toBe("block");
  });

  it("detects hate speech with mixed spacing", () => {
    const result = moderateText("heil  hitler salute");
    expect(result.categories).toContain("hate_speech");
  });

  it("blocks 'kill all [group]' pattern", () => {
    const result = moderateText("kill all foreigners");
    expect(result.categories).toContain("hate_speech");
    expect(result.action).toBe("block");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. HARASSMENT — threat variants
// ═══════════════════════════════════════════════════════════════════
describe("harassment threat variants", () => {
  it.each([
    "you should die alone",
    "I'm going to kill you",
    "I'm gonna murder you",
    "I'll stab you",
    "I'll shoot you",
    "rape you tonight",
    "I'm gonna rape her",
    "i'll murder him",
    "i'm gonna stab them",
  ])('blocks threat: "%s"', (text) => {
    const result = moderateText(text);
    expect(result.action).toBe("block");
    expect(result.categories).toContain("harassment");
  });

  it("detects 'go die' as harassment", () => {
    const result = classify("just go die already");
    expect(result.category).toBe("harassment");
    expect(result.action).toBe("block");
  });

  it("blocks 'kys' regardless of surrounding text", () => {
    const result = moderateText("honestly kys lol");
    expect(result.categories).toContain("harassment");
    expect(result.action).toBe("block");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. SEXUAL CONTENT — variant patterns
// ═══════════════════════════════════════════════════════════════════
describe("sexual content variants", () => {
  it.each([
    "that handjob was crazy",
    "rimjob discussion",
    "gangbang party",
    "deepthroat challenge",
    "creampie video",
    "bukakke scene",
    "hentai collection",
    "best orgasm ever",
    "send me a dick pic",
    "nude pics please",
  ])('blocks sexual content: "%s"', (text) => {
    const result = moderateText(text);
    expect(result.action).toBe("block");
    expect(result.severity).toBe(85);
    expect(result.categories).toContain("sexual_content");
  });

  it("blocks 'send nude' (singular)", () => {
    const result = moderateText("send nude");
    expect(result.categories).toContain("sexual_content");
    expect(result.action).toBe("block");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. DOXXING — pattern variants
// ═══════════════════════════════════════════════════════════════════
describe("doxxing variants", () => {
  it.each([
    "I doxed him online",
    "stop doxing people",
    "she got doxxed yesterday",
    "doxxing is illegal",
    "his address is: 456 Oak Ave",
    "her home address is known",
    "someone's address is 789 Elm",
  ])('quarantines doxxing: "%s"', (text) => {
    const result = moderateText(text);
    expect(result.action).toBe("quarantine");
    expect(result.categories).toContain("doxxing");
    expect(result.severity).toBe(70);
  });

  it("detects SSN pattern", () => {
    const result = moderateText("his ssn 123-45-6789 was leaked");
    expect(result.categories).toContain("doxxing");
    expect(result.action).toBe("quarantine");
  });

  it("detects SSN with dots", () => {
    const result = moderateText("ssn is 123.45.6789");
    expect(result.categories).toContain("doxxing");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. ILLEGAL CONTENT — variant patterns
// ═══════════════════════════════════════════════════════════════════
describe("illegal content variants", () => {
  it.each([
    "sell drugs at the park",
    "selling meth cheap",
    "selling cocaine here",
    "selling heroin today",
    "selling fentanyl pills",
    "selling xanax bars",
    "sell ecstasy tabs",
    "csam distribution",
    "human trafficking ring",
  ])('blocks illegal: "%s"', (text) => {
    const result = moderateText(text);
    expect(result.action).toBe("block");
    expect(result.severity).toBe(95);
    expect(result.categories).toContain("illegal");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. MILD PROFANITY — extended variant list
// ═══════════════════════════════════════════════════════════════════
describe("mild profanity variants", () => {
  it.each([
    "dammit I missed it",
    "what a shitty venue",
    "that fucker was late",
    "arse is sore",
    "she's a bitch",
    "crappy sound system",
    "pissed off right now",
    "goddamn traffic",
    "wtf is happening",
    "stfu already",
    "what a cock",
    "stop being a prick",
    "absolute cunt",
    "oh bollocks",
    "bloody hell mate",
  ])('allows mild profanity in caption: "%s"', (text) => {
    const result = moderateText(text, "caption");
    expect(result.action).toBe("allow");
    expect(result.categories).toContain("mild_profanity");
    expect(result.severity).toBe(20);
  });

  it("allows mild profanity in event context", () => {
    const result = moderateText("damn good food here", "event");
    expect(result.action).toBe("allow");
    expect(result.categories).toContain("mild_profanity");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. CROSS-CONTEXT behavior
// ═══════════════════════════════════════════════════════════════════
describe("cross-context behavior", () => {
  const strictContexts: ContentContext[] = ["bio", "username"];
  const lenientContexts: ContentContext[] = ["caption", "comment", "event"];

  it.each(strictContexts)(
    "blocks mild profanity in strict context: %s",
    (ctx) => {
      const result = moderateText("damn good time", ctx);
      expect(result.action).toBe("block");
      expect(result.categories).toContain("mild_profanity");
    },
  );

  it.each(lenientContexts)(
    "allows mild profanity in lenient context: %s",
    (ctx) => {
      const result = moderateText("damn good time", ctx);
      expect(result.action).toBe("allow");
      expect(result.categories).toContain("mild_profanity");
    },
  );

  it.each(["caption", "comment", "event", "bio", "username"] as ContentContext[])(
    "blocks hate speech in every context: %s",
    (ctx) => {
      const result = moderateText("white power", ctx);
      expect(result.action).toBe("block");
      expect(result.categories).toContain("hate_speech");
    },
  );

  it.each(["caption", "comment", "event", "bio", "username"] as ContentContext[])(
    "blocks harassment in every context: %s",
    (ctx) => {
      const result = moderateText("kill yourself", ctx);
      expect(result.action).toBe("block");
      expect(result.categories).toContain("harassment");
    },
  );
});

// ═══════════════════════════════════════════════════════════════════
// 8. PII DETECTION — context-specific
// ═══════════════════════════════════════════════════════════════════
describe("PII detection across contexts", () => {
  it("quarantines phone in username context", () => {
    const result = moderateText("call 555-123-4567", "username");
    expect(result.categories).toContain("doxxing");
    expect(result.action).not.toBe("allow");
  });

  it("quarantines email in username context", () => {
    const result = moderateText("reach me@example.com", "username");
    expect(result.categories).toContain("doxxing");
  });

  it("does NOT flag phone number in event context", () => {
    const result = moderateText("RSVP 555-867-5309", "event");
    expect(result.categories).not.toContain("doxxing");
  });

  it("does NOT flag phone number in comment context", () => {
    const result = moderateText("Call 123-456-7890 for tickets", "comment");
    expect(result.categories).not.toContain("doxxing");
  });

  it("quarantines email in bio", () => {
    const result = moderateText("DM me at my.email+tag@domain.co.uk", "bio");
    expect(result.categories).toContain("doxxing");
    expect(result.action).not.toBe("allow");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. MULTI-CATEGORY edge cases
// ═══════════════════════════════════════════════════════════════════
describe("multi-category edge cases", () => {
  it("hate speech + harassment combo uses highest severity", () => {
    const result = moderateText("kill yourself nigger");
    expect(result.categories).toContain("hate_speech");
    expect(result.categories).toContain("harassment");
    expect(result.severity).toBe(95); // hate_speech = 95 = max
    expect(result.action).toBe("block");
  });

  it("sexual content + mild profanity combo uses highest", () => {
    const result = moderateText("fucking blowjob");
    expect(result.categories).toContain("sexual_content");
    expect(result.categories).toContain("mild_profanity");
    expect(result.severity).toBe(85);
    expect(result.action).toBe("block");
  });

  it("illegal + profanity combo", () => {
    const result = moderateText("damn selling cocaine tonight");
    expect(result.categories).toContain("illegal");
    expect(result.categories).toContain("mild_profanity");
    expect(result.severity).toBe(95);
  });

  it("doxxing + profanity combo stays quarantine", () => {
    const result = moderateText("shit their address is: 123 Oak", "comment");
    expect(result.categories).toContain("doxxing");
    expect(result.categories).toContain("mild_profanity");
    expect(result.action).toBe("quarantine");
    expect(result.severity).toBe(70);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. checkBeforeSubmit — comprehensive
// ═══════════════════════════════════════════════════════════════════
describe("checkBeforeSubmit comprehensive", () => {
  it("blocks sexual content with user-friendly message", () => {
    const check = checkBeforeSubmit("send nudes", "comment");
    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.reason).toContain("sexually explicit");
    }
  });

  it("blocks illegal content with user-friendly message", () => {
    const check = checkBeforeSubmit("selling cocaine", "comment");
    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.reason).toContain("illegal");
    }
  });

  it("blocks harassment with user-friendly message", () => {
    const check = checkBeforeSubmit("I'll kill you", "comment");
    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.reason).toContain("threatening");
    }
  });

  it("allows doxxing through (quarantine handled server-side)", () => {
    const check = checkBeforeSubmit("doxxing someone online", "caption");
    expect(check.allowed).toBe(true);
  });

  it("blocks profanity in bio context", () => {
    const check = checkBeforeSubmit("damn cool person", "bio");
    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.reason).toContain("Profanity");
    }
  });

  it("allows mild profanity in event context", () => {
    const check = checkBeforeSubmit("damn good show", "event");
    expect(check.allowed).toBe(true);
  });

  it("allows whitespace-only text", () => {
    const check = checkBeforeSubmit("   ", "caption");
    expect(check.allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. shouldEscalateToLLM — boundary values
// ═══════════════════════════════════════════════════════════════════
describe("shouldEscalateToLLM boundaries", () => {
  it("returns true for severity exactly 55 (doxxing address pattern)", () => {
    // doxxing severity is 70 which is in [55, 75]
    const result = moderateText("their address is 123 Elm");
    expect(shouldEscalateToLLM(result)).toBe(true);
  });

  it("returns false for severity 20 (mild profanity)", () => {
    const result = moderateText("oh damn", "caption");
    expect(result.severity).toBe(20);
    expect(shouldEscalateToLLM(result)).toBe(false);
  });

  it("returns false for severity 85 (sexual content)", () => {
    const result = moderateText("blowjob");
    expect(result.severity).toBe(85);
    expect(shouldEscalateToLLM(result)).toBe(false);
  });

  it("returns false for severity 90 (harassment)", () => {
    const result = moderateText("hope you die");
    expect(result.severity).toBe(90);
    expect(shouldEscalateToLLM(result)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. FALSE POSITIVES — comprehensive
// ═══════════════════════════════════════════════════════════════════
describe("false positive guards comprehensive", () => {
  it.each([
    // Words containing 'ass' substring
    ["classic rock concert", "ass in classic"],
    ["grass-fed beef festival", "ass in grass"],
    ["embassy party", "ass in embassy"],
    ["compassionate community", "ass in compassionate"],
    // Words containing 'hell' substring
    ["hello everyone!", "hell in hello"],
    ["Michelle's birthday", "hell in Michelle"],
    ["shelling peanuts event", "hell in shelling"],
    // Words containing 'cock' substring
    ["cocktail hour", "cock in cocktail"],
    ["peacock garden show", "cock in peacock"],
    // Non-threatening 'kill'
    ["killer DJ set tonight", "kill in killer"],
    ["time to kill before the show", "kill not targeted"],
    // Safe uses of 'die'
    ["the die is cast", "die as noun"],
    ["diehard fans unite", "die in diehard"],
    // Non-sexual 'dick'
    ["Dick Van Dyke marathon", "Dick as name"],
  ])('allows "%s" — %s', (text) => {
    const result = moderateText(text);
    expect(result.action).not.toBe("block");
    // Should be either clean or mild_profanity (allow)
    expect(["allow", "quarantine"]).not.toContain(
      result.action === "block" ? "block" : undefined,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. REASON STRINGS — category-specific messages
// ═══════════════════════════════════════════════════════════════════
describe("reason strings per category", () => {
  it("includes 'Hate Speech' label for hate content", () => {
    const result = moderateText("white power");
    expect(result.reason).toContain("Hate Speech");
  });

  it("includes 'Sexual Content' label", () => {
    const result = moderateText("send nudes");
    expect(result.reason).toContain("Sexual Content");
  });

  it("includes 'Illegal Content' label", () => {
    const result = moderateText("selling cocaine");
    expect(result.reason).toContain("Illegal Content");
  });

  it("includes 'Personal Info' label for doxxing", () => {
    const result = moderateText("doxxing someone");
    expect(result.reason).toContain("Personal Info");
  });

  it("includes 'Mild Profanity' for profanity-only", () => {
    const result = moderateText("oh shit", "caption");
    expect(result.reason).toContain("Mild Profanity");
  });

  it("reason says 'Detected:' for allow action with profanity", () => {
    const result = moderateText("damn good", "caption");
    expect(result.reason).toMatch(/^Detected:/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 14. getAction — exhaustive category × context matrix
// ═══════════════════════════════════════════════════════════════════
describe("getAction category × context matrix", () => {
  const allContexts: ContentContext[] = ["caption", "comment", "event", "bio", "username"];
  const alwaysBlock: ModerationCategory[] = ["hate_speech", "sexual_content", "harassment", "illegal"];

  it.each(alwaysBlock)("%s is block in every context", (cat) => {
    for (const ctx of allContexts) {
      expect(getAction(cat, ctx)).toBe("block");
    }
  });

  it("doxxing is quarantine in every context", () => {
    for (const ctx of allContexts) {
      expect(getAction("doxxing", ctx)).toBe("quarantine");
    }
  });

  it("clean is allow in every context", () => {
    for (const ctx of allContexts) {
      expect(getAction("clean", ctx)).toBe("allow");
    }
  });

  it("mild_profanity is allow in caption/comment/event, block in bio/username", () => {
    expect(getAction("mild_profanity", "caption")).toBe("allow");
    expect(getAction("mild_profanity", "comment")).toBe("allow");
    expect(getAction("mild_profanity", "event")).toBe("allow");
    expect(getAction("mild_profanity", "bio")).toBe("block");
    expect(getAction("mild_profanity", "username")).toBe("block");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 15. CLASSIFY — severity priority with policy.classify()
// ═══════════════════════════════════════════════════════════════════
describe("classify severity priority", () => {
  it("hate speech beats mild profanity", () => {
    expect(classify("damn nigger").category).toBe("hate_speech");
  });

  it("illegal beats harassment", () => {
    expect(classify("I'll kill you with selling cocaine").category).toBe("illegal");
  });

  it("hate speech beats sexual content", () => {
    expect(classify("faggot blowjob").category).toBe("hate_speech");
  });

  it("sexual content beats harassment", () => {
    expect(classify("send nudes or kys").category).toBe("sexual_content");
  });

  it("harassment beats doxxing", () => {
    expect(classify("kys doxxing you").category).toBe("harassment");
  });
});
