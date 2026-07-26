/**
 * Token estimation utilities
 *
 * Uses char/4 heuristic — fast and good enough for pruning decisions.
 */

/**
 * Estimate token count from text
 */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract text from a pi message for token counting
 */
export function extractMessageText(msg: any): string {
  if (!msg) return "";

  if (typeof msg.content === "string") return msg.content;

  if (Array.isArray(msg.content)) {
    return msg.content
      .map((block: any) => {
        if (!block || typeof block !== "object") return "";
        if (block.type === "text") return block.text || "";
        if (block.type === "toolCall") {
          return `${block.name || ""} ${JSON.stringify(block.arguments || {})}`;
        }
        return "";
      })
      .join("\n");
  }

  return "";
}

/**
 * Estimate total tokens across all messages
 */
export function estimateContextTokens(messages: any[]): number {
  let total = 0;
  for (const msg of messages) {
    total += countTokens(extractMessageText(msg));
  }
  return total;
}

/**
 * Count tokens in active compress summaries.
 * Used by summaryBuffer logic to extend effective context limit.
 */
export function getActiveSummaryTokens(summaries: { summary: string }[]): number {
  let total = 0;
  for (const s of summaries) {
    total += countTokens(s.summary);
  }
  return total;
}
