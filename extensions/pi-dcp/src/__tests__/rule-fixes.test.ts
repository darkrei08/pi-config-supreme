/**
 * Tests for the three rule bug fixes:
 * 1. Dedup: tool signature matching (not content hash) for toolResults
 * 2. Superseded-writes: file path from toolCall arguments
 * 3. Error-purging: same-operation matching by tool signature
 */

import { describe, test, expect, beforeAll } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { applyPruningWorkflow } from "../workflow";
import {
  resolveToolCallInfo,
  createToolSignature,
  createMessageWithMetadata,
} from "../metadata";
import { registerRule } from "../registry";
import { deduplicationRule } from "../rules/deduplication";
import { errorPurgingRule } from "../rules/error-purging";
import { supersededWritesRule } from "../rules/superseded-writes";
import { toolPairingRule } from "../rules/tool-pairing";
import { recencyRule } from "../rules/recency";
import type { DcpConfigWithPruneRuleObjects } from "../types";

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
  return { role: "user", content: text, timestamp: Date.now() } as any;
}

function makeConfig(
  rules: DcpConfigWithPruneRuleObjects["rules"],
  opts?: { keepRecentCount?: number; turnProtection?: { enabled: boolean; turns: number } }
): DcpConfigWithPruneRuleObjects {
  return {
    enabled: true,
    debug: false,
    keepRecentCount: opts?.keepRecentCount ?? 2,
    turnProtection: opts?.turnProtection ?? { enabled: false, turns: 0 },
    rules,
  };
}

function getToolResultIds(msgs: AgentMessage[]): string[] {
  return msgs.filter((m) => m.role === "toolResult").map((m) => (m as any).toolCallId);
}

function getToolUseIds(msgs: AgentMessage[]): string[] {
  return msgs
    .filter((m) => m.role === "assistant" && Array.isArray(m.content))
    .flatMap((m) =>
      ((m as any).content as any[]).filter((b) => b?.type === "toolCall").map((b) => b.id)
    );
}

function assertToolPairsIntact(msgs: AgentMessage[]) {
  const useIds = new Set(getToolUseIds(msgs));
  const resultIds = new Set(getToolResultIds(msgs));
  for (const id of resultIds) expect(useIds.has(id)).toBe(true);
  for (const id of useIds) expect(resultIds.has(id)).toBe(true);
}

beforeAll(() => {
  registerRule(deduplicationRule);
  registerRule(errorPurgingRule);
  registerRule(supersededWritesRule);
  registerRule(toolPairingRule);
  registerRule(recencyRule);
});

// ============================================================
// Unit: resolveToolCallInfo / createToolSignature
// ============================================================

describe("resolveToolCallInfo", () => {
  test("resolves toolResult to its paired assistant", () => {
    const msgs = [
      makeUser("go"),
      makeAssistant([{ id: "t1", name: "read", args: { path: "foo.ts" } }]),
      makeToolResult("t1", "read", "contents"),
    ].map(createMessageWithMetadata);

    const info = resolveToolCallInfo(msgs[2], msgs);
    expect(info).not.toBeNull();
    expect(info!.assistantIndex).toBe(1);
    expect(info!.toolName).toBe("read");
    expect(info!.arguments).toEqual({ path: "foo.ts" });
    expect(info!.signature).toBe('read::{"path":"foo.ts"}');
  });

  test("returns null for non-toolResult messages", () => {
    const msgs = [makeUser("hello")].map(createMessageWithMetadata);
    expect(resolveToolCallInfo(msgs[0], msgs)).toBeNull();
  });

  test("returns null when assistant not found", () => {
    const msgs = [makeToolResult("orphan", "read", "stuff")].map(createMessageWithMetadata);
    expect(resolveToolCallInfo(msgs[0], msgs)).toBeNull();
  });
});

describe("createToolSignature", () => {
  test("same tool + same args = same signature", () => {
    expect(createToolSignature("read", { path: "a.ts" })).toBe(
      createToolSignature("read", { path: "a.ts" })
    );
  });

  test("different args = different signature", () => {
    expect(createToolSignature("read", { path: "a.ts" })).not.toBe(
      createToolSignature("read", { path: "b.ts" })
    );
  });

  test("key order doesn't matter", () => {
    expect(createToolSignature("bash", { command: "ls", timeout: 10 })).toBe(
      createToolSignature("bash", { timeout: 10, command: "ls" })
    );
  });

  test("no args = just tool name", () => {
    expect(createToolSignature("read", {})).toBe("read");
  });
});

// ============================================================
// Bug 1: Dedup now matches toolResults by tool signature
// ============================================================

describe("dedup: tool signature matching", () => {
  test("two reads of same file: earlier one pruned, later kept", () => {
    const messages: AgentMessage[] = [
      makeUser("read it"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "math.ts" } }]),
      makeToolResult("r1", "read", "old content"),
      makeUser("read again"),
      makeAssistant([{ id: "r2", name: "read", args: { path: "math.ts" } }]),
      makeToolResult("r2", "read", "new content after edit"),
    ];

    const config = makeConfig([deduplicationRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    // r1 (earlier) pruned, r2 (later) kept
    expect(getToolResultIds(result)).not.toContain("r1");
    expect(getToolResultIds(result)).toContain("r2");
    // Assistant for r1 also pruned (cascadePruneToAssistants)
    expect(getToolUseIds(result)).not.toContain("r1");
    assertToolPairsIntact(result);
  });

  test("different files are NOT deduped", () => {
    const messages: AgentMessage[] = [
      makeUser("read both"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "a.ts" } }]),
      makeToolResult("r1", "read", "content A"),
      makeAssistant([{ id: "r2", name: "read", args: { path: "b.ts" } }]),
      makeToolResult("r2", "read", "content B"),
    ];

    const config = makeConfig([deduplicationRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    expect(getToolResultIds(result)).toContain("r1");
    expect(getToolResultIds(result)).toContain("r2");
  });

  test("different tools with same args are NOT deduped", () => {
    const messages: AgentMessage[] = [
      makeUser("go"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "foo.ts" } }]),
      makeToolResult("r1", "read", "contents"),
      makeAssistant([{ id: "w1", name: "write", args: { path: "foo.ts" } }]),
      makeToolResult("w1", "write", "wrote foo.ts"),
    ];

    const config = makeConfig([deduplicationRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    expect(getToolResultIds(result)).toContain("r1");
    expect(getToolResultIds(result)).toContain("w1");
  });

  test("multi-toolCall assistant: only pruned if ALL results are deduped", () => {
    const messages: AgentMessage[] = [
      makeUser("go"),
      // Assistant with two tool calls
      makeAssistant([
        { id: "r1", name: "read", args: { path: "a.ts" } },
        { id: "r2", name: "read", args: { path: "b.ts" } },
      ]),
      makeToolResult("r1", "read", "content A"),
      makeToolResult("r2", "read", "content B"),
      makeUser("again"),
      // Later: only a.ts is re-read (not b.ts)
      makeAssistant([{ id: "r3", name: "read", args: { path: "a.ts" } }]),
      makeToolResult("r3", "read", "content A v2"),
    ];

    const config = makeConfig([deduplicationRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    // r1 has a later dup (r3), but r2 doesn't → assistant not pruned → r1 un-pruned by tool-pairing
    expect(getToolResultIds(result)).toContain("r1");
    expect(getToolResultIds(result)).toContain("r2");
    expect(getToolResultIds(result)).toContain("r3");
    assertToolPairsIntact(result);
  });

  test("three reads of same file: only latest survives", () => {
    const messages: AgentMessage[] = [
      makeUser("t1"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "x.ts" } }]),
      makeToolResult("r1", "read", "v1"),
      makeUser("t2"),
      makeAssistant([{ id: "r2", name: "read", args: { path: "x.ts" } }]),
      makeToolResult("r2", "read", "v2"),
      makeUser("t3"),
      makeAssistant([{ id: "r3", name: "read", args: { path: "x.ts" } }]),
      makeToolResult("r3", "read", "v3"),
    ];

    const config = makeConfig([deduplicationRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    expect(getToolResultIds(result)).not.toContain("r1");
    expect(getToolResultIds(result)).not.toContain("r2");
    expect(getToolResultIds(result)).toContain("r3");
    assertToolPairsIntact(result);
  });
});

// ============================================================
// Bug 2: Superseded-writes resolves filePath from toolCall args
// ============================================================

describe("superseded-writes: filePath from toolCall args", () => {
  test("edit without details.path: resolves from assistant args", () => {
    // Pi's actual format: edit toolResult has {_type: 'editInfo', summary, editLine} — no path
    const messages: AgentMessage[] = [
      makeUser("edit it"),
      makeAssistant([{ id: "e1", name: "edit", args: { path: "math.ts", edits: [] } }]),
      makeToolResult("e1", "edit", "Successfully replaced 1 block(s) in math.ts.", {
        details: { _type: "editInfo", summary: "+1 -1", editLine: 5 },
      }),
      makeUser("edit again"),
      makeAssistant([{ id: "e2", name: "edit", args: { path: "math.ts", edits: [] } }]),
      makeToolResult("e2", "edit", "Successfully replaced 1 block(s) in math.ts.", {
        details: { _type: "editInfo", summary: "+2 -1", editLine: 10 },
      }),
    ];

    const config = makeConfig([supersededWritesRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    // e1 superseded by e2
    expect(getToolResultIds(result)).not.toContain("e1");
    expect(getToolResultIds(result)).toContain("e2");
    assertToolPairsIntact(result);
  });

  test("write without details.path: resolves from assistant args", () => {
    const messages: AgentMessage[] = [
      makeUser("write"),
      makeAssistant([{ id: "w1", name: "write", args: { path: "out.ts", content: "v1" } }]),
      makeToolResult("w1", "write", "Successfully wrote out.ts"),
      makeUser("rewrite"),
      makeAssistant([{ id: "w2", name: "write", args: { path: "out.ts", content: "v2" } }]),
      makeToolResult("w2", "write", "Successfully wrote out.ts"),
    ];

    const config = makeConfig([supersededWritesRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    expect(getToolResultIds(result)).not.toContain("w1");
    expect(getToolResultIds(result)).toContain("w2");
    assertToolPairsIntact(result);
  });

  test("different files are NOT marked as superseded", () => {
    const messages: AgentMessage[] = [
      makeUser("write both"),
      makeAssistant([{ id: "w1", name: "write", args: { path: "a.ts", content: "A" } }]),
      makeToolResult("w1", "write", "wrote a.ts"),
      makeAssistant([{ id: "w2", name: "write", args: { path: "b.ts", content: "B" } }]),
      makeToolResult("w2", "write", "wrote b.ts"),
    ];

    const config = makeConfig([supersededWritesRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    expect(getToolResultIds(result)).toContain("w1");
    expect(getToolResultIds(result)).toContain("w2");
  });
});

// ============================================================
// Bug 3: Error-purging matches by tool signature
// ============================================================

describe("error-purging: signature-based matching", () => {
  test("bash error resolved by later success with same command", () => {
    const messages: AgentMessage[] = [
      makeUser("run it"),
      makeAssistant([{ id: "e1", name: "bash", args: { command: "bun test" } }]),
      makeToolResult("e1", "bash", "Error: test failed", { isError: true }),
      makeUser("try again"),
      makeAssistant([{ id: "s1", name: "bash", args: { command: "bun test" } }]),
      makeToolResult("s1", "bash", "All tests passed"),
    ];

    const config = makeConfig([errorPurgingRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    // Error resolved → e1 pruned
    expect(getToolResultIds(result)).not.toContain("e1");
    expect(getToolResultIds(result)).toContain("s1");
    assertToolPairsIntact(result);
  });

  test("bash error NOT resolved when command differs", () => {
    const messages: AgentMessage[] = [
      makeUser("run"),
      makeAssistant([{ id: "e1", name: "bash", args: { command: "bun run bad.ts" } }]),
      makeToolResult("e1", "bash", "Error: not found", { isError: true }),
      makeUser("fix"),
      makeAssistant([{ id: "s1", name: "bash", args: { command: "bun run good.ts" } }]),
      makeToolResult("s1", "bash", "Success"),
    ];

    const config = makeConfig([errorPurgingRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    // Different command → not resolved → e1 kept
    expect(getToolResultIds(result)).toContain("e1");
    expect(getToolResultIds(result)).toContain("s1");
  });

  test("read error resolved by later successful read of same file", () => {
    const messages: AgentMessage[] = [
      makeUser("read"),
      makeAssistant([{ id: "e1", name: "read", args: { path: "missing.ts" } }]),
      makeToolResult("e1", "read", "Error: file not found", { isError: true }),
      makeUser("create it then read"),
      makeAssistant([{ id: "w1", name: "write", args: { path: "missing.ts", content: "ok" } }]),
      makeToolResult("w1", "write", "wrote missing.ts"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "missing.ts" } }]),
      makeToolResult("r1", "read", "ok"),
    ];

    const config = makeConfig([errorPurgingRule, toolPairingRule, recencyRule]);
    const result = applyPruningWorkflow(messages, config);

    // Error read resolved by later successful read of same path
    expect(getToolResultIds(result)).not.toContain("e1");
    expect(getToolResultIds(result)).toContain("r1");
    assertToolPairsIntact(result);
  });
});

// ============================================================
// Integration: all three fixes + turn protection + tool pairing
// ============================================================

describe("all fixes combined: realistic session", () => {
  test("simulates the demo scenario", () => {
    // Mimics the actual demo: read, write+error, re-read, edit, read different file
    const messages: AgentMessage[] = [
      // Turn 1: read math.ts
      makeUser("Read math.ts and tell me what it exports"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "math.ts" } }]),
      makeToolResult("r1", "read", "export function greet() {} export function add() {}"),

      // Turn 2: write math.ts (add subtract) + bash error
      makeUser("Add subtract to math.ts, then run bun run nonexistent.ts"),
      makeAssistant([
        { id: "w1", name: "edit", args: { path: "math.ts", edits: [{ oldText: "}", newText: "}\nexport function subtract() {}" }] } },
        { id: "b1", name: "bash", args: { command: "bun run nonexistent.ts" } },
      ]),
      makeToolResult("w1", "edit", "Successfully replaced 1 block(s)", {
        details: { _type: "editInfo", summary: "+1", editLine: 5 },
      }),
      makeToolResult("b1", "bash", "Error: Module not found", { isError: true }),

      // Turn 3: re-read math.ts (duplicate of turn 1's read signature)
      makeUser("Read math.ts to confirm subtract is there"),
      makeAssistant([{ id: "r2", name: "read", args: { path: "math.ts" } }]),
      makeToolResult("r2", "read", "greet, add, subtract — all there"),

      // Turn 4: edit math.ts again (supersedes turn 2's write)
      makeUser("Rename subtract to minus"),
      makeAssistant([{ id: "e2", name: "edit", args: { path: "math.ts", edits: [{ oldText: "subtract", newText: "minus" }] } }]),
      makeToolResult("e2", "edit", "Successfully replaced 1 block(s)", {
        details: { _type: "editInfo", summary: "+1 -1", editLine: 5 },
      }),

      // Turn 5: read index.ts (unique)
      makeUser("Read index.ts"),
      makeAssistant([{ id: "r3", name: "read", args: { path: "index.ts" } }]),
      makeToolResult("r3", "read", "import stuff from math"),
    ];

    const config = makeConfig(
      [deduplicationRule, supersededWritesRule, errorPurgingRule, toolPairingRule, recencyRule],
      { keepRecentCount: 2, turnProtection: { enabled: true, turns: 3 } }
    );

    const result = applyPruningWorkflow(messages, config);

    // Turn 1 read(math.ts) → superseded by turn 3 read(math.ts) (dedup, outside protection)
    expect(getToolResultIds(result)).not.toContain("r1");

    // Turn 2 edit(math.ts) → superseded by turn 4 edit(math.ts)
    // But turn 2 has multi-toolCall (edit + bash). bash error is NOT resolved
    // (no later bash with same command). So the assistant has mixed pruning:
    // w1 superseded, b1 not resolved → assistant NOT cascade-pruned →
    // tool-pairing preserves w1. This is correct.

    // Turn 3 read(math.ts) → protected (5-3=2 < 3)
    expect(getToolResultIds(result)).toContain("r2");

    // Turn 4 edit → protected + latest write
    expect(getToolResultIds(result)).toContain("e2");

    // Turn 5 read(index.ts) → unique + protected
    expect(getToolResultIds(result)).toContain("r3");

    assertToolPairsIntact(result);
  });
});
