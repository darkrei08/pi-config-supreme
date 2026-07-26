import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent"

type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"

type ReasoningMap = Record<string, ThinkingLevel>
type ReasoningModel = {
  provider: string
  id: string
  reasoning?: boolean
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>
}

const LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]
const STANDARD_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
]
const CONFIG_PATH = join(getAgentDir(), "reasoning-levels.json")

function modelKey(model: ReasoningModel): string {
  return `${model.provider}/${model.id}`
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && LEVELS.includes(value as ThinkingLevel)
}

export function getAvailableLevels(model?: ReasoningModel): ThinkingLevel[] {
  if (!model?.reasoning) return ["off"]

  return LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    if (mapped !== undefined) return true
    return STANDARD_LEVELS.includes(level)
  })
}

export function loadReasoningMap(): ReasoningMap {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, ThinkingLevel] => isThinkingLevel(entry[1])
      )
    )
  } catch {
    return {}
  }
}

function saveReasoningMap(mapping: ReasoningMap): void {
  mkdirSync(getAgentDir(), { recursive: true })
  writeFileSync(CONFIG_PATH, `${JSON.stringify(mapping, null, 2)}\n`)
}

export default function reasoningExtension(pi: ExtensionAPI): void {
  let mapping = loadReasoningMap()
  let currentModel: ReasoningModel | undefined

  function applyMapping(model: ReasoningModel): void {
    const level = mapping[modelKey(model)]
    if (level !== undefined && getAvailableLevels(model).includes(level)) {
      pi.setThinkingLevel(level)
    }
  }

  pi.on("session_start", (_event, ctx) => {
    mapping = loadReasoningMap()
    currentModel = ctx.model
    if (currentModel) applyMapping(currentModel)
  })

  pi.on("model_select", (event) => {
    currentModel = event.model
    applyMapping(currentModel)
  })

  pi.registerCommand("reasoning", {
    description: "Set or reset saved reasoning level for current model",
    getArgumentCompletions: (prefix) => {
      const normalized = prefix.trim().toLowerCase()
      const values = [...getAvailableLevels(currentModel), "reset"].filter(
        (value) => value.startsWith(normalized)
      )
      return values.length > 0
        ? values.map((value) => ({ value, label: value }))
        : null
    },
    handler: async (args, ctx) => {
      if (!ctx.model) return

      const availableLevels = getAvailableLevels(ctx.model)
      let choice = args.trim().toLowerCase()
      if (!choice && ctx.hasUI) {
        choice =
          (await ctx.ui.select("Reasoning level", [
            ...availableLevels,
            "reset",
          ])) ?? ""
      }
      if (!choice) return

      const key = modelKey(ctx.model)
      if (choice === "reset") {
        delete mapping[key]
        saveReasoningMap(mapping)
        return
      }
      if (!isThinkingLevel(choice) || !availableLevels.includes(choice)) return

      mapping[key] = choice
      saveReasoningMap(mapping)
      pi.setThinkingLevel(choice)
    },
  })
}
