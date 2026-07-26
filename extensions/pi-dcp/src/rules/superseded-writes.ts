/**
 * Superseded Writes Rule
 *
 * Removes older file write/edit operations when newer versions exist.
 * If the same file is written multiple times, only the latest write is kept.
 *
 * Resolves file paths from the assistant's toolCall arguments (not just
 * toolResult details) to handle pi's message format correctly.
 */

import type { PruneRule } from "../types";
import { extractFilePath, hashMessage, isTurnProtected, resolveToolCallInfo } from "../metadata";
import { isToolProtected } from "../protected-tools";
import { getFilePathsFromToolCall, isFilePathProtected } from "../protected-patterns";
import { getLogger } from "../logger";

export const supersededWritesRule: PruneRule = {
  name: "superseded-writes",
  description: "Remove older file writes when newer versions exist",

  prepare(msg, ctx) {
    if (msg.message.role !== "toolResult") return;

    const toolName = (msg.message as any).toolName;
    if (toolName !== "write" && toolName !== "edit") return;

    // Try extracting file path from toolResult details (legacy path)
    let filePath = extractFilePath(msg.message);

    // If not found, resolve from the paired assistant's toolCall arguments
    if (!filePath) {
      const info = resolveToolCallInfo(msg, ctx.messages);
      if (info?.arguments?.path) {
        filePath = info.arguments.path;
      }
    }

    if (filePath) {
      msg.metadata.filePath = filePath;
      msg.metadata.fileVersion = hashMessage(msg.message);

      if (ctx.config.debug) {
        getLogger().debug(
          `SupersededWrites: found file operation at index ${ctx.index}: ${filePath}`
        );
      }
    }
  },

  process(msg, ctx) {
    if (msg.metadata.shouldPrune) return;
    if (!msg.metadata.filePath) return;
    if (msg.message.role === "user") return;

    // Skip protected tools
    const toolName = (msg.message as any).toolName;
    const protectedList = ctx.config.resolvedProtectedTools?.global ?? [];
    if (toolName && isToolProtected(toolName, protectedList)) return;

    // Skip protected file paths
    const filePatterns = ctx.config.protectedFilePatterns ?? [];
    if (filePatterns.length > 0 && msg.metadata.filePath) {
      if (isFilePathProtected([msg.metadata.filePath], filePatterns)) return;
    }

    const currentTurn = ctx.messages[ctx.messages.length - 1]?.metadata.turnIndex ?? 0;
    if (isTurnProtected(msg, currentTurn, ctx.config.turnProtection)) return;

    const laterWrite = ctx.messages
      .slice(ctx.index + 1)
      .find((m) => m.metadata.filePath === msg.metadata.filePath);

    if (laterWrite) {
      msg.metadata.shouldPrune = true;
      msg.metadata.pruneReason = `superseded by later write to ${msg.metadata.filePath}`;

      if (ctx.config.debug) {
        getLogger().debug(
          `SupersededWrites: marking superseded write at index ${ctx.index}: ${msg.metadata.filePath}`
        );
      }
    }
  },
};
