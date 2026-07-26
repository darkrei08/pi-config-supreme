/**
 * Deduplication Rule
 *
 * For tool results: compares by tool signature (same tool name + same arguments).
 * Keeps the LATEST occurrence and prunes earlier ones (stale reads/results).
 *
 * For text-only messages: compares by content hash (existing behavior).
 * Keeps the FIRST occurrence and prunes later duplicates.
 */

import type { PruneRule } from "../types";
import { hashMessage, isTurnProtected, resolveToolCallInfo } from "../metadata";
import { isToolProtected } from "../protected-tools";
import { getFilePathsFromToolCall, isFilePathProtected } from "../protected-patterns";
import { getLogger } from "../logger";

export const deduplicationRule: PruneRule = {
  name: "deduplication",
  description: "Remove duplicate tool outputs and text messages",

  prepare(msg, ctx) {
    msg.metadata.hash = hashMessage(msg.message);

    // For toolResults: resolve tool signature from paired assistant
    if (msg.message.role === "toolResult") {
      const info = resolveToolCallInfo(msg, ctx.messages);
      if (info) {
        msg.metadata.toolSignature = info.signature;
        msg.metadata.pairedAssistantIndex = info.assistantIndex;
      }
    }
  },

  process(msg, ctx) {
    if (msg.metadata.shouldPrune) return;
    if (msg.message.role === "user") return;

    const currentTurn = ctx.messages[ctx.messages.length - 1]?.metadata.turnIndex ?? 0;
    if (isTurnProtected(msg, currentTurn, ctx.config.turnProtection)) return;

    // ToolResult dedup: compare by tool signature, keep LATEST (prune earlier)
    if (msg.message.role === "toolResult" && msg.metadata.toolSignature) {
      // Skip protected tools
      const toolName = (msg.message as any).toolName;
      const protectedList = ctx.config.resolvedProtectedTools?.global ?? [];
      if (toolName && isToolProtected(toolName, protectedList)) return;

      // Skip protected file paths
      const filePatterns = ctx.config.protectedFilePatterns ?? [];
      if (filePatterns.length > 0 && msg.metadata.toolSignature) {
        const info = resolveToolCallInfo(msg, ctx.messages);
        if (info?.arguments) {
          const filePaths = getFilePathsFromToolCall(info.toolName, info.arguments);
          if (isFilePathProtected(filePaths, filePatterns)) return;
        }
      }
      const laterDuplicate = ctx.messages
        .slice(ctx.index + 1)
        .some((m) => m.metadata.toolSignature === msg.metadata.toolSignature);

      if (laterDuplicate) {
        msg.metadata.shouldPrune = true;
        msg.metadata.pruneReason = `duplicate tool call (${msg.metadata.toolSignature})`;

        if (ctx.config.debug) {
          getLogger().debug(
            `Dedup: marking earlier tool result at index ${ctx.index} (sig: ${msg.metadata.toolSignature})`
          );
        }
      }
      return; // toolResult handled, skip content hash path
    }

    // Never dedup assistants with tool calls directly (cascade handles them)
    if (msg.metadata.hasToolUse) return;

    // Text message dedup: compare by content hash, keep FIRST (prune later)
    const currentHash = msg.metadata.hash;
    if (!currentHash) return;

    const seenBefore = ctx.messages
      .slice(0, ctx.index)
      .some((m) => m.metadata.hash === currentHash);

    if (seenBefore) {
      msg.metadata.shouldPrune = true;
      msg.metadata.pruneReason = "duplicate content";

      if (ctx.config.debug) {
        getLogger().debug(
          `Dedup: marking duplicate message at index ${ctx.index} (hash: ${currentHash})`
        );
      }
    }
  },
};
