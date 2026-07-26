/**
 * DCP Context Event Handler
 *
 * Handles the 'context' event which fires before each LLM call.
 * Two-layer pruning:
 * 1. Automatic rule-based pruning (dedup, superseded writes, errors, recency)
 * 2. LLM-driven pruning (apply prune/distill/compress decisions from tool calls)
 *
 * Also injects the <prunable-tools> list and nudges into context.
 */

import type { ContextEvent, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { DcpConfigWithPruneRuleObjects, ContextLimits } from "../types";
import type { StatsTracker } from "../cmds/stats";
import type { ToolCacheState } from "../tool-cache";
import type { CompressSummary } from "../tools/compress";
import { applyPruningWorkflow } from "../workflow";
import { syncToolCache, getPrunableEntries } from "../tool-cache";
import { extractMessageText, getActiveSummaryTokens } from "../tokens";
import { extractToolUseIds, hasToolUse, hasToolResult } from "../metadata";
import {
  buildPrunableToolsList,
  NUDGE_PROMPT,
  COMPRESS_NUDGE_PROMPT,
  DUMB_ZONE_NUDGE_PROMPT,
  COOLDOWN_PROMPT,
  ITERATION_NUDGE_PROMPT,
} from "../prompts";
import { estimateContextTokens } from "../tokens";
import { getLogger } from "../logger";
import { readDumbZoneSignal, type DumbZoneSignal } from "../dumb-zone-bridge";
import { isContextOverLimits } from "../context-limits";

export interface ContextEventHandlerOptions {
  config: DcpConfigWithPruneRuleObjects;
  statsTracker: StatsTracker;
  toolCacheState: ToolCacheState;
  compressSummaries: CompressSummary[];
  /** Tracks whether the last tool call was a DCP tool (for cooldown) */
  lastToolWasDcp: { value: boolean };
  /** Counter for nudge frequency */
  nudgeCounter: { value: number };
  /** Nudge every N turns */
  nudgeFrequency: number;
  /** Counts assistant/tool turns since last user message */
  iterationCounter: { value: number };
  /** Trigger iteration nudge after this many non-user turns */
  iterationNudgeThreshold: number;
  /** Nudge placement: 'soft' targets assistant context, 'strong' targets user context */
  nudgeForce: 'soft' | 'strong';
  /** Protected tool names that can't be pruned */
  protectedTools: string[];
  /** File path patterns that can't be pruned */
  protectedFilePatterns: string[];
}

const PRUNED_REPLACEMENT =
  "[Output removed to save context - information superseded or no longer needed]";

/**
 * Creates a context event handler that applies both automatic and LLM-driven pruning.
 */
export function createContextEventHandler(options: ContextEventHandlerOptions) {
    const {
    config,
    statsTracker,
    toolCacheState,
    compressSummaries,
    lastToolWasDcp,
    nudgeCounter,
    nudgeFrequency,
    iterationCounter,
    iterationNudgeThreshold,
    nudgeForce,
    protectedTools,
  } = options;

  return async (event: ContextEvent, ctx: ExtensionContext) => {
    const logger = getLogger();

    try {
      const originalCount = event.messages.length;

      // Layer 1: Automatic rule-based pruning
      let messages = applyPruningWorkflow(event.messages, config);

      // Layer 2: Sync tool cache from current messages
      syncToolCache(toolCacheState, messages, protectedTools);

      // Layer 2: Apply LLM-driven prune/distill/compress decisions
      messages = applyLlmDrivenPruning(messages, toolCacheState, compressSummaries, logger);

      // Layer 2.5: Final safety net - fix any orphaned tool pairs from layer 2
      messages = repairOrphanedToolPairsPostPruning(messages, logger);

      // Track iteration pressure: count non-user messages since last user message.
      // If the last message is from the user, reset iteration counter.
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "user") {
        iterationCounter.value = 0;
      } else {
        iterationCounter.value++;
      }

      // Increment nudge counter BEFORE injection check (reset happens when nudge is shown)
      nudgeCounter.value++;

      // Layer 3: Inject prunable-tools list and nudges
      injectContextInfo(
        messages,
        toolCacheState,
        config,
        lastToolWasDcp,
        nudgeCounter,
        nudgeFrequency,
        iterationCounter,
        iterationNudgeThreshold,
        nudgeForce,
        protectedTools,
        compressSummaries,
        ctx,
        logger
      );

      // Update stats
      const prunedCount = originalCount - messages.length;
      statsTracker.totalPruned += prunedCount;
      statsTracker.totalProcessed += originalCount;

      logger.debug(
        `Counters: nudge=${nudgeCounter.value}/${nudgeFrequency}, iteration=${iterationCounter.value}/${iterationNudgeThreshold}`
      );

      if (config.debug) {
        ctx.ui.notify(`[pi-dcp] Pruned ${prunedCount} / ${originalCount} messages`);
      }

      return { messages };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`[pi-dcp] Error in pruning workflow: ${errorMessage}`, "error");
      logger.error("Context event error", { error: errorMessage });
      return { messages: event.messages };
    }
  };
}

/**
 * Check if an assistant message contains thinking or redacted_thinking blocks.
 * The Anthropic API forbids modifying these in the latest assistant message.
 */
function hasThinkingBlocks(msg: AgentMessage): boolean {
  if (msg.role !== "assistant" || !Array.isArray(msg.content)) return false;
  return msg.content.some(
    (block: any) => block && (block.type === "thinking" || block.type === "redacted_thinking")
  );
}

/**
 * Apply LLM-driven pruning decisions to messages.
 * Handles prune (remove/stub), distill (replace), and compress (summarize range).
 */
function applyLlmDrivenPruning(
  messages: AgentMessage[],
  state: ToolCacheState,
  compressSummaries: CompressSummary[],
  logger: ReturnType<typeof getLogger>
): AgentMessage[] {
  if (state.prunedIds.size === 0 && compressSummaries.length === 0) {
    return messages;
  }

  // Find the last assistant message - Anthropic requires thinking blocks in
  // the latest assistant message to remain completely unmodified.
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant") ?? null;

  // Build anchor map for active compress summaries only
  const summaryByAnchor = new Map<string, string>();
  for (const cs of compressSummaries) {
    if (cs.active) {
      summaryByAnchor.set(cs.anchorCallId, cs.summary);
    }
  }

  const injectedAnchors = new Set<string>();
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    // Handle tool results
    if (msg.role === "toolResult" && msg.toolCallId) {
      if (state.prunedIds.has(msg.toolCallId)) {
        const distillation = state.distillations.get(msg.toolCallId);

        if (distillation) {
          // Replace with distillation (keeps pairing intact)
          result.push({
            ...msg,
            content: [{ type: "text", text: `[Distilled]\n${distillation}` }],
          } as any);
          continue;
        }

        // Use cache entry for tool name to stay consistent with assistant-side filtering
        const cacheEntry = state.cache.get(msg.toolCallId);
        const toolName = cacheEntry?.toolName || (msg as any).toolName || "unknown";

        // Write/edit: remove entirely (file system is source of truth)
        if (toolName === "write" || toolName === "edit") {
          continue;
        }

        // Other tools: replace with stub
        result.push({
          ...msg,
          content: [{ type: "text", text: PRUNED_REPLACEMENT }],
        } as any);
        continue;
      }

      // Compress anchor: inject summary INTO the tool_result instead of
      // inserting a separate user message (which breaks tool_use/tool_result adjacency)
      const anchorSummary = summaryByAnchor.get(msg.toolCallId);
      if (anchorSummary && !injectedAnchors.has(msg.toolCallId)) {
        result.push({
          ...msg,
          content: [{ type: "text", text: `[Compressed Summary]\n${anchorSummary}` }],
        } as any);
        injectedAnchors.add(msg.toolCallId);
        continue;
      }
    }

    // Handle assistant messages - remove toolCall blocks for pruned write/edit
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const filtered = msg.content.filter((block: any) => {
        if (block.type !== "toolCall") return true;
        if (!state.prunedIds.has(block.id)) return true;

        const entry = state.cache.get(block.id);
        if (!entry) return true;
        return entry.toolName !== "write" && entry.toolName !== "edit";
      });

      if (filtered.length === 0) continue;
      if (filtered.length !== msg.content.length) {
        result.push({ ...msg, content: filtered } as any);
        continue;
      }
    }

    result.push(msg);
  }

  return result;
}

/**
 * Inject prunable-tools list and nudge prompts into context.
 * Nudge force determines target: 'strong' → last user message, 'soft' → last assistant message.
 */
function injectContextInfo(
  messages: AgentMessage[],
  state: ToolCacheState,
  config: DcpConfigWithPruneRuleObjects,
  lastToolWasDcp: { value: boolean },
  nudgeCounter: { value: number },
  nudgeFrequency: number,
  iterationCounter: { value: number },
  iterationNudgeThreshold: number,
  nudgeForce: 'soft' | 'strong',
  protectedTools: string[],
  compressSummaries: CompressSummary[],
  ctx: ExtensionContext,
  logger: ReturnType<typeof getLogger>
): void {
  const parts: string[] = [];

  if (lastToolWasDcp.value) {
    parts.push(COOLDOWN_PROMPT);
    lastToolWasDcp.value = false;
  } else {
    // Resolve model-aware thresholds
    const modelId = ctx.model?.id;
    const modelContextWindow = ctx.model?.contextWindow ?? ctx.getContextUsage()?.contextWindow;

    const totalTokens = estimateContextTokens(messages);
    const summaryTokenExtension =
      config.summaryBuffer !== false ? getActiveSummaryTokens(compressSummaries) : 0;

    const { effectiveMin, effectiveMax } = isContextOverLimits(
      totalTokens,
      config.contextLimits,
      modelId,
      modelContextWindow
    );

    // Adjust for summary buffer: extend limits by active summary tokens
    const adjustedOverMax = totalTokens > effectiveMax + summaryTokenExtension;
    const adjustedOverMin = totalTokens > effectiveMin + summaryTokenExtension;

    const isPeriodicNudge = nudgeCounter.value >= nudgeFrequency;

    // Iteration pressure: long agent-only loops get stronger nudges
    const isIterationNudge =
      iterationNudgeThreshold > 0 && iterationCounter.value >= iterationNudgeThreshold;

    // Check dumb-zone signal (optional — only fires if pi-dumb-zone is loaded)
    const dumbZoneSignal = readDumbZoneSignal();
    const isDumbZoneNudge =
      dumbZoneSignal?.inZone === true &&
      (dumbZoneSignal.severity === "danger" || dumbZoneSignal.severity === "critical");

    // Show prunable-tools list + nudge when any trigger fires
    if (adjustedOverMax || adjustedOverMin || isIterationNudge || isPeriodicNudge || isDumbZoneNudge) {
      logger.debug(
        `Nudge triggered: overMax=${adjustedOverMax}, overMin=${adjustedOverMin}, iteration=${isIterationNudge}, periodic=${isPeriodicNudge}, dumbZone=${isDumbZoneNudge}`
      );
      const entries = getPrunableEntries(state, protectedTools, 5, config.turnProtection, config.protectedFilePatterns ?? []);
      const prunableList = buildPrunableToolsList(entries);
      if (prunableList) {
        parts.push(prunableList);
      }

      if (isDumbZoneNudge) {
        // Dumb zone takes priority — most urgent nudge
        const prompt = DUMB_ZONE_NUDGE_PROMPT.replace(
          "{pct}",
          dumbZoneSignal!.utilization.toFixed(0)
        );
        parts.push(prompt);
        logger.info(
          `Dumb zone signal: ${dumbZoneSignal!.severity} at ${dumbZoneSignal!.utilization.toFixed(1)}%`
        );
      } else if (adjustedOverMax) {
        parts.push(COMPRESS_NUDGE_PROMPT);
        logger.info(
          `Context ~${totalTokens} tokens, exceeds max limit ${effectiveMax}` +
            (summaryTokenExtension > 0
              ? ` (+ ${summaryTokenExtension} summary buffer)`
              : ``)
        );
      } else if (adjustedOverMin) {
        parts.push(NUDGE_PROMPT);
        logger.info(
          `Context ~${totalTokens} tokens, exceeds min limit ${effectiveMin}` +
            (summaryTokenExtension > 0
              ? ` (+ ${summaryTokenExtension} summary buffer)`
              : ``)
        );
      } else if (isIterationNudge) {
        parts.push(ITERATION_NUDGE_PROMPT);
        logger.info(
          `Iteration nudge: ${iterationCounter.value} turns without user input (threshold: ${iterationNudgeThreshold})`
        );
      } else {
        parts.push(NUDGE_PROMPT);
      }
      nudgeCounter.value = 0;
    }
  }

  if (parts.length === 0) return;

  const combined = parts.join("\n\n");

  // Injection target priority:
  // 1. Last toolResult message (most visible during tool-use loops)
  // 2. Last user message (fallback for first turn or non-tool flows)
  // nudgeForce only matters when neither toolResult exists:
  //   'strong' → user message, 'soft' → assistant message
  const appendToMessage = (msg: any) => {
    if (typeof msg.content === "string") {
      msg.content = msg.content + "\n\n" + combined;
    } else if (Array.isArray(msg.content)) {
      msg.content = [...msg.content, { type: "text", text: combined }];
    }
  };

  // Try last toolResult first (highest visibility in tool loops)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    if (msg.role === "toolResult") {
      appendToMessage(msg);
      return;
    }
  }

  // No toolResult — fall back based on nudgeForce
  const targetRole = nudgeForce === 'soft' ? 'assistant' : 'user';

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    if (msg.role === targetRole) {
      if (targetRole === 'assistant' && hasThinkingBlocks(msg)) continue;
      appendToMessage(msg);
      return;
    }
  }

  // Final fallback: last user message
  if (targetRole !== 'user') {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any;
      if (msg.role === "user") {
        appendToMessage(msg);
        return;
      }
    }
  }
}

/**
 * Final safety net: remove orphaned tool_results and ensure every kept
 * tool_result has a corresponding tool_use in the messages.
 *
 * This runs AFTER all pruning layers (automatic + LLM-driven) to catch
 * orphans created by layer 2 that layer 1's repair couldn't anticipate.
 */
export function repairOrphanedToolPairsPostPruning(
  messages: AgentMessage[],
  logger: ReturnType<typeof getLogger>
): AgentMessage[] {
  // Build set of all tool_use IDs present in assistant messages
  const availableToolUseIds = new Set<string>();
  for (const msg of messages) {
    if (hasToolUse(msg)) {
      for (const id of extractToolUseIds(msg)) {
        availableToolUseIds.add(id);
      }
    }
  }

  // Remove orphaned tool_results (those referencing non-existent tool_uses)
  const result: AgentMessage[] = [];
  let removedCount = 0;

  for (const msg of messages) {
    if (hasToolResult(msg)) {
      const ids = extractToolUseIds(msg);
      // If this tool_result references a tool_use that doesn't exist, remove it
      if (ids.length > 0 && ids.every((id) => !availableToolUseIds.has(id))) {
        removedCount++;
        logger.debug(`Post-repair: removing orphaned tool_result (tool_use_id: ${ids.join(", ")})`);
        continue;
      }
    }
    result.push(msg);
  }

  // Also check reverse: assistant tool_uses without matching tool_results
  // Build set of all tool_result IDs
  const availableToolResultIds = new Set<string>();
  for (const msg of result) {
    if (hasToolResult(msg)) {
      for (const id of extractToolUseIds(msg)) {
        availableToolResultIds.add(id);
      }
    }
  }

  // Filter assistant messages: remove orphaned toolCall blocks
  const finalResult: AgentMessage[] = [];
  for (const msg of result) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const hasAnyToolCalls = msg.content.some((b: any) => b && b.type === "toolCall");
      if (!hasAnyToolCalls) {
        finalResult.push(msg);
        continue;
      }

      // Check if ALL toolCall blocks have matching tool_results
      const orphanedToolCalls = msg.content.filter(
        (b: any) => b && b.type === "toolCall" && b.id && !availableToolResultIds.has(b.id)
      );

      if (orphanedToolCalls.length > 0) {
        // Remove orphaned toolCall blocks
        const filtered = msg.content.filter(
          (b: any) => !(b && b.type === "toolCall" && b.id && !availableToolResultIds.has(b.id))
        );

        if (filtered.length === 0) {
          removedCount++;
          logger.debug(`Post-repair: removing assistant with only orphaned toolCalls`);
          continue;
        }

        finalResult.push({ ...msg, content: filtered } as any);
        logger.debug(
          `Post-repair: removed ${orphanedToolCalls.length} orphaned toolCall blocks from assistant`
        );
        continue;
      }
    }
    finalResult.push(msg);
  }

  if (removedCount > 0) {
    logger.info(`Post-repair: fixed ${removedCount} orphaned tool pair(s)`);
  }

  return finalResult;
}
