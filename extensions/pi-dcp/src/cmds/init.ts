/**
 * DCP Init Command
 *
 * Generate pi-dcp.json config file (project or global).
 */

import { join } from "path";
import { writeConfigFile, CONFIG_PATHS } from "../config";
import { CommandDefinition } from "../types";

export function createInitCommand(): CommandDefinition {
  return {
    description: "Generate pi-dcp.json config (use --global for ~/.pi/agent/pi-dcp.json)",
    handler: async (args, ctx) => {
      const argList = args?.split(/\s+/) ?? [];
      const isGlobal = argList.includes("--global");
      const force = argList.includes("--force");

      const configPath = isGlobal
        ? CONFIG_PATHS.global
        : join(process.cwd(), CONFIG_PATHS.projectRelative);

      const location = isGlobal ? "global" : "project";

      try {
        await writeConfigFile(configPath, { force });
        ctx.ui.notify(`DCP ${location} config created: ${configPath}`, "info");
      } catch (error: any) {
        if (error.message?.includes("already exists")) {
          ctx.ui.notify(
            `Config already exists at ${configPath}. Use '/dcp-init --force' to overwrite.`,
            "warning"
          );
        } else {
          ctx.ui.notify(`Failed to create config: ${error.message || error}`, "error");
        }
      }
    },
  };
}
