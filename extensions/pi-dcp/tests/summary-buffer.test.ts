/**
 * Tests for summary buffer logic (ticket 05)
 *
 * Verifies that active compress summaries extend the effective context limit,
 * preventing over-triggering of compress nudges in sessions with many
 * already-compressed summaries.
 */

import { describe, test, expect } from "bun:test";
import { getActiveSummaryTokens, countTokens, estimateContextTokens } from "../src/tokens";
import type { CompressSummary } from "../src/tools/compress";

function makeSummary(text: string, compressedIds: string[] = ["id_1"]): CompressSummary {
  return {
    anchorCallId: compressedIds[compressedIds.length - 1],
    summary: text,
    compressedIds,
  };
}

describe("getActiveSummaryTokens", () => {
  test("returns 0 for empty summaries", () => {
    expect(getActiveSummaryTokens([])).toBe(0);
  });

  test("counts tokens from single summary", () => {
    const text = "a".repeat(400); // ~100 tokens (400 chars / 4)
    const summaries = [makeSummary(text)];
    expect(getActiveSummaryTokens(summaries)).toBe(countTokens(text));
  });

  test("sums tokens from multiple summaries", () => {
    const s1 = makeSummary("a".repeat(400), ["id_1"]);
    const s2 = makeSummary("b".repeat(800), ["id_2"]);
    const expected = countTokens(s1.summary) + countTokens(s2.summary);
    expect(getActiveSummaryTokens([s1, s2])).toBe(expected);
  });
});

describe("summary buffer: effective context limit", () => {
  const baseLimit = 120_000;

  /**
   * Simulates the logic in injectContextInfo:
   * effectiveLimit = contextLimit + summaryTokenExtension
   * isCompressNudge = totalTokens > effectiveLimit
   */
  function shouldNudge(
    totalTokens: number,
    summaries: CompressSummary[],
    summaryBufferEnabled: boolean
  ): boolean {
    const summaryTokenExtension = summaryBufferEnabled ? getActiveSummaryTokens(summaries) : 0;
    const effectiveLimit = baseLimit + summaryTokenExtension;
    return totalTokens > effectiveLimit;
  }

  test("without summaries, nudges at base limit", () => {
    expect(shouldNudge(baseLimit + 1, [], true)).toBe(true);
    expect(shouldNudge(baseLimit - 1, [], true)).toBe(false);
  });

  test("with summaryBuffer enabled, extends limit by summary tokens", () => {
    // 10k tokens of summaries → effective limit = 130k
    const summaryText = "x".repeat(40_000); // 10k tokens
    const summaries = [makeSummary(summaryText)];
    const summaryTokens = getActiveSummaryTokens(summaries);

    // 125k tokens: over base limit (120k), but under effective limit (130k)
    expect(shouldNudge(125_000, summaries, true)).toBe(false);

    // 131k tokens: over effective limit
    expect(shouldNudge(baseLimit + summaryTokens + 1, summaries, true)).toBe(true);
  });

  test("with summaryBuffer disabled, ignores summary tokens", () => {
    const summaryText = "x".repeat(40_000); // 10k tokens
    const summaries = [makeSummary(summaryText)];

    // 125k > 120k base → nudge (summary buffer disabled, no extension)
    expect(shouldNudge(125_000, summaries, false)).toBe(true);
  });

  test("repeated compressions accumulate summary buffer", () => {
    // Simulate 5 compress rounds, each producing ~5k tokens of summaries
    const summaries: CompressSummary[] = [];
    for (let i = 0; i < 5; i++) {
      summaries.push(makeSummary("y".repeat(20_000), [`id_${i}`]));
    }
    const summaryTokens = getActiveSummaryTokens(summaries);
    // 5 × 5k = 25k summary tokens → effective limit = 145k
    expect(summaryTokens).toBe(25_000);

    // 140k: under effective limit (145k), over base limit (120k)
    expect(shouldNudge(140_000, summaries, true)).toBe(false);

    // 146k: over effective limit
    expect(shouldNudge(146_000, summaries, true)).toBe(true);
  });

  test("raw history growth still nudges with summaryBuffer", () => {
    // Even with summary buffer, massive raw growth triggers nudge
    const summaries = [makeSummary("z".repeat(4_000))]; // 1k summary tokens
    const effectiveLimit = baseLimit + getActiveSummaryTokens(summaries); // ~121k

    expect(shouldNudge(effectiveLimit + 1_000, summaries, true)).toBe(true);
  });
});
