/**
 * Error Purging Rule
 *
 * Removes resolved errors from context.
 * If an error is followed by a successful retry of the same operation
 * (same tool name + same arguments), the error can be pruned.
 *
 * Uses tool signature matching (from assistant toolCall arguments) for
 * toolResult errors, and content-based matching for other error types.
 */

import type { PruneRule } from "../types";
import {
  isErrorMessage,
  isSameOperation,
  isTurnProtected,
  resolveToolCallInfo,
} from "../metadata";
import { isToolProtected } from "../protected-tools";
import { getFilePathsFromToolCall, isFilePathProtected } from "../protected-patterns";
import { getLogger } from "../logger";

export const errorPurgingRule: PruneRule = {
  name: "error-purging",
  description: "Remove resolved errors from context",

  prepare(msg, ctx) {
    const isError = isErrorMessage(msg.message);
    msg.metadata.isError = isError;

    if (!isError) return;

    if (msg.message.role === "toolResult") {
      // For tool errors: resolve signature and match by it
      const errorInfo = resolveToolCallInfo(msg, ctx.messages);
      if (errorInfo) {
        const laterSuccess = ctx.messages.slice(ctx.index + 1).find((m) => {
          if (m.message.role !== "toolResult") return false;
          if (isErrorMessage(m.message)) return false;
          const successInfo = resolveToolCallInfo(m, ctx.messages);
          return successInfo?.signature === errorInfo.signature;
        });

        msg.metadata.errorResolved = !!laterSuccess;

        if (ctx.config.debug && laterSuccess) {
          getLogger().debug(
            `ErrorPurging: resolved error at index ${ctx.index} (sig: ${errorInfo.signature})`
          );
        }
      }
    } else {
      // For non-tool errors: fall back to content-based matching
      const laterSuccess = ctx.messages
        .slice(ctx.index + 1)
        .find((m) => isSameOperation(m.message, msg.message) && !isErrorMessage(m.message));

      msg.metadata.errorResolved = !!laterSuccess;

      if (ctx.config.debug && laterSuccess) {
        getLogger().debug(`ErrorPurging: found resolved error at index ${ctx.index}`);
      }
    }
  },

  process(msg, ctx) {
    if (msg.metadata.shouldPrune) return;
    if (msg.message.role === "user") return;

    // Skip protected tools
    const toolName = (msg.message as any).toolName;
    const protectedList = ctx.config.resolvedProtectedTools?.global ?? [];
    if (toolName && isToolProtected(toolName, protectedList)) return;

    // Skip protected file paths
    const filePatterns = ctx.config.protectedFilePatterns ?? [];
    if (filePatterns.length > 0 && msg.message.role === "toolResult") {
      const info = resolveToolCallInfo(msg, ctx.messages);
      if (info?.arguments) {
        const filePaths = getFilePathsFromToolCall(info.toolName, info.arguments);
        if (isFilePathProtected(filePaths, filePatterns)) return;
      }
    }

    const currentTurn = ctx.messages[ctx.messages.length - 1]?.metadata.turnIndex ?? 0;
    if (isTurnProtected(msg, currentTurn, ctx.config.turnProtection)) return;

    if (msg.metadata.isError && msg.metadata.errorResolved) {
      msg.metadata.shouldPrune = true;
      msg.metadata.pruneReason = "error resolved by later success";

      if (ctx.config.debug) {
        getLogger().debug(`ErrorPurging: marking resolved error at index ${ctx.index}`);
      }
    }
  },
};
