/**
 * Tests for decompress / recompress workflow
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createToolCacheState, syncToolCache, type ToolCacheState } from "../src/tool-cache";
import { executeCompress, type CompressSummary } from "../src/tools/compress";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";

function assistant(
  text: string,
  toolCalls: { id: string; name: string; args?: Record<string, any> }[] = []
): AssistantMessage {
  const content: AssistantMessage["content"] = [{ type: "text", text }];
  for (const tc of toolCalls) {
    content.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: tc.args ?? {} });
  }
  return {
    role: "assistant",
    content,
    api: "anthropic",
    provider: "anthropic",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: toolCalls.length ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

function toolResult(callId: string, toolName: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

function setupState(): { state: ToolCacheState; summaries: CompressSummary[] } {
  const state = createToolCacheState();
  const messages: AgentMessage[] = [
    assistant("read a", [{ id: "toolu_0", name: "read", args: { path: "a.txt" } }]),
    toolResult("toolu_0", "read", "aaaa"),
    assistant("read b", [{ id: "toolu_1", name: "read", args: { path: "b.txt" } }]),
    toolResult("toolu_1", "read", "bbbb"),
    assistant("write c", [{ id: "toolu_2", name: "write", args: { path: "c.txt" } }]),
    toolResult("toolu_2", "write", "done"),
    assistant("bash", [{ id: "toolu_3", name: "bash", args: { command: "ls" } }]),
    toolResult("toolu_3", "bash", "a.txt\nb.txt\nc.txt"),
  ];
  syncToolCache(state, messages);
  return { state, summaries: [] };
}

function compressRange(
  state: ToolCacheState,
  summaries: CompressSummary[],
  startId: string,
  endId: string,
  topic: string
) {
  return executeCompress(state, summaries, {
    topic,
    startId,
    endId,
    summary: `Compressed ${topic}`,
  });
}

describe("CompressSummary metadata", () => {
  test("compress assigns stable IDs", () => {
    const { state, summaries } = setupState();

    compressRange(state, summaries, "0", "1", "file reads");
    expect(summaries[0].id).toBe(1);
    expect(summaries[0].active).toBe(true);
    expect(summaries[0].deactivatedByUser).toBe(false);
    expect(summaries[0].topic).toBe("file reads");

    compressRange(state, summaries, "2", "3", "file ops");
    expect(summaries[1].id).toBe(2);
  });

  test("IDs are monotonically increasing", () => {
    const { state, summaries } = setupState();

    compressRange(state, summaries, "0", "0", "first");
    compressRange(state, summaries, "1", "1", "second");
    compressRange(state, summaries, "2", "2", "third");

    expect(summaries.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

describe("decompress", () => {
  test("deactivating a compression removes its IDs from prunedIds", () => {
    const { state, summaries } = setupState();
    compressRange(state, summaries, "0", "1", "file reads");

    expect(state.prunedIds.has("toolu_0")).toBe(true);
    expect(state.prunedIds.has("toolu_1")).toBe(true);

    // Simulate what the decompress command does
    const target = summaries[0];
    for (const callId of target.compressedIds) {
      state.prunedIds.delete(callId);
    }
    target.active = false;
    target.deactivatedByUser = true;
    target.deactivatedAt = Date.now();

    expect(state.prunedIds.has("toolu_0")).toBe(false);
    expect(state.prunedIds.has("toolu_1")).toBe(false);
    expect(target.active).toBe(false);
    expect(target.deactivatedByUser).toBe(true);
    expect(target.deactivatedAt).toBeDefined();
  });

  test("decompress respects overlapping compressions", () => {
    const { state, summaries } = setupState();

    // Compress ranges that overlap at toolu_1
    // First: 0-1
    compressRange(state, summaries, "0", "1", "first");
    // toolu_0 and toolu_1 are now pruned

    // Manually create a second summary that also includes toolu_1
    // (this simulates overlapping compressions)
    summaries.push({
      id: 2,
      anchorCallId: "toolu_1",
      summary: "second summary",
      compressedIds: ["toolu_1"],
      topic: "second",
      active: true,
      deactivatedByUser: false,
    });
    state.prunedIds.add("toolu_1");

    // Decompress first — toolu_1 should stay pruned because second still claims it
    const target = summaries[0];
    for (const callId of target.compressedIds) {
      const claimedByOther = summaries.some(
        (cs) => cs.id !== target.id && cs.active && cs.compressedIds.includes(callId)
      );
      if (!claimedByOther) {
        state.prunedIds.delete(callId);
      }
    }
    target.active = false;
    target.deactivatedByUser = true;

    expect(state.prunedIds.has("toolu_0")).toBe(false); // Only in first
    expect(state.prunedIds.has("toolu_1")).toBe(true); // Still in second
  });
});

describe("recompress", () => {
  test("reactivating a compression re-adds its IDs to prunedIds", () => {
    const { state, summaries } = setupState();
    compressRange(state, summaries, "0", "1", "file reads");

    // Decompress
    const target = summaries[0];
    for (const callId of target.compressedIds) {
      state.prunedIds.delete(callId);
    }
    target.active = false;
    target.deactivatedByUser = true;

    // Recompress
    for (const callId of target.compressedIds) {
      if (state.cache.has(callId)) {
        state.prunedIds.add(callId);
      }
    }
    target.active = true;
    target.deactivatedByUser = false;
    target.deactivatedAt = undefined;

    expect(state.prunedIds.has("toolu_0")).toBe(true);
    expect(state.prunedIds.has("toolu_1")).toBe(true);
    expect(target.active).toBe(true);
    expect(target.deactivatedByUser).toBe(false);
    expect(target.deactivatedAt).toBeUndefined();
  });

  test("recompress fails if origin tool calls are gone", () => {
    const { state, summaries } = setupState();
    compressRange(state, summaries, "0", "1", "file reads");

    // Decompress
    const target = summaries[0];
    for (const callId of target.compressedIds) {
      state.prunedIds.delete(callId);
    }
    target.active = false;
    target.deactivatedByUser = true;

    // Clear cache (simulates session compact)
    state.cache.clear();

    // Try recompress — no IDs exist
    const existingIds = target.compressedIds.filter((id) => state.cache.has(id));
    expect(existingIds.length).toBe(0);
  });

  test("recompress only re-adds IDs that still exist in cache", () => {
    const { state, summaries } = setupState();
    compressRange(state, summaries, "0", "1", "file reads");

    // Decompress
    const target = summaries[0];
    for (const callId of target.compressedIds) {
      state.prunedIds.delete(callId);
    }
    target.active = false;
    target.deactivatedByUser = true;

    // Remove one from cache
    state.cache.delete("toolu_0");

    // Recompress — only toolu_1 should be re-added
    let recompressed = 0;
    for (const callId of target.compressedIds) {
      if (state.cache.has(callId)) {
        state.prunedIds.add(callId);
        recompressed++;
      }
    }

    expect(recompressed).toBe(1);
    expect(state.prunedIds.has("toolu_0")).toBe(false);
    expect(state.prunedIds.has("toolu_1")).toBe(true);
  });
});

describe("context event respects active flag", () => {
  test("inactive compressions do not contribute to summaryByAnchor", () => {
    const summaries: CompressSummary[] = [
      {
        id: 1,
        anchorCallId: "toolu_0",
        summary: "test summary",
        compressedIds: ["toolu_0"],
        topic: "test",
        active: false,
        deactivatedByUser: true,
      },
      {
        id: 2,
        anchorCallId: "toolu_1",
        summary: "active summary",
        compressedIds: ["toolu_1"],
        topic: "active",
        active: true,
        deactivatedByUser: false,
      },
    ];

    // Simulate context event logic
    const summaryByAnchor = new Map<string, string>();
    for (const cs of summaries) {
      if (cs.active) {
        summaryByAnchor.set(cs.anchorCallId, cs.summary);
      }
    }

    expect(summaryByAnchor.has("toolu_0")).toBe(false);
    expect(summaryByAnchor.has("toolu_1")).toBe(true);
  });
});

describe("session restore backwards compatibility", () => {
  test("old summaries without new fields get defaults", () => {
    // Simulate old format
    const oldData = {
      anchorCallId: "toolu_0",
      summary: "old summary",
      compressedIds: ["toolu_0"],
    } as any;

    // Apply defaults like session_start does
    const restored: CompressSummary = {
      id: oldData.id ?? 0,
      anchorCallId: oldData.anchorCallId,
      summary: oldData.summary,
      compressedIds: oldData.compressedIds,
      topic: oldData.topic ?? "",
      active: oldData.active ?? true,
      deactivatedByUser: oldData.deactivatedByUser ?? false,
      deactivatedAt: oldData.deactivatedAt,
    };

    expect(restored.id).toBe(0); // Will be reassigned
    expect(restored.active).toBe(true);
    expect(restored.deactivatedByUser).toBe(false);
    expect(restored.topic).toBe("");
  });

  test("ID reassignment for legacy summaries", () => {
    const summaries: CompressSummary[] = [
      {
        id: 0,
        anchorCallId: "a",
        summary: "s1",
        compressedIds: ["a"],
        topic: "",
        active: true,
        deactivatedByUser: false,
      },
      {
        id: 3,
        anchorCallId: "b",
        summary: "s2",
        compressedIds: ["b"],
        topic: "t",
        active: true,
        deactivatedByUser: false,
      },
      {
        id: 0,
        anchorCallId: "c",
        summary: "s3",
        compressedIds: ["c"],
        topic: "",
        active: true,
        deactivatedByUser: false,
      },
    ];

    // Simulate the ID reassignment logic from session_start
    let maxId = 0;
    for (const s of summaries) {
      if (s.id > maxId) maxId = s.id;
    }
    for (const s of summaries) {
      if (s.id === 0) s.id = ++maxId;
    }

    expect(summaries[0].id).toBe(4);
    expect(summaries[1].id).toBe(3);
    expect(summaries[2].id).toBe(5);
  });
});
