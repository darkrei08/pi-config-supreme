/**
 * DCP Compressions Command
 *
 * List all compression summaries with their status.
 */

import type { CommandDefinition } from "../types";
import type { CompressSummary } from "../tools/compress";
import { countTokens } from "../tokens";

export function createCompressionsCommand(
  compressSummaries: CompressSummary[]
): CommandDefinition {
  return {
    description: "List all compression targets and their status",
    handler: async (_args, ctx) => {
      if (compressSummaries.length === 0) {
        ctx.ui.notify("No compressions exist in this session.", "info");
        return;
      }

      const lines: string[] = ["Compressions:"];

      for (const cs of compressSummaries) {
        const tokens = countTokens(cs.summary);
        const status = cs.active
          ? "active"
          : cs.deactivatedByUser
            ? "decompressed"
            : "inactive";
        const statusIcon = cs.active ? "●" : cs.deactivatedByUser ? "○" : "✕";

        lines.push(
          `  ${statusIcon} #${cs.id}  [${status}]  "${cs.topic}"  (${cs.compressedIds.length} tools, ~${tokens} tokens)`
        );
      }

      lines.push("");
      lines.push("Commands: /dcp-decompress <id>  /dcp-recompress <id>");

      ctx.ui.notify(lines.join("\n"), "info");
    },
  };
}
