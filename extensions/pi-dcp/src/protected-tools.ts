/**
 * Protected tool matching — determines which tools are shielded from pruning.
 *
 * Supports exact names and glob patterns (e.g. "subagent*").
 * Used by tool-cache visibility, LLM-driven tools, and automatic rules.
 */

const GLOB_CHARS = /[*?]/;

/**
 * Default protected tools — core workflow memory that should never be pruned.
 *
 * - DCP's own tools (prevent self-pruning loops)
 * - Todo tools (task tracking is durable memory)
 * - Subagent tools (orchestration state)
 * - Skill-loading (loaded skills are session-long context)
 */
export const DEFAULT_PROTECTED_TOOLS: readonly string[] = [
  // DCP self-protection
  "dcp_prune",
  "dcp_distill",
  "dcp_compress",
  // Todo workflow
  "todo",
  // Subagent orchestration
  "subagent",
  "subagent_resume",
  "subagent_interrupt",
  // Context management
  "context_tag",
  "context_checkout",
  "context_log",
  // Plan submission
  "plannotator_submit_plan",
];

/**
 * Additional tools protected only during compression (not pruned/distilled either,
 * but these are the ones compress specifically must not squash).
 * Merged with global defaults.
 */
export const COMPRESS_PROTECTED_TOOLS: readonly string[] = [
  // Write/edit results have durable side-effects on disk; compressing
  // them loses the record of what changed. Pruning is still fine because
  // the filesystem is source of truth.
  "write",
  "edit",
];

/**
 * Check if a tool name matches any protected pattern.
 * Supports exact match and simple glob patterns (* and ?).
 */
export function isToolProtected(toolName: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (GLOB_CHARS.test(pattern)) {
      if (matchGlob(toolName, pattern)) return true;
    } else {
      if (toolName === pattern) return true;
    }
  }
  return false;
}

/**
 * Merge multiple protected-tool lists into a deduplicated array.
 */
export function mergeProtectedTools(...lists: (readonly string[])[]): string[] {
  const set = new Set<string>();
  for (const list of lists) {
    for (const item of list) set.add(item);
  }
  return Array.from(set);
}

/**
 * Simple glob matching supporting * (any chars) and ? (single char).
 */
function matchGlob(value: string, pattern: string): boolean {
  let vi = 0;
  let pi = 0;
  let starIdx = -1;
  let matchIdx = 0;

  while (vi < value.length) {
    if (pi < pattern.length && (pattern[pi] === "?" || pattern[pi] === value[vi])) {
      vi++;
      pi++;
    } else if (pi < pattern.length && pattern[pi] === "*") {
      starIdx = pi;
      matchIdx = vi;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      vi = matchIdx;
    } else {
      return false;
    }
  }

  while (pi < pattern.length && pattern[pi] === "*") pi++;
  return pi === pattern.length;
}
