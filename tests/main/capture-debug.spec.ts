import { describe, expect, test } from "vitest";
import { sanitizeDebugData, sanitizeDebugSnippet } from "../../src/main/capture-debug";

describe("capture debug helpers", () => {
  test("redacts account identifiers from captured snippets", () => {
    const snippet = sanitizeDebugSnippet(
      'account_id=123&accountId=abc&identifier=secret {"uniqueAccountId":"quoted","newIdentifierHash":"hash"}',
    );

    expect(snippet).toContain("account_id=<redacted>");
    expect(snippet).toContain("accountId=<redacted>");
    expect(snippet).toContain("identifier=<redacted>");
    expect(snippet).toContain('"uniqueAccountId":"<redacted>"');
    expect(snippet).toContain('"newIdentifierHash":"<redacted>"');
  });

  test("normalizes binary text and enforces length limits", () => {
    expect(sanitizeDebugSnippet("a\0\u0001   b\nc", 5)).toBe("a b c");
    expect(sanitizeDebugSnippet("abcdef", 3)).toBe("abc");
  });

  test("replaces fingerprint-shaped identifiers with stable type-preserving pseudonyms", () => {
    const fingerprint = "10-3909410-65643fdba44110001-10";
    const snippet = sanitizeDebugSnippet(`${fingerprint} ${fingerprint}`);
    const pseudonyms = snippet.match(/<item-fingerprint:[a-f0-9]{12}:type=10>/g);

    expect(snippet).not.toContain(fingerprint);
    expect(pseudonyms).toHaveLength(2);
    expect(pseudonyms?.[0]).toBe(pseudonyms?.[1]);
  });

  test("redacts sensitive fields nested inside structured diagnostics", () => {
    const fingerprint = "10-3909410-65643fdba44110001-10";
    const sanitized = sanitizeDebugData({
      events: [
        {
          value: {
            label: "Rotten Pumpkin",
            accountId: 123,
            uniqueAccountId: "secret",
            fingerprint: "raw-item-fingerprint",
          },
          message: "account_id=123&fingerprint=raw-item-fingerprint",
        },
      ],
      itemData: { [fingerprint]: { c: 1 } },
    });

    expect(
      sanitized.events,
    ).toEqual([
      {
        value: {
          label: "Rotten Pumpkin",
          accountId: "<redacted>",
          uniqueAccountId: "<redacted>",
          fingerprint: "<redacted>",
        },
        message: "account_id=<redacted>&fingerprint=<redacted>",
      },
    ]);
    const itemData = sanitized.itemData as Record<string, unknown>;
    expect(Object.keys(itemData)).toEqual([expect.stringMatching(/^<item-fingerprint:[a-f0-9]{12}:type=10>$/)]);
    expect(Object.values(itemData)).toEqual([{ c: 1 }]);
    expect(JSON.stringify(sanitized)).not.toContain(fingerprint);
  });
});
