import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

type CavemanMode = "off" | "lite" | "full" | "ultra"

const VALID_MODES: readonly CavemanMode[] = ["off", "lite", "full", "ultra"]
const STATE_CUSTOM_TYPE = "caveman_mode"
const FRONTMATTER_REGEX = /^---[\s\S]*?---\s*/
const TABLE_ROW_REGEX = /^\|\s*\*\*(\S+?)\*\*\s*\|/
const EXAMPLE_LINE_REGEX = /^- (\S+?):\s/

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SKILL_PATH = path.resolve(__dirname, "caveman-system-prompt.md")

function getConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME)
    return path.join(process.env.XDG_CONFIG_HOME, "caveman")
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
    return path.join(appData, "caveman")
  }
  return path.join(os.homedir(), ".config", "caveman")
}

function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json")
}

function loadDefaultMode(): CavemanMode {
  const envMode = process.env.CAVEMAN_DEFAULT_MODE?.toLowerCase()
  if (envMode && (VALID_MODES as readonly string[]).includes(envMode)) {
    return envMode as CavemanMode
  }

  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")) as {
      defaultMode?: unknown
    }
    if (
      typeof config.defaultMode === "string" &&
      (VALID_MODES as readonly string[]).includes(config.defaultMode)
    ) {
      return config.defaultMode as CavemanMode
    }
  } catch {
    // Missing or invalid config.
  }

  return "ultra"
}

function loadSkillContent(): string {
  if (!fs.existsSync(SKILL_PATH))
    throw new Error(`caveman skill missing: ${SKILL_PATH}`)
  const content = fs.readFileSync(SKILL_PATH, "utf8")
  if (!content.includes("## Intensity"))
    throw new Error(`caveman skill malformed: ${SKILL_PATH}`)
  return content
}

function computePrompt(mode: CavemanMode, skillContent: string): string {
  if (mode === "off") return ""

  const filtered = skillContent
    .replace(FRONTMATTER_REGEX, "")
    .split("\n")
    .filter((line) => {
      const tableMatch = line.match(TABLE_ROW_REGEX)
      if (tableMatch) return tableMatch[1] === mode
      const exampleMatch = line.match(EXAMPLE_LINE_REGEX)
      if (exampleMatch) return exampleMatch[1] === mode
      return true
    })
    .join("\n")

  return `\n\nCAVEMAN MODE ACTIVE — level: ${mode}\n\n${filtered}`
}

function footerStatus(mode: CavemanMode): string | undefined {
  return mode === "off" ? undefined : `🪨 caveman: ${mode}`
}

export default function cavemanExtension(pi: ExtensionAPI) {
  let activeMode: CavemanMode = "off"
  let skillContent = ""
  let cachedPrompt = ""

  function applyMode(
    mode: CavemanMode,
    ctx?: { ui: { setStatus: (id: string, text?: string) => void } }
  ) {
    activeMode = mode
    cachedPrompt = computePrompt(mode, skillContent)
    ctx?.ui.setStatus("caveman", footerStatus(mode))
  }

  pi.on("session_start", async (_event, ctx) => {
    skillContent = loadSkillContent()

    const entries = ctx.sessionManager.getBranch()
    let restoredMode: CavemanMode | null = null
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as {
        type?: string
        customType?: string
        data?: { mode?: CavemanMode }
      }
      if (
        entry.type === "custom" &&
        entry.customType === STATE_CUSTOM_TYPE &&
        entry.data?.mode
      ) {
        restoredMode = entry.data.mode
        break
      }
    }

    applyMode(restoredMode ?? loadDefaultMode(), ctx)
  })

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("caveman", undefined)
  })

  pi.registerCommand("caveman", {
    description: "Show or set caveman mode: /caveman [off|lite|full|ultra]",
    getArgumentCompletions: (prefix) => {
      const trimmed = prefix.trim().toLowerCase()
      const values = VALID_MODES.filter((mode) => mode.startsWith(trimmed)).map(
        (mode) => ({ value: mode, label: mode })
      )
      return values.length > 0 ? values : null
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim().toLowerCase()
      if (!trimmed) {
        ctx.ui.notify(
          `caveman: ${activeMode}. Use /caveman off|lite|full|ultra`,
          "info"
        )
        return
      }

      if (!(VALID_MODES as readonly string[]).includes(trimmed)) {
        ctx.ui.notify(
          `Unknown mode: ${trimmed}. Use /caveman off|lite|full|ultra`,
          "error"
        )
        return
      }

      const nextMode = trimmed as CavemanMode
      applyMode(nextMode, ctx)
      pi.appendEntry(STATE_CUSTOM_TYPE, { mode: nextMode })
      ctx.ui.notify(`caveman: ${nextMode}`, "info")
    },
  })

  pi.on("before_agent_start", async (event) => {
    if (!cachedPrompt) return undefined
    return { systemPrompt: `${event.systemPrompt}${cachedPrompt}` }
  })
}
