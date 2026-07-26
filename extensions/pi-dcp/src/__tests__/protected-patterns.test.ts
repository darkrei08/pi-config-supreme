/**
 * Tests for protected file patterns
 *
 * Covers:
 * 1. matchesFileGlob — glob matching for file paths
 * 2. getFilePathsFromToolCall — path extraction from tool parameters
 * 3. isFilePathProtected — pattern matching
 * 4. Integration with getPrunableEntries
 * 5. Integration with LLM tools (prune/distill/compress)
 * 6. Integration with auto rules (dedup, superseded-writes, error-purging)
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  matchesFileGlob,
  getFilePathsFromToolCall,
  isFilePathProtected,
} from "../protected-patterns";
import { resolveProtectedTools } from "../config";
import {
  createToolCacheState,
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

function buildConfig(
  overrides?: Partial<DcpConfigWithPruneRuleObjects>
): DcpConfigWithPruneRuleObjects {
  return {
    enabled: true,
    debug: false,
    keepRecentCount: 0,
    turnProtection: { enabled: false, turns: 0 },
    rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, toolPairingRule, recencyRule],
    resolvedProtectedTools: resolveProtectedTools(),
    ...overrides,
  };
}

function populateCache(
  state: ToolCacheState,
  entries: { id: string; name: string; params?: Record<string, any> }[]
) {
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

// ===== matchesFileGlob =====

describe("matchesFileGlob", () => {
  test("exact match", () => {
    expect(matchesFileGlob("PLAN.md", "PLAN.md")).toBe(true);
    expect(matchesFileGlob("PLAN.md", "README.md")).toBe(false);
  });

  test("* matches within a segment", () => {
    expect(matchesFileGlob("PLAN.md", "*.md")).toBe(true);
    expect(matchesFileGlob("src/PLAN.md", "*.md")).toBe(false); // * doesn't cross /
    expect(matchesFileGlob("config.json", "*.md")).toBe(false);
  });

  test("** matches across directories", () => {
    expect(matchesFileGlob("src/plans/PLAN.md", "**/PLAN.md")).toBe(true);
    expect(matchesFileGlob("PLAN.md", "**/PLAN.md")).toBe(true);
    expect(matchesFileGlob("deep/nested/dir/PLAN.md", "**/PLAN.md")).toBe(true);
  });

  test("**/ matches zero or more directories", () => {
    expect(matchesFileGlob("migrations/001.sql", "**/migrations/**")).toBe(true);
    expect(matchesFileGlob("db/migrations/001.sql", "**/migrations/**")).toBe(true);
    expect(matchesFileGlob("src/other/file.ts", "**/migrations/**")).toBe(false);
  });

  test("? matches single non-/ character", () => {
    expect(matchesFileGlob("a.ts", "?.ts")).toBe(true);
    expect(matchesFileGlob("ab.ts", "?.ts")).toBe(false);
  });

  test("normalizes backslashes", () => {
    expect(matchesFileGlob("src\\plans\\PLAN.md", "**/PLAN.md")).toBe(true);
  });

  test("empty pattern returns false", () => {
    expect(matchesFileGlob("anything", "")).toBe(false);
  });

  test("real-world patterns", () => {
    expect(matchesFileGlob("/home/user/project/PLAN.md", "**/PLAN.md")).toBe(true);
    expect(matchesFileGlob("src/db/migrations/20240101.sql", "**/migrations/*.sql")).toBe(true);
    expect(matchesFileGlob(".env", ".env")).toBe(true);
    expect(matchesFileGlob(".env.local", ".env*")).toBe(true);
    expect(matchesFileGlob("src/config/database.yml", "**/*.yml")).toBe(true);
  });
});

// ===== getFilePathsFromToolCall =====

describe("getFilePathsFromToolCall", () => {
  test("extracts path from read/write/edit", () => {
    expect(getFilePathsFromToolCall("read", { path: "/foo.ts" })).toEqual(["/foo.ts"]);
    expect(getFilePathsFromToolCall("write", { path: "/bar.ts" })).toEqual(["/bar.ts"]);
  });

  test("extracts file_path fallback", () => {
    expect(getFilePathsFromToolCall("read", { file_path: "/baz.ts" })).toEqual(["/baz.ts"]);
  });

  test("handles both path and file_path", () => {
    const result = getFilePathsFromToolCall("read", { path: "/a.ts", file_path: "/b.ts" });
    expect(result).toContain("/a.ts");
    expect(result).toContain("/b.ts");
  });

  test("deduplicates paths", () => {
    const result = getFilePathsFromToolCall("read", { path: "/foo.ts", file_path: "/foo.ts" });
    expect(result).toEqual(["/foo.ts"]);
  });

  test("edit tool with edits array", () => {
    const result = getFilePathsFromToolCall("edit", {
      path: "/main.ts",
      edits: [{ path: "/sub.ts", oldText: "a", newText: "b" }],
    });
    expect(result).toContain("/main.ts");
    expect(result).toContain("/sub.ts");
  });

  test("returns empty for bash commands", () => {
    expect(getFilePathsFromToolCall("bash", { command: "ls -la" })).toEqual([]);
  });

  test("returns empty for null/undefined params", () => {
    expect(getFilePathsFromToolCall("read", null)).toEqual([]);
    expect(getFilePathsFromToolCall("read", undefined)).toEqual([]);
  });

  test("returns empty for empty object", () => {
    expect(getFilePathsFromToolCall("read", {})).toEqual([]);
  });

  test("grep path extraction", () => {
    expect(getFilePathsFromToolCall("grep", { pattern: "foo", path: "src/" })).toEqual(["src/"]);
  });
});

// ===== isFilePathProtected =====

describe("isFilePathProtected", () => {
  test("matches single pattern", () => {
    expect(isFilePathProtected(["/project/PLAN.md"], ["**/PLAN.md"])).toBe(true);
    expect(isFilePathProtected(["/project/README.md"], ["**/PLAN.md"])).toBe(false);
  });

  test("matches any path against any pattern", () => {
    expect(
      isFilePathProtected(
        ["/project/foo.ts", "/project/PLAN.md"],
        ["**/PLAN.md"]
      )
    ).toBe(true);
  });

  test("multiple patterns", () => {
    const patterns = ["**/PLAN.md", "**/migrations/**", ".env*"];
    expect(isFilePathProtected(["/project/PLAN.md"], patterns)).toBe(true);
    expect(isFilePathProtected(["db/migrations/001.sql"], patterns)).toBe(true);
    expect(isFilePathProtected([".env.local"], patterns)).toBe(true);
    expect(isFilePathProtected(["src/app.ts"], patterns)).toBe(false);
  });

  test("empty paths returns false", () => {
    expect(isFilePathProtected([], ["**/PLAN.md"])).toBe(false);
  });

  test("empty patterns returns false", () => {
    expect(isFilePathProtected(["/project/PLAN.md"], [])).toBe(false);
  });
});

// ===== getPrunableEntries with file-path protection =====

describe("getPrunableEntries with file-path protection", () => {
  test("filters entries with protected file paths", () => {
    const state = createToolCacheState();
    populateCache(state, [
      { id: "c1", name: "read", params: { path: "/project/src/app.ts" } },
      { id: "c2", name: "read", params: { path: "/project/PLAN.md" } },
      { id: "c3", name: "bash", params: { command: "ls" } },
    ]);

    const entries = getPrunableEntries(state, [], 0, undefined, ["**/PLAN.md"]);
    const names = entries.map((e) => `${e.entry.toolName}:${e.entry.parameters.path ?? e.entry.parameters.command}`);
    expect(names).toContain("read:/project/src/app.ts");
    expect(names).toContain("bash:ls");
    expect(names).not.toContain("read:/project/PLAN.md");
  });

  test("combines tool name + file path protection", () => {
    const state = createToolCacheState();
    populateCache(state, [
      { id: "c1", name: "read", params: { path: "/project/PLAN.md" } },
      { id: "c2", name: "todo", params: { action: "list" } },
      { id: "c3", name: "read", params: { path: "/project/src/app.ts" } },
    ]);

    const entries = getPrunableEntries(state, ["todo"], 0, undefined, ["**/PLAN.md"]);
    expect(entries.length).toBe(1);
    expect(entries[0].entry.toolName).toBe("read");
    expect(entries[0].entry.parameters.path).toBe("/project/src/app.ts");
  });
});

// ===== LLM tools with file-path protection =====

describe("LLM tools with file-path protection", () => {
  test("prune skips protected file paths", () => {
    const state = createToolCacheState();
    populateCache(state, [
      { id: "c1", name: "read", params: { path: "/project/src/app.ts" } },
      { id: "c2", name: "read", params: { path: "/project/PLAN.md" } },
    ]);

    const result = executePrune(state, { ids: ["0", "1"] }, [], ["**/PLAN.md"]);
    expect(result.pruned).toBe(1);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]).toContain("protected file");
    expect(state.prunedIds.has("c1")).toBe(true);
    expect(state.prunedIds.has("c2")).toBe(false);
  });

  test("distill skips protected file paths", () => {
    const state = createToolCacheState();
    populateCache(state, [
      { id: "c1", name: "read", params: { path: "/project/src/app.ts" } },
      { id: "c2", name: "read", params: { path: "/project/PLAN.md" } },
    ]);

    const result = executeDistill(
      state,
      {
        targets: [
          { id: "0", distillation: "app code" },
          { id: "1", distillation: "plan summary" },
        ],
      },
      [],
      ["**/PLAN.md"]
    );
    expect(result.distilled).toBe(1);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]).toContain("protected file");
  });

  test("compress skips protected file paths in range", () => {
    const state = createToolCacheState();
    const summaries: CompressSummary[] = [];
    populateCache(state, [
      { id: "c1", name: "read", params: { path: "/project/src/app.ts" } },
      { id: "c2", name: "read", params: { path: "/project/PLAN.md" } },
      { id: "c3", name: "bash", params: { command: "npm test" } },
    ]);

    const result = executeCompress(
      state,
      summaries,
      { topic: "test", startId: "0", endId: "2", summary: "did stuff" },
      [],
      ["**/PLAN.md"]
    );

    expect("compressed" in result && result.compressed).toBe(2); // app.ts + bash
    expect(state.prunedIds.has("c1")).toBe(true);
    expect(state.prunedIds.has("c2")).toBe(false); // protected
    expect(state.prunedIds.has("c3")).toBe(true);
  });
});

// ===== Auto rules with file-path protection =====

describe("auto rules respect protected file patterns", () => {
  test("dedup skips reads of protected file paths", () => {
    const config = buildConfig({
      protectedFilePatterns: ["**/PLAN.md"],
    });

    // Two identical read calls to PLAN.md — earlier should NOT be pruned
    const messages: AgentMessage[] = [
      makeUser("read plan"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "/project/PLAN.md" } }]),
      makeToolResult("r1", "read", "# Plan\n..."),
      makeUser("read plan again"),
      makeAssistant([{ id: "r2", name: "read", args: { path: "/project/PLAN.md" } }]),
      makeToolResult("r2", "read", "# Plan\n..."),
      makeUser("ok"),
    ];

    const result = applyPruningWorkflow(messages, config);
    const readResults = result.filter(
      (m) => m.role === "toolResult" && (m as any).toolName === "read"
    );
    expect(readResults.length).toBe(2);
  });

  test("dedup still prunes unprotected file path duplicates", () => {
    const config = buildConfig({
      protectedFilePatterns: ["**/PLAN.md"],
    });

    // Two identical reads of app.ts — earlier should be pruned
    const messages: AgentMessage[] = [
      makeUser("read app"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "/project/src/app.ts" } }]),
      makeToolResult("r1", "read", "const x = 1;"),
      makeUser("read app again"),
      makeAssistant([{ id: "r2", name: "read", args: { path: "/project/src/app.ts" } }]),
      makeToolResult("r2", "read", "const x = 1;"),
      makeUser("ok"),
    ];

    const result = applyPruningWorkflow(messages, config);
    const readResults = result.filter(
      (m) => m.role === "toolResult" && (m as any).toolName === "read"
    );
    expect(readResults.length).toBe(1);
  });

  test("superseded-writes skips protected file paths", () => {
    const config = buildConfig({
      protectedFilePatterns: ["**/migrations/**"],
    });

    // Two writes to same migration file — earlier should NOT be pruned
    const messages: AgentMessage[] = [
      makeUser("write migration"),
      makeAssistant([{ id: "w1", name: "write", args: { path: "db/migrations/001.sql" } }]),
      makeToolResult("w1", "write", "wrote file"),
      makeUser("update migration"),
      makeAssistant([{ id: "w2", name: "write", args: { path: "db/migrations/001.sql" } }]),
      makeToolResult("w2", "write", "wrote file"),
      makeUser("ok"),
    ];

    const result = applyPruningWorkflow(messages, config);
    const writeResults = result.filter(
      (m) => m.role === "toolResult" && (m as any).toolName === "write"
    );
    expect(writeResults.length).toBe(2);
  });

  test("error-purging skips protected file path errors", () => {
    const config = buildConfig({
      protectedFilePatterns: ["**/PLAN.md"],
    });

    // Read error on PLAN.md followed by success — error should NOT be purged
    const messages: AgentMessage[] = [
      makeUser("read plan"),
      makeAssistant([{ id: "e1", name: "read", args: { path: "/project/PLAN.md" } }]),
      makeToolResult("e1", "read", "Error: file not found", true),
      makeUser("try again"),
      makeAssistant([{ id: "e2", name: "read", args: { path: "/project/PLAN.md" } }]),
      makeToolResult("e2", "read", "# Plan\n..."),
      makeUser("ok"),
    ];

    const result = applyPruningWorkflow(messages, config);
    const readResults = result.filter(
      (m) => m.role === "toolResult" && (m as any).toolName === "read"
    );
    expect(readResults.length).toBe(2);
  });

  test("no patterns → no file-path protection (normal pruning applies)", () => {
    const config = buildConfig({
      protectedFilePatterns: [],
    });

    // Two identical reads — earlier should be pruned normally
    const messages: AgentMessage[] = [
      makeUser("read"),
      makeAssistant([{ id: "r1", name: "read", args: { path: "/project/PLAN.md" } }]),
      makeToolResult("r1", "read", "# Plan\n..."),
      makeUser("read again"),
      makeAssistant([{ id: "r2", name: "read", args: { path: "/project/PLAN.md" } }]),
      makeToolResult("r2", "read", "# Plan\n..."),
      makeUser("ok"),
    ];

    const result = applyPruningWorkflow(messages, config);
    const readResults = result.filter(
      (m) => m.role === "toolResult" && (m as any).toolName === "read"
    );
    expect(readResults.length).toBe(1);
  });
});
