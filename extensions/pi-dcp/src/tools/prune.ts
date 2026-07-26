/**
 * dcp_prune tool — LLM-callable tool to remove tool outputs from context
 *
 * The LLM references tool calls by numeric ID (from <prunable-tools> list).
 * These IDs map to actual tool call IDs via the tool cache.
 */

import { Type } from "@sinclair/typebox";
import type { ToolCacheState } from "../tool-cache";
import { isToolProtected } from "../protected-tools";
import { getFilePathsFromToolCall, isFilePathProtected } from "../protected-patterns";
import { getLogger } from "../logger";

export const pruneToolName = "dcp_prune";

export const pruneToolDescription =
  "Remove tool outputs from context that are no longer needed. " +
  "Reference tools by their numeric ID from the <prunable-tools> list. " +
  "Use this for old file reads, resolved errors, redundant listings, etc.";

export const pruneToolParameters = Type.Object({
  ids: Type.Array(Type.String(), {
    description: "Numeric IDs from <prunable-tools> list (e.g. ['3', '7', '12'])",
  }),
});

export function executePrune(
  state: ToolCacheState,
  params: { ids: string[] },
  protectedTools: string[] = [],
  protectedFilePatterns: string[] = []
): { pruned: number; skipped: string[]; message: string } {
  const logger = getLogger();
  let pruned = 0;
  const skipped: string[] = [];

  for (const idStr of params.ids) {
    const numericId = parseInt(idStr, 10);
    if (isNaN(numericId) || numericId < 0 || numericId >= state.idList.length) {
      skipped.push(`${idStr} (invalid ID)`);
      continue;
    }

    const callId = state.idList[numericId];
    if (state.prunedIds.has(callId)) {
      skipped.push(`${idStr} (already pruned)`);
      continue;
    }

    const entry = state.cache.get(callId);
    if (!entry) {
      skipped.push(`${idStr} (not found)`);
      continue;
    }

    if (isToolProtected(entry.toolName, protectedTools)) {
      skipped.push(`${idStr} (protected: ${entry.toolName})`);
      continue;
    }

    // File-path protection
    if (protectedFilePatterns.length > 0) {
      const filePaths = getFilePathsFromToolCall(entry.toolName, entry.parameters);
      if (isFilePathProtected(filePaths, protectedFilePatterns)) {
        skipped.push(`${idStr} (protected file: ${filePaths.join(", ")})`);
        continue;
      }
    }

    state.prunedIds.add(callId);
    pruned++;
    logger.info(`Pruned tool call ${numericId}: ${entry.toolName}(${entry.paramKey})`);
  }

  const parts: string[] = [`Pruned ${pruned} tool output(s).`];
  if (skipped.length > 0) {
    parts.push(`Skipped: ${skipped.join(", ")}`);
  }

  return { pruned, skipped, message: parts.join(" ") };
}
