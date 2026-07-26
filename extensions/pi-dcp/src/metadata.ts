/**
 * Message metadata utilities
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { MessageWithMetadata } from "./types";

/**
 * Wrap an AgentMessage with metadata container
 */
export function createMessageWithMetadata(message: AgentMessage): MessageWithMetadata {
  return {
    message,
    metadata: {},
  };
}

/**
 * Create a stable hash of message content for deduplication
 */
export function hashMessage(message: AgentMessage): string {
  // Create a stable string representation of the message content
  let content = "";

  // toolResult messages: include toolCallId and toolName for uniqueness
  if (message.role === "toolResult") {
    content = `[toolResult:${(message as any).toolCallId || "?"}:${(message as any).toolName || "?"}]`;
  }

  if ("content" in message) {
    if (typeof message.content === "string") {
      content += message.content;
    } else if (Array.isArray(message.content)) {
      content += message.content
        .map((part: any) => {
          // Handle undefined or malformed parts
          if (!part || typeof part !== "object") return "";

          if (part.type === "text") return part.text || "";
          if (part.type === "image") return `[image:${part.source?.type || "unknown"}]`;
          // Pi uses "toolCall" (not "tool_use") for assistant tool invocations
          if (part.type === "toolCall") {
            const args = part.arguments ? JSON.stringify(part.arguments) : "";
            return `[tool:${part.id || "?"}:${part.name || "unknown"}:${args}]`;
          }
          // Legacy API format
          if (part.type === "tool_use") {
            const input = part.input ? JSON.stringify(part.input) : "";
            return `[tool:${part.id || "?"}:${part.name || "unknown"}:${input}]`;
          }
          if (part.type === "tool_result") return `[result:${part.tool_use_id || "unknown"}]`;
          return "";
        })
        .join("");
    }
  }

  // Simple hash function (djb2)
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return hash.toString(36);
}

/**
 * Extract file path from write/edit tool result
 */
export function extractFilePath(message: AgentMessage): string | null {
  if (message.role !== "toolResult") return null;

  const toolName = (message as any).toolName;
  if (toolName !== "write" && toolName !== "edit") return null;

  // Try to extract from details
  const details = (message as any).details;
  if (details?.path) return details.path;
  if (details?.file) return details.file;

  return null;
}

/**
 * Check if message is an error
 */
export function isErrorMessage(message: AgentMessage): boolean {
  if (message.role === "toolResult") {
    return !!(message as any).isError;
  }

  // Check content for error patterns
  if ("content" in message) {
    const content = typeof message.content === "string" ? message.content : "";
    const errorPatterns = [/error:/i, /failed:/i, /exception:/i, /\[error\]/i];
    return errorPatterns.some((pattern) => pattern.test(content));
  }

  return false;
}

/**
 * Check if two messages represent the same operation (for error resolution tracking)
 */
export function isSameOperation(msg1: AgentMessage, msg2: AgentMessage): boolean {
  if (msg1.role !== "toolResult" || msg2.role !== "toolResult") return false;

  const tool1 = (msg1 as any).toolName;
  const tool2 = (msg2 as any).toolName;

  if (tool1 !== tool2) return false;

  // For file operations, check if same file
  const path1 = extractFilePath(msg1);
  const path2 = extractFilePath(msg2);

  if (path1 && path2) {
    return path1 === path2;
  }

  // For other operations, compare content directly (not hashMessage,
  // which includes toolCallId and would never match across different calls)
  return hashContentOnly(msg1) === hashContentOnly(msg2);
}

/**
 * Hash only the content of a message, ignoring identity fields like toolCallId.
 * Used for comparing whether two operations did the same thing (error resolution).
 */
function hashContentOnly(message: AgentMessage): string {
  let content = "";
  if ("content" in message) {
    if (typeof message.content === "string") {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content
        .map((part: any) => {
          if (!part || typeof part !== "object") return "";
          if (part.type === "text") return part.text || "";
          return "";
        })
        .join("");
    }
  }
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return hash.toString(36);
}

/**
 * Extract tool IDs from a message.
 * - For assistant messages: extracts toolCall IDs from content blocks
 * - For toolResult messages: extracts the toolCallId
 */
export function extractToolUseIds(message: AgentMessage): string[] {
  const ids: string[] = [];

  // toolResult messages have a toolCallId field
  if (message.role === "toolResult") {
    if (message.toolCallId) {
      ids.push(message.toolCallId);
    }
    return ids;
  }

  // assistant messages have toolCall content blocks
  if (message.role === "assistant" && Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part && typeof part === "object" && part.type === "toolCall" && part.id) {
        ids.push(part.id);
      }
    }
  }

  return ids;
}

/**
 * Check if a message contains toolCall blocks (assistant messages)
 */
export function hasToolUse(message: AgentMessage): boolean {
  if (message.role === "assistant" && Array.isArray(message.content)) {
    return message.content.some(
      (part) => part && typeof part === "object" && part.type === "toolCall"
    );
  }
  return false;
}

/**
 * Check if a message is a tool result
 */
export function hasToolResult(message: AgentMessage): boolean {
  return message.role === "toolResult";
}

// ---- Tool call cross-referencing ----

export interface ToolCallInfo {
  /** Index of the paired assistant message */
  assistantIndex: number;
  /** The toolCall ID */
  toolCallId: string;
  /** Tool name */
  toolName: string;
  /** Tool arguments from the assistant's toolCall block */
  arguments: Record<string, any>;
  /** Normalized signature: toolName::JSON(sortedArgs) */
  signature: string;
}

/**
 * Resolve a toolResult's paired assistant toolCall info.
 * Walks backward from the toolResult to find the assistant with matching toolCallId.
 */
export function resolveToolCallInfo(
  msg: MessageWithMetadata,
  allMessages: MessageWithMetadata[]
): ToolCallInfo | null {
  if (msg.message.role !== "toolResult") return null;
  const toolCallId = (msg.message as any).toolCallId;
  if (!toolCallId) return null;

  const msgIndex = allMessages.indexOf(msg);
  for (let i = msgIndex - 1; i >= 0; i--) {
    const candidate = allMessages[i];
    if (candidate.message.role !== "assistant") continue;
    if (!Array.isArray(candidate.message.content)) continue;

    for (const block of candidate.message.content as any[]) {
      if (block?.type === "toolCall" && block.id === toolCallId) {
        const args = block.arguments || {};
        return {
          assistantIndex: i,
          toolCallId,
          toolName: block.name || "unknown",
          arguments: args,
          signature: createToolSignature(block.name || "unknown", args),
        };
      }
    }
  }
  return null;
}

/**
 * Create a normalized tool signature for dedup/matching.
 * Same tool + same args = same signature regardless of call ID.
 */
export function createToolSignature(tool: string, parameters?: any): string {
  if (!parameters || Object.keys(parameters).length === 0) return tool;
  const sorted = sortObjectKeys(normalizeParameters(parameters));
  return `${tool}::${JSON.stringify(sorted)}`;
}

function normalizeParameters(params: any): any {
  if (typeof params !== "object" || params === null) return params;
  if (Array.isArray(params)) return params;
  const normalized: any = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function sortObjectKeys(obj: any): any {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted: any = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObjectKeys(obj[key]);
  }
  return sorted;
}

/**
 * Annotate turn indices on all messages.
 * A turn increments on each user message. Every message between two user
 * messages shares the same turn index.
 */
export function annotateTurnIndices(messages: MessageWithMetadata[]): void {
  let turn = 0;
  for (const msg of messages) {
    if (msg.message.role === "user") {
      turn++;
    }
    msg.metadata.turnIndex = turn;
  }
}

/**
 * Check if a message is protected by turn-based protection.
 * Messages from the last N turns (relative to currentTurn) are protected.
 */
export function isTurnProtected(
  msg: MessageWithMetadata,
  currentTurn: number,
  turnProtection?: { enabled: boolean; turns: number }
): boolean {
  if (!turnProtection?.enabled || !turnProtection.turns) return false;
  if (msg.metadata.turnIndex === undefined) return false;
  return currentTurn - msg.metadata.turnIndex < turnProtection.turns;
}
