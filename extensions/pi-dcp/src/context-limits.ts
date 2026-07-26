/**
 * Resolve model-aware context thresholds.
 *
 * Mirrors opencode-dcp's `resolveContextTokenLimit` / `isContextOverLimits`
 * adapted for pi's ExtensionContext.model API.
 */

import type { ContextLimits, LimitValue } from "./types";

/** Default limits used when no config is provided */
export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  min: 80_000,
  max: 120_000,
};

/**
 * Parse a LimitValue into an absolute token count.
 *
 * - Number → returned as-is
 * - `"60%"` → resolved against `modelContextWindow`
 * - If percentage and `modelContextWindow` is undefined → returns `fallback`
 */
export function resolveLimitValue(
  value: LimitValue,
  modelContextWindow: number | undefined,
  fallback: number
): number {
  if (typeof value === "number") return value;

  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (!match) return fallback;

  const pct = parseFloat(match[1]);
  if (modelContextWindow == null || modelContextWindow <= 0) return fallback;
  return Math.floor((pct / 100) * modelContextWindow);
}

/**
 * Resolve the effective min or max context limit for the current model.
 *
 * Resolution order:
 * 1. Model-specific override (`modelMin`/`modelMax` keyed by `modelId`)
 * 2. Global `min`/`max`
 * 3. DEFAULT_CONTEXT_LIMITS fallback
 */
export function resolveContextLimit(
  limits: ContextLimits | undefined,
  modelId: string | undefined,
  modelContextWindow: number | undefined,
  threshold: "min" | "max"
): number {
  const effective = limits ?? DEFAULT_CONTEXT_LIMITS;

  // 1. Check model-specific override
  const modelOverrides =
    threshold === "max" ? effective.modelMax : effective.modelMin;

  if (modelId && modelOverrides?.[modelId] !== undefined) {
    const fallback =
      threshold === "max"
        ? DEFAULT_CONTEXT_LIMITS.max
        : DEFAULT_CONTEXT_LIMITS.min;
    return resolveLimitValue(
      modelOverrides[modelId],
      modelContextWindow,
      resolveLimitValue(fallback, modelContextWindow, fallback as number)
    );
  }

  // 2. Global value
  const globalValue = threshold === "max" ? effective.max : effective.min;
  const globalFallback =
    threshold === "max"
      ? (DEFAULT_CONTEXT_LIMITS.max as number)
      : (DEFAULT_CONTEXT_LIMITS.min as number);

  return resolveLimitValue(globalValue, modelContextWindow, globalFallback);
}

export interface ContextOverLimits {
  /** Over the hard max threshold — urgent nudge */
  overMax: boolean;
  /** Over the soft min threshold — gentle nudge */
  overMin: boolean;
  /** Resolved effective min limit (tokens) */
  effectiveMin: number;
  /** Resolved effective max limit (tokens) */
  effectiveMax: number;
}

/**
 * Check whether the current token count exceeds min/max thresholds.
 */
export function isContextOverLimits(
  totalTokens: number,
  limits: ContextLimits | undefined,
  modelId: string | undefined,
  modelContextWindow: number | undefined
): ContextOverLimits {
  const effectiveMin = resolveContextLimit(limits, modelId, modelContextWindow, "min");
  const effectiveMax = resolveContextLimit(limits, modelId, modelContextWindow, "max");

  return {
    overMax: totalTokens > effectiveMax,
    overMin: totalTokens > effectiveMin,
    effectiveMin,
    effectiveMax,
  };
}

/**
 * Validate a LimitValue at config load time.
 * Returns an error string or null if valid.
 */
export function validateLimitValue(value: unknown, fieldName: string): string | null {
  if (typeof value === "number") {
    if (value <= 0 || !Number.isFinite(value)) {
      return `${fieldName}: must be a positive finite number, got ${value}`;
    }
    return null;
  }
  if (typeof value === "string") {
    if (/^\d+(\.\d+)?%$/.test(value)) return null;
    return `${fieldName}: invalid percentage format "${value}", expected e.g. "60%"`;
  }
  return `${fieldName}: must be number or percentage string, got ${typeof value}`;
}

/**
 * Validate an entire ContextLimits object.
 * Returns array of error strings (empty = valid).
 */
export function validateContextLimits(limits: unknown): string[] {
  if (limits == null) return [];
  if (typeof limits !== "object") return ["contextLimits: must be an object"];

  const errors: string[] = [];
  const obj = limits as Record<string, unknown>;

  if (obj.min !== undefined) {
    const err = validateLimitValue(obj.min, "contextLimits.min");
    if (err) errors.push(err);
  }
  if (obj.max !== undefined) {
    const err = validateLimitValue(obj.max, "contextLimits.max");
    if (err) errors.push(err);
  }

  for (const field of ["modelMin", "modelMax"] as const) {
    if (obj[field] == null) continue;
    if (typeof obj[field] !== "object") {
      errors.push(`contextLimits.${field}: must be an object`);
      continue;
    }
    for (const [key, val] of Object.entries(obj[field] as Record<string, unknown>)) {
      const err = validateLimitValue(val, `contextLimits.${field}["${key}"]`);
      if (err) errors.push(err);
    }
  }

  return errors;
}
