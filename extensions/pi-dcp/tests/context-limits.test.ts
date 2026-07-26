import { describe, it, expect } from "bun:test";
import {
  resolveLimitValue,
  resolveContextLimit,
  isContextOverLimits,
  validateLimitValue,
  validateContextLimits,
  DEFAULT_CONTEXT_LIMITS,
} from "../src/context-limits";
import type { ContextLimits } from "../src/types";

describe("resolveLimitValue", () => {
  it("returns absolute number as-is", () => {
    expect(resolveLimitValue(100_000, 200_000, 50_000)).toBe(100_000);
  });

  it("resolves percentage against model context window", () => {
    expect(resolveLimitValue("60%", 200_000, 50_000)).toBe(120_000);
  });

  it("returns fallback when percentage but no model context window", () => {
    expect(resolveLimitValue("60%", undefined, 50_000)).toBe(50_000);
  });

  it("returns fallback when percentage but zero context window", () => {
    expect(resolveLimitValue("60%", 0, 50_000)).toBe(50_000);
  });

  it("handles decimal percentages", () => {
    expect(resolveLimitValue("75.5%", 200_000, 50_000)).toBe(151_000);
  });

  it("returns fallback for invalid string", () => {
    expect(resolveLimitValue("abc" as any, 200_000, 50_000)).toBe(50_000);
  });
});

describe("resolveContextLimit", () => {
  const limits: ContextLimits = {
    min: 80_000,
    max: 120_000,
    modelMin: {
      "claude-haiku-3-5": 40_000,
      "big-model": "50%",
    },
    modelMax: {
      "claude-haiku-3-5": 60_000,
      "big-model": "80%",
    },
  };

  it("returns global min when no model override", () => {
    expect(resolveContextLimit(limits, "claude-sonnet-4", 200_000, "min")).toBe(80_000);
  });

  it("returns global max when no model override", () => {
    expect(resolveContextLimit(limits, "claude-sonnet-4", 200_000, "max")).toBe(120_000);
  });

  it("returns model-specific min override (absolute)", () => {
    expect(resolveContextLimit(limits, "claude-haiku-3-5", 200_000, "min")).toBe(40_000);
  });

  it("returns model-specific max override (absolute)", () => {
    expect(resolveContextLimit(limits, "claude-haiku-3-5", 200_000, "max")).toBe(60_000);
  });

  it("resolves model-specific percentage override", () => {
    expect(resolveContextLimit(limits, "big-model", 200_000, "min")).toBe(100_000); // 50% of 200k
    expect(resolveContextLimit(limits, "big-model", 200_000, "max")).toBe(160_000); // 80% of 200k
  });

  it("uses DEFAULT_CONTEXT_LIMITS when limits is undefined", () => {
    expect(resolveContextLimit(undefined, undefined, undefined, "min")).toBe(
      DEFAULT_CONTEXT_LIMITS.min as number
    );
    expect(resolveContextLimit(undefined, undefined, undefined, "max")).toBe(
      DEFAULT_CONTEXT_LIMITS.max as number
    );
  });

  it("falls back when modelId is undefined", () => {
    expect(resolveContextLimit(limits, undefined, 200_000, "min")).toBe(80_000);
  });

  it("resolves global percentage values", () => {
    const pctLimits: ContextLimits = { min: "40%", max: "60%" };
    expect(resolveContextLimit(pctLimits, undefined, 200_000, "min")).toBe(80_000);
    expect(resolveContextLimit(pctLimits, undefined, 200_000, "max")).toBe(120_000);
  });

  it("falls back for global percentage with no model context window", () => {
    const pctLimits: ContextLimits = { min: "40%", max: "60%" };
    // Falls back to DEFAULT values since percentage can't resolve
    expect(resolveContextLimit(pctLimits, undefined, undefined, "min")).toBe(
      DEFAULT_CONTEXT_LIMITS.min as number
    );
    expect(resolveContextLimit(pctLimits, undefined, undefined, "max")).toBe(
      DEFAULT_CONTEXT_LIMITS.max as number
    );
  });
});

describe("isContextOverLimits", () => {
  const limits: ContextLimits = { min: 80_000, max: 120_000 };

  it("returns both false when under min", () => {
    const result = isContextOverLimits(50_000, limits, undefined, undefined);
    expect(result.overMin).toBe(false);
    expect(result.overMax).toBe(false);
  });

  it("returns overMin=true when between min and max", () => {
    const result = isContextOverLimits(100_000, limits, undefined, undefined);
    expect(result.overMin).toBe(true);
    expect(result.overMax).toBe(false);
  });

  it("returns both true when over max", () => {
    const result = isContextOverLimits(150_000, limits, undefined, undefined);
    expect(result.overMin).toBe(true);
    expect(result.overMax).toBe(true);
  });

  it("reports resolved effective limits", () => {
    const result = isContextOverLimits(50_000, limits, undefined, undefined);
    expect(result.effectiveMin).toBe(80_000);
    expect(result.effectiveMax).toBe(120_000);
  });

  it("uses model-specific overrides", () => {
    const modelLimits: ContextLimits = {
      min: 80_000,
      max: 120_000,
      modelMax: { "small-model": 50_000 },
    };
    const result = isContextOverLimits(60_000, modelLimits, "small-model", 100_000);
    expect(result.overMax).toBe(true);
    expect(result.effectiveMax).toBe(50_000);
  });
});

describe("validateLimitValue", () => {
  it("accepts positive numbers", () => {
    expect(validateLimitValue(100_000, "test")).toBeNull();
  });

  it("accepts percentage strings", () => {
    expect(validateLimitValue("60%", "test")).toBeNull();
    expect(validateLimitValue("75.5%", "test")).toBeNull();
  });

  it("rejects zero", () => {
    expect(validateLimitValue(0, "test")).not.toBeNull();
  });

  it("rejects negative numbers", () => {
    expect(validateLimitValue(-100, "test")).not.toBeNull();
  });

  it("rejects invalid strings", () => {
    expect(validateLimitValue("abc", "test")).not.toBeNull();
    expect(validateLimitValue("60", "test")).not.toBeNull();
  });

  it("rejects non-number/string types", () => {
    expect(validateLimitValue(true, "test")).not.toBeNull();
  });
});

describe("validateContextLimits", () => {
  it("returns empty for null/undefined", () => {
    expect(validateContextLimits(null)).toEqual([]);
    expect(validateContextLimits(undefined)).toEqual([]);
  });

  it("returns empty for valid config", () => {
    expect(
      validateContextLimits({ min: 80_000, max: 120_000, modelMin: { x: "50%" } })
    ).toEqual([]);
  });

  it("returns errors for invalid values", () => {
    const errors = validateContextLimits({ min: -1, max: "bad" });
    expect(errors.length).toBe(2);
  });

  it("validates modelMin/modelMax entries", () => {
    const errors = validateContextLimits({
      min: 100,
      max: 200,
      modelMax: { x: "notpercent" },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("modelMax");
  });
});
