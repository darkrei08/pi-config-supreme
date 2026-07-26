import { describe, it, expect } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ContextEvent, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import type { StatsTracker } from "../src/cmds/stats";
import { createContextEventHandler } from "../src/events/context";
import { createToolCacheState, type ToolCacheState } from "../src/tool-cache";
import type { CompressSummary } from "../src/tools/compress";
import { ITERATION_NUDGE_PROMPT, NUDGE_PROMPT, COMPRESS_NUDGE_PROMPT } from "../src/prompts";

// ── helpers ──────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<DcpConfigWithPruneRuleObjects>): DcpConfigWithPruneRuleObjects {
  return {
    enabled: true,
    debug: false,
    rules: [],
    keepRecentCount: 2,
    turnProtection: { enabled: false, turns: 0 },
    summaryBuffer: false,
    contextLimits: { min: 999_999, max: 999_999 }, // keep limits high so they don't trigger
    protectedTools: { global: [], compress: [] },
    protectedFilePatterns: [],
    ...overrides,
  };
}

function userMsg(text: string): AgentMessage {
  return { role: "user", content: text } as any;
}

function assistantMsg(text: string): AgentMessage {
  return { role: "assistant", content: [{ type: "text", text }] } as any;
}

function toolResultMsg(callId: string, text: string): AgentMessage {
  return { role: "toolResult", toolCallId: callId, content: [{ type: "text", text }] } as any;
}

function assistantWithToolCall(callId: string, toolName: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name: toolName, input: {} }],
  } as any;
}

function makeMockCtx(): ExtensionContext {
  return {
    model: { id: "test-model", contextWindow: 200_000 },
    getContextUsage: () => ({ contextWindow: 200_000 }),
    ui: { notify: () => {} },
  } as any;
}

function makeOptions(overrides?: Record<string, any>) {
  const config = makeConfig(overrides?.configOverrides);
  const toolCacheState: ToolCacheState = createToolCacheState();
  const compressSummaries: CompressSummary[] = [];
  const statsTracker: StatsTracker = { totalPruned: 0, totalProcessed: 0 };

  return {
    config,
    statsTracker,
    toolCacheState,
    compressSummaries,
    lastToolWasDcp: { value: false },
    nudgeCounter: { value: 0 },
    nudgeFrequency: overrides?.nudgeFrequency ?? 100, // high so periodic doesn't fire
    iterationCounter: { value: overrides?.iterationCounterValue ?? 0 },
    iterationNudgeThreshold: overrides?.iterationNudgeThreshold ?? 5,
    nudgeForce: (overrides?.nudgeForce ?? "strong") as "soft" | "strong",
    protectedTools: [] as string[],
    protectedFilePatterns: [] as string[],
  };
}

function getInjectedText(messages: AgentMessage[]): string {
  // Check all messages for injected nudge text (toolResult first, then user, then assistant)
  const allText: string[] = [];
  for (const msg of messages) {
    const m = msg as any;
    if (typeof m.content === "string") {
      allText.push(m.content);
    } else if (Array.isArray(m.content)) {
      allText.push(...m.content.map((b: any) => b.text ?? ""));
    }
  }
  return allText.join("\n");
}

function getTextFromRole(messages: AgentMessage[], role: string): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    if (msg.role === role) {
      if (typeof msg.content === "string") return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content.map((b: any) => b.text ?? "").join("\n");
      }
    }
  }
  return "";
}

// ── tests ────────────────────────────────────────────────────────

describe("iteration nudge", () => {
  it("triggers iteration nudge when counter >= threshold", async () => {
    const opts = makeOptions({ iterationCounterValue: 0, iterationNudgeThreshold: 3 });
    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    // Simulate messages: user, then 4 assistant/tool turns (no user)
    const messages: AgentMessage[] = [
      userMsg("do a thing"),
      assistantWithToolCall("tc1", "bash"),
      toolResultMsg("tc1", "output1"),
      assistantWithToolCall("tc2", "bash"),
      toolResultMsg("tc2", "output2"),
      assistantWithToolCall("tc3", "read"),
      toolResultMsg("tc3", "output3"),
      assistantMsg("still working..."),
    ];

    // Set iteration counter above threshold (simulating accumulated turns)
    opts.iterationCounter.value = 5;

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const injected = getInjectedText(result.messages);

    expect(injected).toContain("iterating for a while");
  });

  it("does NOT trigger iteration nudge when counter < threshold", async () => {
    const opts = makeOptions({ iterationCounterValue: 0, iterationNudgeThreshold: 10 });
    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    const messages: AgentMessage[] = [
      userMsg("do something"),
      assistantMsg("ok done"),
    ];

    // Counter well below threshold
    opts.iterationCounter.value = 3;

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const injected = getInjectedText(result.messages);

    expect(injected).not.toContain("iterating for a while");
  });

  it("resets iteration counter when last message is user", async () => {
    const opts = makeOptions({ iterationNudgeThreshold: 3 });
    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    // Counter was high from previous loop
    opts.iterationCounter.value = 10;

    const messages: AgentMessage[] = [
      userMsg("first message"),
      assistantMsg("response"),
      userMsg("new user message"), // last msg is user → reset
    ];

    await handler({ messages: [...messages] } as ContextEvent, ctx);

    // Counter should be reset to 0 because last message is user
    expect(opts.iterationCounter.value).toBe(0);
  });

  it("increments iteration counter when last message is not user", async () => {
    const opts = makeOptions({ iterationNudgeThreshold: 100 }); // high threshold
    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    opts.iterationCounter.value = 5;

    const messages: AgentMessage[] = [
      userMsg("do something"),
      assistantMsg("working on it"),
    ];

    await handler({ messages: [...messages] } as ContextEvent, ctx);

    // Counter should have incremented (last msg is assistant, not user)
    expect(opts.iterationCounter.value).toBe(6);
  });

  it("overMin nudge takes priority over iteration nudge", async () => {
    const opts = makeOptions({
      iterationNudgeThreshold: 3,
      configOverrides: {
        contextLimits: { min: 1, max: 999_999 }, // min=1 → always overMin
        summaryBuffer: false,
      },
    });
    opts.iterationCounter.value = 10; // above threshold

    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    const messages: AgentMessage[] = [
      userMsg("do something"),
      assistantMsg("working on it"),
    ];

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const injected = getInjectedText(result.messages);

    // overMin produces NUDGE_PROMPT, not iteration nudge
    expect(injected).toContain("stale or superseded");
    expect(injected).not.toContain("iterating for a while");
  });

  it("overMax nudge takes priority over iteration nudge", async () => {
    const opts = makeOptions({
      iterationNudgeThreshold: 3,
      configOverrides: {
        contextLimits: { min: 1, max: 1 }, // max=1 → always overMax
        summaryBuffer: false,
      },
    });
    opts.iterationCounter.value = 10;

    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    const messages: AgentMessage[] = [
      userMsg("do something"),
      assistantMsg("working on it"),
    ];

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const injected = getInjectedText(result.messages);

    // overMax produces COMPRESS_NUDGE_PROMPT
    expect(injected).toContain("Context is getting large");
    expect(injected).not.toContain("iterating for a while");
  });

  it("iteration nudge takes priority over periodic nudge", async () => {
    const opts = makeOptions({
      iterationNudgeThreshold: 3,
      nudgeFrequency: 1, // periodic would fire too
    });
    opts.iterationCounter.value = 10;
    opts.nudgeCounter.value = 5; // above nudgeFrequency

    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    const messages: AgentMessage[] = [
      userMsg("do something"),
      assistantMsg("working"),
    ];

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const injected = getInjectedText(result.messages);

    // Iteration nudge should win over periodic
    expect(injected).toContain("iterating for a while");
  });

  it("disabled when iterationNudgeThreshold is 0", async () => {
    const opts = makeOptions({ iterationNudgeThreshold: 0 });
    opts.iterationCounter.value = 999;

    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    const messages: AgentMessage[] = [
      userMsg("hi"),
      assistantMsg("hello"),
    ];

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const injected = getInjectedText(result.messages);

    expect(injected).not.toContain("iterating for a while");
  });
});

describe("nudgeForce", () => {
  it("injects into last toolResult when available (regardless of nudgeForce)", async () => {
    const opts = makeOptions({
      nudgeForce: "strong",
      nudgeFrequency: 1,
    });
    opts.nudgeCounter.value = 2;

    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    const messages: AgentMessage[] = [
      userMsg("do something"),
      assistantWithToolCall("tc1", "bash"),
      toolResultMsg("tc1", "output here"),
    ];

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const toolText = getTextFromRole(result.messages, "toolResult");
    const userText = getTextFromRole(result.messages, "user");

    expect(toolText).toContain("dcp-nudge");
    expect(userText).not.toContain("dcp-nudge");
  });

  it("'strong' falls back to user message when no toolResult", async () => {
    const opts = makeOptions({
      nudgeForce: "strong",
      nudgeFrequency: 1,
    });
    opts.nudgeCounter.value = 2;

    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    const messages: AgentMessage[] = [
      userMsg("first message only"),
    ];

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const userText = getTextFromRole(result.messages, "user");

    expect(userText).toContain("dcp-nudge");
  });

  it("'soft' falls back to assistant message when no toolResult", async () => {
    const opts = makeOptions({
      nudgeForce: "soft",
      nudgeFrequency: 1,
    });
    opts.nudgeCounter.value = 2;

    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    const messages: AgentMessage[] = [
      userMsg("do something"),
      assistantMsg("ok"),
    ];

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const assistantText = getTextFromRole(result.messages, "assistant");

    expect(assistantText).toContain("dcp-nudge");
  });

  it("'soft' falls back to user message if no assistant or toolResult", async () => {
    const opts = makeOptions({
      nudgeForce: "soft",
      nudgeFrequency: 1,
    });
    opts.nudgeCounter.value = 2;

    const handler = createContextEventHandler(opts);
    const ctx = makeMockCtx();

    const messages: AgentMessage[] = [
      userMsg("first message only"),
    ];

    const result = await handler({ messages: [...messages] } as ContextEvent, ctx);
    const userText = getTextFromRole(result.messages, "user");

    expect(userText).toContain("dcp-nudge");
  });
});
