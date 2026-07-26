/**
 * Core type definitions for Pi-DCP
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Message with pruning metadata attached
 */
export interface MessageWithMetadata {
  /** Original message from pi */
  message: AgentMessage;
  /** Pruning metadata annotated by rules */
  metadata: MessageMetadata;
}

/**
 * Metadata attached to messages during prepare/process phases
 */
export interface MessageMetadata {
  /** Content hash for deduplication */
  hash?: string;
  /** File path for superseded writes tracking */
  filePath?: string;
  /** File content version for superseded writes */
  fileVersion?: string;
  /** Whether message is an error */
  isError?: boolean;
  /** Whether error was resolved by later success */
  errorResolved?: boolean;
  /** Turn index this message belongs to (incremented on each user message) */
  turnIndex?: number;
  /** Whether protected by turn-based protection */
  protectedByTurn?: boolean;
  /** Normalized tool signature (toolName::JSON(sortedArgs)) for dedup/error matching */
  toolSignature?: string;
  /** Index of the paired assistant message (for toolResult messages) */
  pairedAssistantIndex?: number;
  /** Recency score (distance from end) */
  recencyScore?: number;
  /** Whether protected by recency rule */
  protectedByRecency?: boolean;
  /** Final decision: should this message be pruned? */
  shouldPrune?: boolean;
  /** Reason for pruning (for debugging) */
  pruneReason?: string;
  /** Extensible: custom rule metadata */
  [key: string]: any;
}

/**
 * Context provided to prepare phase
 */
export interface PrepareContext {
  /** All messages being prepared */
  messages: MessageWithMetadata[];
  /** Current message index */
  index: number;
  /** Extension configuration */
  config: DcpConfigWithPruneRuleObjects;
}

/**
 * Context provided to process phase
 */
export interface ProcessContext {
  /** All messages with metadata from prepare phase */
  messages: MessageWithMetadata[];
  /** Current message index */
  index: number;
  /** Extension configuration */
  config: DcpConfigWithPruneRuleObjects;
}

/**
 * Pruning rule definition
 */
export interface PruneRule {
  /** Unique rule identifier */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Prepare phase: annotate metadata */
  prepare?: (msg: MessageWithMetadata, context: PrepareContext) => void;
  /** Process phase: make pruning decisions */
  process?: (msg: MessageWithMetadata, context: ProcessContext) => void;
}
export const isPruneRuleObject = (obj: unknown): obj is PruneRule => {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "name" in obj &&
    ("prepare" in obj || "process" in obj) &&
    typeof (obj as any).name === "string" &&
    (typeof (obj as any).prepare === "function" || typeof (obj as any).process === "function")
  );
};

/**
 * Extension configuration
 */
export interface TurnProtection {
  /** Enable turn-based protection */
  enabled: boolean;
  /** Number of recent turns to protect from auto-pruning */
  turns: number;
}

/**
 * A limit value: absolute token count or percentage of model context window.
 * Percentage strings like "60%" resolve against the model's contextWindow.
 */
export type LimitValue = number | `${number}%`;

/**
 * Configurable context thresholds for nudge triggers.
 *
 * - `min` — soft threshold: triggers a gentle compression nudge
 * - `max` — hard threshold: triggers an urgent compression nudge
 * - `modelMin` / `modelMax` — per-model overrides keyed by model id
 */
export interface ContextLimits {
  min: LimitValue;
  max: LimitValue;
  modelMin?: Record<string, LimitValue>;
  modelMax?: Record<string, LimitValue>;
}

/**
 * Protected tools configuration.
 * Global list applies to all pruning (auto rules + LLM tools).
 * Scope-specific lists are merged with global for that operation.
 */
export interface ProtectedToolsConfig {
  /** Tools protected from ALL pruning. Merged with built-in defaults. */
  global?: string[];
  /** Additional tools protected during compression (merged with global). */
  compress?: string[];
}

export interface DcpConfig {
  /** Master enable/disable toggle */
  enabled?: boolean;
  /** Enable debug logging */
  debug?: boolean;
  /** Always keep last N messages */
  keepRecentCount: number;
  /** Protect tool outputs from the last N agent turns */
  turnProtection?: TurnProtection;
  /** Optional log directory override */
  logDir?: string;
  /**
   * Extend effective context limit by active summary tokens.
   * Prevents sessions with many compressed summaries from over-triggering
   * new compression nudges. Default: true
   */
  summaryBuffer?: boolean;
  /** Context thresholds for compression nudges */
  contextLimits?: ContextLimits;
  /**
   * Show a periodic nudge every N context events.
   * Default: 15
   */
  nudgeFrequency?: number;
  /**
   * After this many assistant/tool turns without user input,
   * inject a stronger iteration-aware nudge. Default: 15
   */
  iterationNudgeThreshold?: number;
  /**
   * Nudge placement strategy:
   * - 'soft' — nudge appended to last assistant message context (default)
   * - 'strong' — nudge appended to last user message context
   */
  nudgeForce?: 'soft' | 'strong';
  /**
   * Tool protection configuration.
   * Protected tools are shielded from automatic and LLM-driven pruning.
   * Supports exact names and glob patterns (e.g. "subagent*").
   */
  protectedTools?: ProtectedToolsConfig;
  /**
   * File path patterns to protect from pruning.
   * Tool outputs touching files matching these globs are shielded from
   * automatic and LLM-driven pruning.
   * Supports glob syntax: double-star, star, question mark.
   */
  protectedFilePatterns?: string[];
}
export type DcpConfigWithPruneRuleObjects = DcpConfig & {
  rules: PruneRule[];
  /**
   * Resolved protected tools (built-in defaults + user config merged).
   * Set at startup by resolveProtectedTools(). Rules use this for checks.
   */
  resolvedProtectedTools?: {
    global: string[];
    compress: string[];
  };
};
export type DcpConfigWithRuleRefs = DcpConfig & {
  rules: (string | PruneRule)[];
};

export type CommandDefinition = Parameters<ExtensionAPI["registerCommand"]>[1];
