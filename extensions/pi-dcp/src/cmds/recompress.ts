/**
 * DCP Recompress Command
 *
 * Re-apply a previously decompressed compression — adds its compressedIds
 * back to prunedIds so the summary replaces tool outputs again.
 */

import type { CommandDefinition } from "../types";
import type { CompressSummary } from "../tools/compress";
import type { ToolCacheState } from "../tool-cache";
import { getLogger } from "../logger";

export function createRecompressCommand(
  compressSummaries: CompressSummary[],
  toolCacheState: ToolCacheState
): CommandDefinition {
  return {
    description: "Re-apply a decompressed target (e.g., /dcp-recompress 1)",
    handler: async (args, ctx) => {
      const logger = getLogger();

      if (!args || !args.trim()) {
        // Show available user-decompressed compressions
        const decompressed = compressSummaries.filter(
          (cs) => cs.deactivatedByUser && !cs.active
        );
        if (decompressed.length === 0) {
          ctx.ui.notify("No user-decompressed compressions to re-apply.", "info");
          return;
        }

        const lines = [
          "Usage: /dcp-recompress <id>",
          "",
          "User-decompressed compressions:",
        ];
        for (const cs of decompressed) {
          lines.push(`  #${cs.id}  "${cs.topic}"  (${cs.compressedIds.length} tools)`);
        }
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      const targetId = parseInt(args.trim(), 10);
      if (isNaN(targetId)) {
        ctx.ui.notify("Invalid ID. Usage: /dcp-recompress <number>", "error");
        return;
      }

      const target = compressSummaries.find((cs) => cs.id === targetId);
      if (!target) {
        ctx.ui.notify(`Compression #${targetId} does not exist.`, "error");
        return;
      }

      if (target.active) {
        ctx.ui.notify(`Compression #${targetId} is already active.`, "info");
        return;
      }

      if (!target.deactivatedByUser) {
        ctx.ui.notify(
          `Compression #${targetId} was not user-decompressed.`,
          "error"
        );
        return;
      }

      // Validate: anchor must still exist in the tool cache
      const anchorExists = toolCacheState.cache.has(target.anchorCallId);
      if (!anchorExists) {
        ctx.ui.notify(
          `Cannot re-apply compression #${targetId}: anchor tool call no longer exists in this session (session may have been compacted).`,
          "error"
        );
        return;
      }

      // Validate: at least some origin tool calls still exist
      const existingIds = target.compressedIds.filter((id) =>
        toolCacheState.cache.has(id)
      );
      if (existingIds.length === 0) {
        ctx.ui.notify(
          `Cannot re-apply compression #${targetId}: none of the original tool calls exist in this session anymore.`,
          "error"
        );
        return;
      }

      // Re-activate: add compressedIds back to prunedIds
      let recompressed = 0;
      for (const callId of target.compressedIds) {
        if (toolCacheState.cache.has(callId)) {
          toolCacheState.prunedIds.add(callId);
          recompressed++;
        }
      }

      target.active = true;
      target.deactivatedByUser = false;
      target.deactivatedAt = undefined;

      logger.info("Recompress command completed", {
        targetId: target.id,
        topic: target.topic,
        recompressed,
      });

      ctx.ui.notify(
        `Re-applied compression #${target.id} ("${target.topic}"). ${recompressed} tool output(s) compressed again.`,
        "info"
      );
    },
  };
}
