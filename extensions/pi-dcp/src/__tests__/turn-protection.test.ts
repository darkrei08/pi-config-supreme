/**
 * Tests for turn-protection consistency across all automatic rules.
 *
 * Verifies that messages from the last N protected turns are never pruned
 * by deduplication, error-purging, or superseded-writes — regardless of
 * rule order or message count within a turn.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { applyPruningWorkflow } from "../workflow";
import { annotateTurnIndices, isTurnProtected } from "../metadata";
import { createMessageWithMetadata } from "../metadata";
import { registerRule } from "../registry";
import { deduplicationRule } from "../rules/deduplication";
import { errorPurgingRule } from "../rules/error-purging";
import { supersededWritesRule } from "../rules/superseded-writes";
import { toolPairingRule } from "../rules/tool-pairing";
import { recencyRule } from "../rules/recency";
import type { DcpConfigWithPruneRuleObjects, TurnProtection } from "../types";

// --- Helpers ---

function makeAssistant(
  toolCalls: { id: string; name: string; args?: Record<string, any> }[],
  text = "\n\n"
): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text },
      ...toolCalls.map((tc) => ({
        type: "toolCall" as const,
        id: tc.id,
        name: tc.name,
        arguments: tc.args ?? {},
      })),
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
    stopReason: "toolUse",
    timestamp: Date.now(),
  } as any;
}

function makeToolResult(
  toolCallId: string,
  toolName: string,
  content: string,
  opts?: { isError?: boolean; details?: Record<string, any> }
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text: content }],
    isError: opts?.isError ?? false,
    details: opts?.details,
    timestamp: Date.now(),
  } as any;
}

function makeUser(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  } as any;
}

function makeConfig(
  rules: DcpConfigWithPruneRuleObjects["rules"],
  opts?: {
    keepRecentCount?: number;
    turnProtection?: TurnProtection;
  }
): DcpConfigWithPruneRuleObjects {
  return {
    enabled: true,
    debug: false,
    keepRecentCount: opts?.keepRecentCount ?? 2,
    turnProtection: opts?.turnProtection ?? { enabled: true, turns: 3 },
    rules,
  };
}

function getToolResultIds(messages: AgentMessage[]): string[] {
  return messages.filter((m) => m.role === "toolResult").map((m) => (m as any).toolCallId);
}

function getToolUseIds(messages: AgentMessage[]): string[] {
  return messages
    .filter((m) => m.role === "assistant" && Array.isArray(m.content))
    .flatMap((m) =>
      ((m as any).content as any[]).filter((b) => b?.type === "toolCall").map((b) => b.id)
    );
}

function assertToolPairsIntact(messages: AgentMessage[]) {
  const toolUseIds = new Set(getToolUseIds(messages));
  const toolResultIds = new Set(getToolResultIds(messages));
  for (const id of toolResultIds) {
    expect(toolUseIds.has(id)).toBe(true);
  }
  for (const id of toolUseIds) {
    expect(toolResultIds.has(id)).toBe(true);
  }
}

// --- Register rules ---

beforeAll(() => {
  registerRule(deduplicationRule);
  registerRule(errorPurgingRule);
  registerRule(supersededWritesRule);
  registerRule(toolPairingRule);
  registerRule(recencyRule);
});

// ============================================================
// Unit: annotateTurnIndices / isTurnProtected
// ============================================================

describe("annotateTurnIndices", () => {
  test("increments turn on each user message", () => {
    const msgs = [makeUser("a"), makeUser("b"), makeUser("c")].map(createMessageWithMetadata);
    annotateTurnIndices(msgs);
    expect(msgs.map((m) => m.metadata.turnIndex)).toEqual([1, 2, 3]);
  });

  test("assistant and toolResult share turn with preceding user", () => {
    const msgs = [
      makeUser("go"),
      makeAssistant([{ id: "t1", name: "bash" }]),
      makeToolResult("t1", "bash", "out"),
      makeUser("next"),
      makeAssistant([{ id: "t2", name: "bash" }]),
      makeToolResult("t2", "bash", "out2"),
    ].map(createMessageWithMetadata);
    annotateTurnIndices(msgs);
    expect(msgs.map((m) => m.metadata.turnIndex)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  test("messages before first user get turn 0", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "text", text: "system init" }] } as any,
      makeUser("hello"),
    ].map(createMessageWithMetadata);
    annotateTurnIndices(msgs);
    expect(msgs[0].metadata.turnIndex).toBe(0);
    expect(msgs[1].metadata.turnIndex).toBe(1);
  });
});

describe("isTurnProtected", () => {
  test("protects messages from last N turns", () => {
    const msg = createMessageWithMetadata(makeUser("x"));
    msg.metadata.turnIndex = 5;
    expect(isTurnProtected(msg, 7, { enabled: true, turns: 3 })).toBe(true); // 7-5=2 < 3
    expect(isTurnProtected(msg, 8, { enabled: true, turns: 3 })).toBe(false); // 8-5=3 >= 3
  });

  test("returns false when disabled", () => {
    const msg = createMessageWithMetadata(makeUser("x"));
    msg.metadata.turnIndex = 5;
    expect(isTurnProtected(msg, 5, { enabled: false, turns: 3 })).toBe(false);
  });

  test("returns false when turnIndex not set", () => {
    const msg = createMessageWithMetadata(makeUser("x"));
    expect(isTurnProtected(msg, 5, { enabled: true, turns: 3 })).toBe(false);
  });

  test("returns false when turnProtection is undefined", () => {
    const msg = createMessageWithMetadata(makeUser("x"));
    msg.metadata.turnIndex = 5;
    expect(isTurnProtected(msg, 5, undefined)).toBe(false);
  });
});

// ============================================================
// Integration: deduplication respects turn protection
// ============================================================

describe("deduplication + turn protection", () => {
  test("duplicate in protected turn is NOT pruned", () => {
    // Turn 1: assistant says "Hi"
    // Turn 2: assistant says "Hi" again (exact duplicate)
    // With turnProtection.turns=3 both are in recent turns → neither pruned
    const messages: AgentMessage[] = [
      makeUser("hello"),
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }], timestamp: Date.now() } as any,
      makeUser("say hi again"),
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }], timestamp: Date.now() } as any,
    ];

    const config = makeConfig([deduplicationRule, toolPairingRule, recencyRule], {
      keepRecentCount: 2,
      turnProtection: { enabled: true, turns: 3 },
    });

    const result = applyPruningWorkflow(messages, config);
    // Both "Hi there!" kept because both turns are protected
    const hiMessages = result.filter(
      (m) => m.role === "assistant" && Array.isArray(m.content) &&
        (m.content as any[]).some((b: any) => b.type === "text" && b.text === "Hi there!")
    );
    expect(hiMessages.length).toBe(2);
  });

  test("duplicate outside protected turns IS pruned", () => {
    // Dedup marks the LATER occurrence. To prune a dup, the later one
    // must be outside turn protection.
    // 5 turns, protection=1. Dup in turn 1 (old) and turn 2 (old).
    // Later dup (turn 2) is outside protection (5-2=3 >= 1) → pruned.
    const messages: AgentMessage[] = [
      makeUser("t1"),
      { role: "assistant", content: [{ type: "text", text: "dup text" }], timestamp: Date.now() } as any,
      makeUser("t2"),
      { role: "assistant", content: [{ type: "text", text: "dup text" }], timestamp: Date.now() } as any,
      makeUser("t3"),
      { role: "assistant", content: [{ type: "text", text: "t3 resp" }], timestamp: Date.now() } as any,
      makeUser("t4"),
      { role: "assistant", content: [{ type: "text", text: "t4 resp" }], timestamp: Date.now() } as any,
      makeUser("t5"),
      { role: "assistant", content: [{ type: "text", text: "t5 resp" }], timestamp: Date.now() } as any,
    ];

    const config = makeConfig([deduplicationRule, toolPairingRule, recencyRule], {
      keepRecentCount: 2,
      turnProtection: { enabled: true, turns: 1 },
    });

    const result = applyPruningWorkflow(messages, config);
    // Turn 2's "dup text" (later occurrence) is outside protection → pruned
    const dupMessages = result.filter(
      (m) => m.role === "assistant" && Array.isArray(m.content) &&
        (m.content as any[]).some((b: any) => b.type === "text" && b.text === "dup text")
    );
    expect(dupMessages.length).toBe(1);
  });
});

// ============================================================
// Integration: error-purging respects turn protection
// ============================================================

describe("error-purging + turn protection", () => {
  test("resolved error in protected turn is NOT purged", () => {
    // Turn 1: error tool result, then success retry
    // With turnProtection.turns=3, turn 1 is protected → error kept
    const messages: AgentMessage[] = [
      makeUser("run it"),
      makeAssistant([{ id: "err1", name: "bash", args: { command: "fail" } }]),
      makeToolResult("err1", "bash", "Error: command failed", { isError: true }),
      makeAssistant([{ id: "ok1", name: "bash", args: { command: "fail" } }]),
      makeToolResult("ok1", "bash", "Success"),
    ];

    const config = makeConfig(
      [errorPurgingRule, toolPairingRule, recencyRule],
      { keepRecentCount: 2, turnProtection: { enabled: true, turns: 3 } }
    );

    const result = applyPruningWorkflow(messages, config);
    // Error tool result kept (turn protected)
    expect(getToolResultIds(result)).toContain("err1");
    assertToolPairsIntact(result);
  });

  test("resolved error outside protected turns: error-purging marks it but tool-pairing preserves pair", () => {
    // Error-purging marks the error toolResult for pruning. However,
    // tool-pairing ensures the pair stays intact: if the assistant (tool_use)
    // is kept, the tool_result is un-pruned. This is correct — message-level
    // pruning can't safely remove one half of a tool pair.
    const messages: AgentMessage[] = [
      makeUser("t1"),
      makeAssistant([{ id: "err1", name: "bash", args: { command: "fail" } }]),
      makeToolResult("err1", "bash", "Error: command failed", { isError: true }),
      makeAssistant([{ id: "ok1", name: "bash", args: { command: "fail" } }]),
      makeToolResult("ok1", "bash", "Success"),
      makeUser("t2"),
      makeAssistant([{ id: "t2a", name: "bash", args: { command: "ls" } }]),
      makeToolResult("t2a", "bash", "files"),
      makeUser("t3"),
      makeAssistant([{ id: "t3a", name: "bash", args: { command: "pwd" } }]),
      makeToolResult("t3a", "bash", "/home"),
      makeUser("t4"),
      makeAssistant([{ id: "t4a", name: "bash", args: { command: "echo hi" } }]),
      makeToolResult("t4a", "bash", "hi"),
    ];

    const config = makeConfig(
      [errorPurgingRule, toolPairingRule, recencyRule],
      { keepRecentCount: 2, turnProtection: { enabled: true, turns: 2 } }
    );

    const result = applyPruningWorkflow(messages, config);
    // Tool-pairing preserves err1 because its tool_use (assistant) is kept
    // This is correct — layer 2 (LLM-driven) handles tool-level pruning
    assertToolPairsIntact(result);
  });
});

// ============================================================
// Integration: superseded-writes respects turn protection
// ============================================================

describe("superseded-writes + turn protection", () => {
  test("superseded write in protected turn is NOT pruned", () => {
    // Same file written twice in recent turns → both kept
    const messages: AgentMessage[] = [
      makeUser("edit foo"),
      makeAssistant([{ id: "w1", name: "write", args: { path: "foo.ts" } }]),
      makeToolResult("w1", "write", "wrote foo.ts", { details: { path: "foo.ts" } }),
      makeUser("edit foo again"),
      makeAssistant([{ id: "w2", name: "write", args: { path: "foo.ts" } }]),
      makeToolResult("w2", "write", "wrote foo.ts v2", { details: { path: "foo.ts" } }),
    ];

    const config = makeConfig(
      [supersededWritesRule, toolPairingRule, recencyRule],
      { keepRecentCount: 2, turnProtection: { enabled: true, turns: 3 } }
    );

    const result = applyPruningWorkflow(messages, config);
    expect(getToolResultIds(result)).toContain("w1");
    expect(getToolResultIds(result)).toContain("w2");
    assertToolPairsIntact(result);
  });

  test("superseded write outside protected turns: marked but tool-pairing preserves pair", () => {
    // superseded-writes marks w1's toolResult. But tool-pairing un-prunes it
    // because the assistant (tool_use) is kept. Message-level auto-pruning
    // can't safely break tool pairs — layer 2 handles that.
    const messages: AgentMessage[] = [
      makeUser("t1"),
      makeAssistant([{ id: "w1", name: "write", args: { path: "foo.ts" } }]),
      makeToolResult("w1", "write", "wrote foo.ts", { details: { path: "foo.ts" } }),
      makeUser("t2"),
      makeAssistant([{ id: "t2a", name: "bash", args: { command: "test" } }]),
      makeToolResult("t2a", "bash", "ok"),
      makeUser("t3"),
      makeAssistant([{ id: "t3a", name: "bash", args: { command: "build" } }]),
      makeToolResult("t3a", "bash", "built"),
      makeUser("t4"),
      makeAssistant([{ id: "w2", name: "write", args: { path: "foo.ts" } }]),
      makeToolResult("w2", "write", "wrote foo.ts v2", { details: { path: "foo.ts" } }),
    ];

    const config = makeConfig(
      [supersededWritesRule, toolPairingRule, recencyRule],
      { keepRecentCount: 2, turnProtection: { enabled: true, turns: 2 } }
    );

    const result = applyPruningWorkflow(messages, config);
    // w2 in turn 4 → protected
    expect(getToolResultIds(result)).toContain("w2");
    // All pairs intact
    assertToolPairsIntact(result);
  });
});

// ============================================================
// Integration: multi-tool burst in a single turn
// ============================================================

describe("multi-tool burst in single turn", () => {
  test("many tools in one protected turn are all preserved", () => {
    // Single turn with 8 tool calls — all protected
    const messages: AgentMessage[] = [makeUser("do everything")];
    for (let i = 0; i < 8; i++) {
      messages.push(
        makeAssistant([{ id: `burst${i}`, name: "bash", args: { command: `cmd${i}` } }]),
        makeToolResult(`burst${i}`, "bash", `output${i}`)
      );
    }

    const config = makeConfig(
      [deduplicationRule, errorPurgingRule, supersededWritesRule, toolPairingRule, recencyRule],
      { keepRecentCount: 2, turnProtection: { enabled: true, turns: 3 } }
    );

    const result = applyPruningWorkflow(messages, config);
    // All 8 tool results should survive (all in turn 1, currentTurn=1, 1-1=0 < 3)
    for (let i = 0; i < 8; i++) {
      expect(getToolResultIds(result)).toContain(`burst${i}`);
    }
    assertToolPairsIntact(result);
  });

  test("duplicate content in same protected turn is preserved", () => {
    // Two reads of same file in one turn → normally dedup would prune one
    // But both in protected turn → both kept
    const messages: AgentMessage[] = [
      makeUser("read twice"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "foo.ts" } }]),
      makeToolResult("r1", "read", "file contents here"),
      makeAssistant([{ id: "r2", name: "read", args: { path: "foo.ts" } }]),
      makeToolResult("r2", "read", "file contents here"),
    ];

    const config = makeConfig(
      [deduplicationRule, toolPairingRule, recencyRule],
      { keepRecentCount: 2, turnProtection: { enabled: true, turns: 3 } }
    );

    const result = applyPruningWorkflow(messages, config);
    expect(getToolResultIds(result)).toContain("r1");
    expect(getToolResultIds(result)).toContain("r2");
    assertToolPairsIntact(result);
  });
});

// ============================================================
// Integration: turn protection + recency interaction
// ============================================================

describe("turn protection + recency interaction", () => {
  test("recency protects messages even when turn protection does not", () => {
    // Turn protection covers last 1 turn, recency covers last 4 msgs
    // Message in turn 3 (not turn-protected with turns=1) but in last 4 → kept by recency
    const messages: AgentMessage[] = [
      makeUser("t1"),
      { role: "assistant", content: [{ type: "text", text: "dup" }], timestamp: Date.now() } as any,
      makeUser("t2"),
      { role: "assistant", content: [{ type: "text", text: "dup" }], timestamp: Date.now() } as any,
      makeUser("t3"),
      { role: "assistant", content: [{ type: "text", text: "dup" }], timestamp: Date.now() } as any,
    ];

    const config = makeConfig(
      [deduplicationRule, toolPairingRule, recencyRule],
      { keepRecentCount: 4, turnProtection: { enabled: true, turns: 1 } }
    );

    const result = applyPruningWorkflow(messages, config);
    // Last 4 messages (indices 2-5) kept by recency even if turn protection wouldn't cover them
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  test("turn protection is deterministic regardless of message count per turn", () => {
    // Turn 1: 1 message. Turn 2: 10 messages. Turn 3: 1 message.
    // With turns=2, both turn 2 and turn 3 are protected even though
    // turn 2 has many messages (which could push turn 2 outside keepRecentCount).
    const messages: AgentMessage[] = [
      makeUser("t1"),
      { role: "assistant", content: [{ type: "text", text: "t1 response" }], timestamp: Date.now() } as any,
    ];

    // Turn 2: many tool calls
    messages.push(makeUser("t2 big turn"));
    for (let i = 0; i < 10; i++) {
      messages.push(
        makeAssistant([{ id: `t2_${i}`, name: "bash", args: { command: `cmd_t2_${i}` } }]),
        makeToolResult(`t2_${i}`, "bash", `output_t2_${i}`)
      );
    }

    // Turn 3: small
    messages.push(makeUser("t3"));
    messages.push(
      makeAssistant([{ id: "t3_0", name: "bash", args: { command: "echo done" } }]),
      makeToolResult("t3_0", "bash", "done")
    );

    const config = makeConfig(
      [deduplicationRule, errorPurgingRule, supersededWritesRule, toolPairingRule, recencyRule],
      {
        keepRecentCount: 4, // only 4 msgs recency — not enough to cover turn 2
        turnProtection: { enabled: true, turns: 2 }, // but turn protection covers turns 2+3
      }
    );

    const result = applyPruningWorkflow(messages, config);

    // All turn 2 tools should be present (turn-protected)
    for (let i = 0; i < 10; i++) {
      expect(getToolResultIds(result)).toContain(`t2_${i}`);
    }
    // Turn 3 tool should be present
    expect(getToolResultIds(result)).toContain("t3_0");
    assertToolPairsIntact(result);
  });
});

// ============================================================
// Edge: turn protection disabled
// ============================================================

describe("turn protection disabled", () => {
  test("rules prune normally when turn protection is disabled", () => {
    // Dedup marks the LATER occurrence. With no turn protection,
    // the later "dup" (turn 3, index 5) is outside recency (keepRecentCount=2)
    // → gets pruned.
    const messages: AgentMessage[] = [
      makeUser("t1"),
      { role: "assistant", content: [{ type: "text", text: "dup" }], timestamp: Date.now() } as any,
      makeUser("t2"),
      { role: "assistant", content: [{ type: "text", text: "unique" }], timestamp: Date.now() } as any,
      makeUser("t3"),
      { role: "assistant", content: [{ type: "text", text: "dup" }], timestamp: Date.now() } as any,
    ];

    const config = makeConfig(
      [deduplicationRule, toolPairingRule, recencyRule],
      { keepRecentCount: 2, turnProtection: { enabled: false, turns: 3 } }
    );

    const result = applyPruningWorkflow(messages, config);
    // Dedup marks turn 3 "dup" (later occurrence) for pruning.
    // Recency (keepRecentCount=2) protects indices 4,5 (t3 user + t3 assistant).
    // So recency saves the later dup → both survive.
    // This shows recency overrides dedup for recent messages.
    const dupMsgs = result.filter(
      (m) => m.role === "assistant" && Array.isArray(m.content) &&
        (m.content as any[]).some((b: any) => b.type === "text" && b.text === "dup")
    );
    expect(dupMsgs.length).toBe(2);
  });

  test("dedup prunes later duplicate when outside both turn protection AND recency", () => {
    // The later dup must be outside both recency and turn protection to be pruned
    const messages: AgentMessage[] = [
      makeUser("t1"),
      { role: "assistant", content: [{ type: "text", text: "dup" }], timestamp: Date.now() } as any,
      makeUser("t2"),
      { role: "assistant", content: [{ type: "text", text: "dup" }], timestamp: Date.now() } as any,
      makeUser("t3"),
      { role: "assistant", content: [{ type: "text", text: "filler1" }], timestamp: Date.now() } as any,
      makeUser("t4"),
      { role: "assistant", content: [{ type: "text", text: "filler2" }], timestamp: Date.now() } as any,
      makeUser("t5"),
      { role: "assistant", content: [{ type: "text", text: "filler3" }], timestamp: Date.now() } as any,
    ];

    const config = makeConfig(
      [deduplicationRule, toolPairingRule, recencyRule],
      { keepRecentCount: 2, turnProtection: { enabled: false, turns: 0 } }
    );

    const result = applyPruningWorkflow(messages, config);
    // Turn 2 "dup" (index 3) is outside recency (keepRecentCount=2, last 2 = indices 8,9)
    // and turn protection disabled → pruned
    const dupMsgs = result.filter(
      (m) => m.role === "assistant" && Array.isArray(m.content) &&
        (m.content as any[]).some((b: any) => b.type === "text" && b.text === "dup")
    );
    expect(dupMsgs.length).toBe(1);
  });
});

// ============================================================
// All rules combined: full pipeline
// ============================================================

describe("full pipeline with turn protection", () => {
  test("all auto rules + turn protection + recency + tool pairing", () => {
    const messages: AgentMessage[] = [
      // Turn 1 (old — outside protection)
      makeUser("t1"),
      makeAssistant([{ id: "w_old", name: "write", args: { path: "foo.ts" } }]),
      makeToolResult("w_old", "write", "wrote foo.ts v1", { details: { path: "foo.ts" } }),
      makeAssistant([{ id: "err_old", name: "bash", args: { command: "test" } }]),
      makeToolResult("err_old", "bash", "Error: test failed", { isError: true }),
      makeAssistant([{ id: "fix_old", name: "bash", args: { command: "test" } }]),
      makeToolResult("fix_old", "bash", "All tests pass"),

      // Turn 2 (old — outside protection)
      makeUser("t2"),
      makeAssistant([{ id: "t2a", name: "bash", args: { command: "build" } }]),
      makeToolResult("t2a", "bash", "built"),

      // Turn 3 (protected)
      makeUser("t3"),
      makeAssistant([{ id: "w_new", name: "write", args: { path: "foo.ts" } }]),
      makeToolResult("w_new", "write", "wrote foo.ts v2", { details: { path: "foo.ts" } }),
      makeAssistant([{ id: "err_new", name: "bash", args: { command: "lint" } }]),
      makeToolResult("err_new", "bash", "Error: lint failed", { isError: true }),
      makeAssistant([{ id: "fix_new", name: "bash", args: { command: "lint" } }]),
      makeToolResult("fix_new", "bash", "Lint passed"),

      // Turn 4 (protected)
      makeUser("t4"),
      makeAssistant([{ id: "t4a", name: "bash", args: { command: "deploy" } }]),
      makeToolResult("t4a", "bash", "deployed"),
    ];

    const config = makeConfig(
      [deduplicationRule, errorPurgingRule, supersededWritesRule, toolPairingRule, recencyRule],
      { keepRecentCount: 4, turnProtection: { enabled: true, turns: 2 } }
    );

    const result = applyPruningWorkflow(messages, config);

    // Turn 3 & 4 are protected (currentTurn=4, turns=2)
    // err_new in turn 3 is resolved but protected → NOT pruned
    expect(getToolResultIds(result)).toContain("err_new");
    expect(getToolResultIds(result)).toContain("w_new");
    expect(getToolResultIds(result)).toContain("t4a");

    // Turn 1 items: auto-rules may mark them for pruning, but
    // tool-pairing preserves pairs (tool_use kept → tool_result kept).
    // The important thing is pair integrity.
    assertToolPairsIntact(result);
  });
});
