/**
 * Tests for configurable protected tools
 *
 * Covers:
 * 1. isToolProtected — exact match + glob patterns
 * 2. mergeProtectedTools — dedup + union
 * 3. resolveProtectedTools — defaults merged with user config
 * 4. Protection in tool-cache (getPrunableEntries)
 * 5. Protection in LLM tools (prune/distill/compress)
 * 6. Protection in auto rules (dedup, superseded-writes, error-purging)
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  isToolProtected,
  mergeProtectedTools,
  DEFAULT_PROTECTED_TOOLS,
  COMPRESS_PROTECTED_TOOLS,
} from "../protected-tools";
import { resolveProtectedTools } from "../config";
import {
  createToolCacheState,
  syncToolCache,
  getPrunableEntries,
  type ToolCacheState,
} from "../tool-cache";
import { executePrune } from "../tools/prune";
import { executeDistill } from "../tools/distill";
import { executeCompress, type CompressSummary } from "../tools/compress";
import { applyPruningWorkflow } from "../workflow";
import { registerRule } from "../registry";
import { deduplicationRule } from "../rules/deduplication";
import { supersededWritesRule } from "../rules/superseded-writes";
import { errorPurgingRule } from "../rules/error-purging";
import { toolPairingRule } from "../rules/tool-pairing";
import { recencyRule } from "../rules/recency";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { DcpConfigWithPruneRuleObjects } from "../types";

// Register rules once
beforeAll(() => {
  registerRule(deduplicationRule);
  registerRule(supersededWritesRule);
  registerRule(errorPurgingRule);
  registerRule(toolPairingRule);
  registerRule(recencyRule);
});

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
  } as any;
}

function makeToolResult(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError,
  } as any;
}

function makeUser(text: string): AgentMessage {
  return { role: "user", content: text } as any;
}

function buildConfig(overrides?: Partial<DcpConfigWithPruneRuleObjects>): DcpConfigWithPruneRuleObjects {
  return {
    enabled: true,
    debug: false,
    keepRecentCount: 2,
    turnProtection: { enabled: false, turns: 0 },
    rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, toolPairingRule, recencyRule],
    resolvedProtectedTools: resolveProtectedTools(),
    ...overrides,
  };
}

function populateCache(state: ToolCacheState, entries: { id: string; name: string; params?: Record<string, any> }[]) {
  for (const e of entries) {
    state.cache.set(e.id, {
      callId: e.id,
      toolName: e.name,
      parameters: e.params ?? {},
      tokenCount: 100,
      isError: false,
      paramKey: e.name,
      turn: 0,
    });
    state.idList.push(e.id);
  }
}

// ===== isToolProtected =====

describe("isToolProtected", () => {
  test("exact match", () => {
    expect(isToolProtected("todo", ["todo", "subagent"])).toBe(true);
    expect(isToolProtected("read", ["todo", "subagent"])).toBe(false);
  });

  test("glob * pattern", () => {
    expect(isToolProtected("subagent_resume", ["subagent*"])).toBe(true);
    expect(isToolProtected("subagent", ["subagent*"])).toBe(true);
    expect(isToolProtected("sub", ["subagent*"])).toBe(false);
  });

  test("glob ? pattern", () => {
    expect(isToolProtected("dcp_a", ["dcp_?"])).toBe(true);
    expect(isToolProtected("dcp_ab", ["dcp_?"])).toBe(false);
  });

  test("mixed exact + glob", () => {
    const patterns = ["todo", "dcp_*", "subagent?resume"];
    expect(isToolProtected("todo", patterns)).toBe(true);
    expect(isToolProtected("dcp_prune", patterns)).toBe(true);
    expect(isToolProtected("dcp_distill", patterns)).toBe(true);
    expect(isToolProtected("read", patterns)).toBe(false);
  });

  test("empty patterns", () => {
    expect(isToolProtected("todo", [])).toBe(false);
  });
});

// ===== mergeProtectedTools =====

describe("mergeProtectedTools", () => {
  test("deduplicates", () => {
    const result = mergeProtectedTools(["a", "b"], ["b", "c"]);
    expect(result.sort()).toEqual(["a", "b", "c"]);
  });

  test("empty lists", () => {
    expect(mergeProtectedTools([], [])).toEqual([]);
  });

  test("single list", () => {
    expect(mergeProtectedTools(["x"])).toEqual(["x"]);
  });
});

// ===== resolveProtectedTools =====

describe("resolveProtectedTools", () => {
  test("defaults without user config", () => {
    const resolved = resolveProtectedTools();
    // Global should have all DEFAULT_PROTECTED_TOOLS
    for (const tool of DEFAULT_PROTECTED_TOOLS) {
      expect(resolved.global).toContain(tool);
    }
    // Compress should have global + COMPRESS_PROTECTED_TOOLS
    for (const tool of COMPRESS_PROTECTED_TOOLS) {
      expect(resolved.compress).toContain(tool);
    }
    for (const tool of DEFAULT_PROTECTED_TOOLS) {
      expect(resolved.compress).toContain(tool);
    }
  });

  test("user config merges additively", () => {
    const resolved = resolveProtectedTools({
      global: ["my_custom_tool"],
      compress: ["my_compress_tool"],
    });
    expect(resolved.global).toContain("my_custom_tool");
    expect(resolved.global).toContain("dcp_prune"); // built-in still there
    expect(resolved.compress).toContain("my_compress_tool");
    expect(resolved.compress).toContain("my_custom_tool"); // global cascades
    expect(resolved.compress).toContain("write"); // built-in compress
  });

  test("user config with only global", () => {
    const resolved = resolveProtectedTools({ global: ["foo"] });
    expect(resolved.global).toContain("foo");
    expect(resolved.compress).toContain("foo"); // cascades
  });
});

// ===== getPrunableEntries with protection =====

describe("getPrunableEntries", () => {
  test("filters protected tools from prunable list", () => {
    const state = createToolCacheState();
    populateCache(state, [
      { id: "c1", name: "read" },
      { id: "c2", name: "todo" },
      { id: "c3", name: "bash" },
      { id: "c4", name: "subagent" },
    ]);

    const entries = getPrunableEntries(state, ["todo", "subagent"], 0);
    const names = entries.map((e) => e.entry.toolName);
    expect(names).toContain("read");
    expect(names).toContain("bash");
    expect(names).not.toContain("todo");
    expect(names).not.toContain("subagent");
  });

  test("glob protection in getPrunableEntries", () => {
    const state = createToolCacheState();
    populateCache(state, [
      { id: "c1", name: "read" },
      { id: "c2", name: "subagent_resume" },
      { id: "c3", name: "subagent_interrupt" },
    ]);

    const entries = getPrunableEntries(state, ["subagent*"], 0);
    const names = entries.map((e) => e.entry.toolName);
    expect(names).toEqual(["read"]);
  });
});

// ===== LLM tools protection =====

describe("LLM tool protection", () => {
  test("prune skips protected tools", () => {
    const state = createToolCacheState();
    populateCache(state, [
      { id: "c1", name: "read" },
      { id: "c2", name: "todo" },
    ]);

    const result = executePrune(state, { ids: ["0", "1"] }, ["todo"]);
    expect(result.pruned).toBe(1);
    expect(result.skipped).toContain("1 (protected: todo)");
    expect(state.prunedIds.has("c1")).toBe(true);
    expect(state.prunedIds.has("c2")).toBe(false);
  });

  test("prune respects glob protection", () => {
    const state = createToolCacheState();
    populateCache(state, [
      { id: "c1", name: "subagent_resume" },
    ]);

    const result = executePrune(state, { ids: ["0"] }, ["subagent*"]);
    expect(result.pruned).toBe(0);
    expect(result.skipped.length).toBe(1);
  });

  test("distill skips protected tools", () => {
    const state = createToolCacheState();
    populateCache(state, [
      { id: "c1", name: "read" },
      { id: "c2", name: "context_tag" },
    ]);

    const result = executeDistill(
      state,
      { targets: [
        { id: "0", distillation: "summary of read" },
        { id: "1", distillation: "summary of tag" },
      ]},
      ["context_*"]
    );
    expect(result.distilled).toBe(1);
    expect(result.skipped).toContain("1 (protected: context_tag)");
  });

  test("compress skips protected tools in range", () => {
    const state = createToolCacheState();
    const summaries: CompressSummary[] = [];
    populateCache(state, [
      { id: "c1", name: "read" },
      { id: "c2", name: "todo" },
      { id: "c3", name: "bash" },
    ]);

    const result = executeCompress(
      state,
      summaries,
      { topic: "test", startId: "0", endId: "2", summary: "did stuff" },
      ["todo"]
    );

    expect("compressed" in result && result.compressed).toBe(2); // read + bash
    expect(state.prunedIds.has("c1")).toBe(true);
    expect(state.prunedIds.has("c2")).toBe(false); // protected
    expect(state.prunedIds.has("c3")).toBe(true);
  });

  test("compress uses extended protection list", () => {
    const state = createToolCacheState();
    const summaries: CompressSummary[] = [];
    const resolved = resolveProtectedTools();

    populateCache(state, [
      { id: "c1", name: "read" },
      { id: "c2", name: "write" },
      { id: "c3", name: "edit" },
    ]);

    const result = executeCompress(
      state,
      summaries,
      { topic: "test", startId: "0", endId: "2", summary: "did stuff" },
      resolved.compress
    );

    expect("compressed" in result && result.compressed).toBe(1); // only read
    expect(state.prunedIds.has("c1")).toBe(true);
    expect(state.prunedIds.has("c2")).toBe(false); // write protected in compress
    expect(state.prunedIds.has("c3")).toBe(false); // edit protected in compress
  });
});

// ===== Auto rules protection =====

describe("auto rules respect protected tools", () => {
  test("dedup skips protected tool results", () => {
    const config = buildConfig({
      keepRecentCount: 0,
      resolvedProtectedTools: {
        global: ["todo"],
        compress: ["todo", "write", "edit"],
      },
    });

    // Two identical todo calls — earlier one should NOT be pruned
    const messages: AgentMessage[] = [
      makeUser("do stuff"),
      makeAssistant([{ id: "t1", name: "todo", args: { action: "list" } }]),
      makeToolResult("t1", "todo", "items: [...]"),
      makeUser("do more"),
      makeAssistant([{ id: "t2", name: "todo", args: { action: "list" } }]),
      makeToolResult("t2", "todo", "items: [...]"),
      makeUser("ok"),
    ];

    const result = applyPruningWorkflow(messages, config);
    // Both todo results should survive (protected from dedup)
    const todoResults = result.filter(
      (m) => m.role === "toolResult" && (m as any).toolName === "todo"
    );
    expect(todoResults.length).toBe(2);
  });

  test("dedup still prunes unprotected duplicates", () => {
    const config = buildConfig({
      keepRecentCount: 0,
      resolvedProtectedTools: {
        global: ["todo"],
        compress: ["todo"],
      },
    });

    // Two identical read calls — earlier should be pruned (not protected)
    const messages: AgentMessage[] = [
      makeUser("read file"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "/foo.ts" } }]),
      makeToolResult("r1", "read", "content..."),
      makeUser("read again"),
      makeAssistant([{ id: "r2", name: "read", args: { path: "/foo.ts" } }]),
      makeToolResult("r2", "read", "content..."),
      makeUser("ok"),
    ];

    const result = applyPruningWorkflow(messages, config);
    // Earlier read result should be pruned
    const readResults = result.filter(
      (m) => m.role === "toolResult" && (m as any).toolName === "read"
    );
    expect(readResults.length).toBe(1);
  });

  test("error-purging skips protected tool errors", () => {
    const config = buildConfig({
      keepRecentCount: 0,
      resolvedProtectedTools: {
        global: ["todo"],
        compress: ["todo"],
      },
    });

    // Todo error followed by success — error should NOT be purged
    const messages: AgentMessage[] = [
      makeUser("create todo"),
      makeAssistant([{ id: "e1", name: "todo", args: { action: "create" } }]),
      makeToolResult("e1", "todo", "Error: failed", true),
      makeUser("try again"),
      makeAssistant([{ id: "e2", name: "todo", args: { action: "create" } }]),
      makeToolResult("e2", "todo", "Created TODO-abc"),
      makeUser("ok"),
    ];

    const result = applyPruningWorkflow(messages, config);
    // Error todo result should still be present (protected)
    const todoResults = result.filter(
      (m) => m.role === "toolResult" && (m as any).toolName === "todo"
    );
    expect(todoResults.length).toBe(2);
  });

  test("superseded-writes skips protected tools", () => {
    const config = buildConfig({
      keepRecentCount: 0,
      resolvedProtectedTools: {
        global: ["write"],  // User added write to global protection
        compress: ["write", "edit"],
      },
    });

    // Two writes to same file — earlier should NOT be pruned (write protected)
    const messages: AgentMessage[] = [
      makeUser("write file"),
      makeAssistant([{ id: "w1", name: "write", args: { path: "/foo.ts" } }]),
      makeToolResult("w1", "write", "wrote file"),
      makeUser("write again"),
      makeAssistant([{ id: "w2", name: "write", args: { path: "/foo.ts" } }]),
      makeToolResult("w2", "write", "wrote file"),
      makeUser("ok"),
    ];

    const result = applyPruningWorkflow(messages, config);
    const writeResults = result.filter(
      (m) => m.role === "toolResult" && (m as any).toolName === "write"
    );
    expect(writeResults.length).toBe(2);
  });
});
