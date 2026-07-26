/**
 * dcp_compress tool — compress a range of tool calls into a summary
 *
 * Unlike prune/distill which target individual outputs, compress
 * removes a range of tool calls and injects a summary in their place.
 */

import { Type } from "@sinclair/typebox";
import type { ToolCacheState } from "../tool-cache";
import { isToolProtected } from "../protected-tools";
import { getFilePathsFromToolCall, isFilePathProtected } from "../protected-patterns";
import { getLogger } from "../logger";

export interface CompressSummary {
  /** Stable numeric ID for this compression (1-indexed, auto-assigned) */
  id: number;
  /** Tool call ID where the summary should be anchored */
  anchorCallId: string;
  /** The summary text */
  summary: string;
  /** Tool call IDs that were compressed */
  compressedIds: string[];
  /** Brief topic label */
  topic: string;
  /** Whether this compression is currently active (applied) */
  active: boolean;
  /** Whether the user explicitly decompressed this */
  deactivatedByUser: boolean;
  /** Timestamp when deactivated (ms epoch) */
  deactivatedAt?: number;
}

export const compressToolName = "dcp_compress";

export const compressToolDescription =
  "Compress a range of tool calls into a summary. " +
  "Provide the start and end numeric IDs from <prunable-tools> and a summary " +
  "of what was accomplished in that range. The original messages are removed " +
  "and replaced with your summary.";

export const compressToolParameters = Type.Object({
  topic: Type.String({ description: "Brief topic label for the compressed block" }),
  startId: Type.String({ description: "Numeric ID of first tool call in range" }),
  endId: Type.String({ description: "Numeric ID of last tool call in range" }),
  summary: Type.String({
    description: "Summary of what was accomplished in this range",
  }),
});

export function executeCompress(
  state: ToolCacheState,
  compressSummaries: CompressSummary[],
  params: { topic: string; startId: string; endId: string; summary: string },
  protectedTools: string[] = [],
  protectedFilePatterns: string[] = []
): { compressed: number; message: string } | { error: string } {
  const logger = getLogger();

  const startIdx = parseInt(params.startId, 10);
  const endIdx = parseInt(params.endId, 10);

  if (isNaN(startIdx) || isNaN(endIdx)) {
    return { error: "Invalid start or end ID" };
  }
  if (startIdx < 0 || endIdx >= state.idList.length) {
    return { error: `IDs out of range (0-${state.idList.length - 1})` };
  }
  if (startIdx > endIdx) {
    return { error: "Start ID must be <= end ID" };
  }

  // Collect all call IDs in range and prune them
  const compressedIds: string[] = [];
  let compressed = 0;

  for (let i = startIdx; i <= endIdx; i++) {
    const callId = state.idList[i];
    if (state.prunedIds.has(callId)) continue;

    const entry = state.cache.get(callId);
    if (!entry) continue;
    if (isToolProtected(entry.toolName, protectedTools)) continue;

    // File-path protection
    if (protectedFilePatterns.length > 0) {
      const filePaths = getFilePathsFromToolCall(entry.toolName, entry.parameters);
      if (isFilePathProtected(filePaths, protectedFilePatterns)) continue;
    }

    state.prunedIds.add(callId);
    compressedIds.push(callId);
    compressed++;
  }

  if (compressed === 0) {
    return { error: "No tool calls to compress in the given range" };
  }

  // Anchor the summary at the last compressed call ID
  const anchorCallId = compressedIds[compressedIds.length - 1];

  // Assign next available ID
  const nextId = compressSummaries.length > 0
    ? Math.max(...compressSummaries.map(s => s.id)) + 1
    : 1;

  compressSummaries.push({
    id: nextId,
    anchorCallId,
    summary: `[Compressed: ${params.topic}]\n\n${params.summary}`,
    compressedIds,
    topic: params.topic,
    active: true,
    deactivatedByUser: false,
  });

  logger.info(
    `Compressed ${compressed} tool calls (${params.startId}-${params.endId}): ${params.topic}`
  );

  return {
    compressed,
    message: `Compressed ${compressed} tool calls into summary: "${params.topic}"`,
  };
}
