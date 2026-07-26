/**
 * DCP Decompress Command
 *
 * Temporarily restore a compression — removes its compressedIds from prunedIds
 * so the original tool outputs reappear in context.
 */

import type { CommandDefinition } from "../types";
import type { CompressSummary } from "../tools/compress";
import type { ToolCacheState } from "../tool-cache";
import { getLogger } from "../logger";

export function createDecompressCommand(
  compressSummaries: CompressSummary[],
  toolCacheState: ToolCacheState
): CommandDefinition {
  return {
    description: "Restore a compression target (e.g., /dcp-decompress 1)",
    handler: async (args, ctx) => {
      const logger = getLogger();

      if (!args || !args.trim()) {
        // Show available active compressions
        const active = compressSummaries.filter((cs) => cs.active);
        if (active.length === 0) {
          ctx.ui.notify("No active compressions to restore.", "info");
          return;
        }

        const lines = ["Usage: /dcp-decompress <id>", "", "Active compressions:"];
        for (const cs of active) {
          lines.push(`  #${cs.id}  "${cs.topic}"  (${cs.compressedIds.length} tools)`);
        }
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      const targetId = parseInt(args.trim(), 10);
      if (isNaN(targetId)) {
        ctx.ui.notify("Invalid ID. Usage: /dcp-decompress <number>", "error");
        return;
      }

      const target = compressSummaries.find((cs) => cs.id === targetId);
      if (!target) {
        ctx.ui.notify(`Compression #${targetId} does not exist.`, "error");
        return;
      }

      if (!target.active) {
        ctx.ui.notify(
          target.deactivatedByUser
            ? `Compression #${targetId} is already decompressed.`
            : `Compression #${targetId} is not active.`,
          "error"
        );
        return;
      }

      // Deactivate: remove compressedIds from prunedIds
      let restored = 0;
      for (const callId of target.compressedIds) {
        // Only remove from prunedIds if no OTHER active compression also claims this ID
        const claimedByOther = compressSummaries.some(
          (cs) => cs.id !== target.id && cs.active && cs.compressedIds.includes(callId)
        );
        if (!claimedByOther) {
          toolCacheState.prunedIds.delete(callId);
          restored++;
        }
      }

      target.active = false;
      target.deactivatedByUser = true;
      target.deactivatedAt = Date.now();

      logger.info("Decompress command completed", {
        targetId: target.id,
        topic: target.topic,
        restored,
      });

      ctx.ui.notify(
        `Restored compression #${target.id} ("${target.topic}"). ${restored} tool output(s) will reappear in context.`,
        "info"
      );
    },
  };
}
