import { describe, expect, test } from "vitest";
import { sanitizeDebugSnippet } from "../../src/main/capture-debug";

describe("capture debug helpers", () => {
  test("redacts account identifiers from captured snippets", () => {
    const snippet = sanitizeDebugSnippet(
      'account_id=123&identifier=secret {"unique_account_id":456,"newIdentifierHash":"hash"}',
    );

    expect(snippet).toContain("account_id=<redacted>");
    expect(snippet).toContain("identifier=<redacted>");
    expect(snippet).toContain('"unique_account_id":"<redacted>"');
    expect(snippet).toContain('"newIdentifierHash":"<redacted>"');
  });

  test("normalizes binary text and enforces length limits", () => {
    expect(sanitizeDebugSnippet("a\0\u0001   b\nc", 5)).toBe("a b c");
    expect(sanitizeDebugSnippet("abcdef", 3)).toBe("abc");
  });
});
