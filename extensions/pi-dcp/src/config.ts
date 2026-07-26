/**
 * Configuration management - pure JSON
 *
 * Loads from:
 * 1. .pi/pi-dcp.json (project-level, highest priority)
 * 2. ~/.pi/agent/pi-dcp.json (global)
 * 3. Defaults
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DcpConfigWithPruneRuleObjects,
  DcpConfigWithRuleRefs,
  PruneRule,
  isPruneRuleObject,
  type ProtectedToolsConfig,
} from "./types";
import {
  DEFAULT_PROTECTED_TOOLS,
  COMPRESS_PROTECTED_TOOLS,
  mergeProtectedTools,
} from "./protected-tools";
import { getRule, getRuleNames } from "./registry";
import { getLogger } from "./logger";
import { DEFAULT_CONTEXT_LIMITS, validateContextLimits } from "./context-limits";

/** Global config path: ~/.pi/agent/pi-dcp.json */
const GLOBAL_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-dcp.json");

/** Project config path: .pi/pi-dcp.json (relative to cwd) */
const PROJECT_CONFIG_NAME = ".pi/pi-dcp.json";

/**
 * Default configuration
 */
const DEFAULT_CONFIG: DcpConfigWithRuleRefs = {
  enabled: true,
  debug: false,
  rules: ["deduplication", "superseded-writes", "error-purging", "tool-pairing", "recency"],
  keepRecentCount: 10,
  turnProtection: { enabled: true, turns: 3 },
  summaryBuffer: true,
  contextLimits: DEFAULT_CONTEXT_LIMITS,
  nudgeFrequency: 15,
  iterationNudgeThreshold: 15,
  nudgeForce: "soft",
  protectedTools: {
    global: [],
    compress: [],
  },
  protectedFilePatterns: [],
};

/**
 * Deep merge two objects (source wins over target for conflicts)
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (sourceVal === undefined) continue;

    if (
      typeof sourceVal === "object" &&
      sourceVal !== null &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === "object" &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      // Recursively merge objects
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      // Override with source value (including arrays)
      result[key] = sourceVal as T[keyof T];
    }
  }

  return result;
}

/**
 * Load JSON config from a path, returns null if not found or invalid
 */
function loadJsonConfig(path: string): Partial<DcpConfigWithRuleRefs> | null {
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch (e) {
    getLogger().warn(`Failed to parse config at ${path}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Load configuration from JSON files
 *
 * Priority (highest to lowest):
 * 1. CLI flags (--dcp-enabled, --dcp-debug)
 * 2. Project config (.pi/pi-dcp.json)
 * 3. Global config (~/.pi/agent/pi-dcp.json)
 * 4. Default configuration
 */
export async function loadConfig(pi: ExtensionAPI): Promise<DcpConfigWithPruneRuleObjects> {
  const projectConfigPath = join(process.cwd(), PROJECT_CONFIG_NAME);

  // Load configs (project overrides global overrides defaults)
  const globalConfig = loadJsonConfig(GLOBAL_CONFIG_PATH);
  const projectConfig = loadJsonConfig(projectConfigPath);

  // Merge: defaults <- global <- project
  let config: DcpConfigWithRuleRefs = { ...DEFAULT_CONFIG };
  if (globalConfig) {
    config = deepMerge(config, globalConfig);
  }
  if (projectConfig) {
    config = deepMerge(config, projectConfig);
  }

  // Apply flag overrides (highest priority)
  const enabled = pi.getFlag("--dcp-enabled");
  const debug = pi.getFlag("--dcp-debug");

  if (enabled !== undefined) {
    config.enabled = enabled as boolean;
  }
  if (debug !== undefined) {
    config.debug = debug as boolean;
  }

  // Filter out invalid rules
  const availableRuleNames = getRuleNames();
  const invalidRuleNames: string[] = [];

  const rules: PruneRule[] = config.rules
    .filter((rule) => {
      if (isPruneRuleObject(rule)) {
        return true;
      }
      if (typeof rule === "string" && availableRuleNames.includes(rule)) {
        return true;
      }
      invalidRuleNames.push(typeof rule === "string" ? rule : JSON.stringify(rule));
      return false;
    })
    .map((rule) => {
      if (typeof rule === "string") {
        return getRule(rule)!;
      }
      return rule;
    });

  if (config.debug && invalidRuleNames.length > 0) {
    getLogger().warn(
      `Invalid rules ignored: ${invalidRuleNames.join(", ")}`
    );
  }

  // Validate contextLimits
  const limitErrors = validateContextLimits(config.contextLimits);
  if (limitErrors.length > 0) {
    getLogger().warn(`Invalid contextLimits, using defaults: ${limitErrors.join("; ")}`);
    config.contextLimits = DEFAULT_CONTEXT_LIMITS;
  }

  return {
    ...config,
    rules,
  };
}

/**
 * Resolve protected tool lists from config (merges with built-in defaults)
 */
export function resolveProtectedTools(userConfig?: ProtectedToolsConfig): {
  global: string[];
  compress: string[];
} {
  const userGlobal = userConfig?.global ?? [];
  const userCompress = userConfig?.compress ?? [];

  const globalList = mergeProtectedTools(DEFAULT_PROTECTED_TOOLS, userGlobal);
  const compressList = mergeProtectedTools(globalList, COMPRESS_PROTECTED_TOOLS, userCompress);

  return { global: globalList, compress: compressList };
}

/**
 * Generate JSON config content
 */
export function generateConfigFileContent(options?: { simplified?: boolean }): string {
  const simplified = options?.simplified ?? false;

  if (simplified) {
    const config = {
      enabled: true,
      debug: false,
      rules: ["deduplication", "superseded-writes", "error-purging", "tool-pairing", "recency"],
      keepRecentCount: 10,
    };
    return JSON.stringify(config, null, 2) + "\n";
  }

  const config = {
    enabled: true,
    debug: false,
    rules: ["deduplication", "superseded-writes", "error-purging", "tool-pairing", "recency"],
    keepRecentCount: 10,
    turnProtection: { enabled: true, turns: 3 },
    contextLimits: {
      min: 80000,
      max: 120000,
    },
    nudgeFrequency: 15,
    iterationNudgeThreshold: 15,
    nudgeForce: "soft",
    summaryBuffer: true,
    protectedTools: {
      global: [],
      compress: [],
    },
    protectedFilePatterns: [],
  };
  return JSON.stringify(config, null, 2) + "\n";
}

/**
 * Write configuration file
 *
 * @param path - Full path where to write the config file
 * @param options - Options for file generation
 */
export async function writeConfigFile(
  path: string,
  options?: { force?: boolean; simplified?: boolean }
): Promise<void> {
  const force = options?.force ?? false;

  // Check if file already exists
  if (!force && existsSync(path)) {
    throw new Error("Config file already exists. Use force option to overwrite.");
  }

  // Ensure parent directory exists
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = generateConfigFileContent(options);
  writeFileSync(path, content, "utf-8");
}

/** Export paths for use by init command */
export const CONFIG_PATHS = {
  global: GLOBAL_CONFIG_PATH,
  projectRelative: PROJECT_CONFIG_NAME,
};
