/**
 * System Prompt Filter Extension
 *
 * Lets you remove unwanted snippets from the system prompt — text added by other
 * extensions, skills, AGENTS.md files, or built-in tool descriptions.
 *
 * Named with the "zzz-" prefix so it loads last, after all other extensions have
 * had a chance to add their content to the system prompt.
 *
 * Config is stored in ~/.pi/agent/system-prompt-filter.json
 *
 * Commands:
 *   /spf          — interactive overview menu
 *   /spf add      — add a new filter rule
 *   /spf remove   — remove a rule
 *   /spf toggle   — enable/disable a rule without removing it
 *   /spf list     — list all rules
 *   /spf show     — inspect the current system prompt (headings / snippets / guidelines / write to file)
 *   /spf test     — preview the prompt after filters are applied
 *
 * Uses systemPromptOptions (from BeforeAgentStartEvent) when available for
 * structured access to tool snippets, guidelines, skills, and context files.
 * Falls back to regex parsing of the raw prompt text on first run before any
 * agent start event has fired.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type {
  BuildSystemPromptOptions,
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent"
import { getAgentDir } from "@mariozechner/pi-coding-agent"

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterType = "string" | "regex" | "section"

interface FilterRule {
  id: string
  name: string
  /** "string" = exact literal removal, "regex" = JS regex, "section" = ## heading + body */
  type: FilterType
  pattern: string
  enabled: boolean
}

interface Config {
  rules: FilterRule[]
}

// ─── Config persistence ───────────────────────────────────────────────────────

const CONFIG_PATH = join(getAgentDir(), "system-prompt-filter.json")

function loadConfig(): Config {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
    } catch {
      // ignore corrupt config, start fresh
    }
  }
  return { rules: [] }
}

function saveConfig(config: Config): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8")
}

// ─── Filter logic ─────────────────────────────────────────────────────────────

function applyRule(prompt: string, rule: FilterRule): string {
  if (!rule.enabled) return prompt

  switch (rule.type) {
    case "string":
      return prompt.split(rule.pattern).join("")

    case "regex":
      try {
        return prompt.replace(new RegExp(rule.pattern, "gms"), "")
      } catch {
        return prompt
      }

    case "section": {
      try {
        const escaped = rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const regex = new RegExp(
          `^#{1,6} ${escaped}[ \\t]*\\n[\\s\\S]*?(?=^#{1,6} |\\Z)`,
          "gim"
        )
        const result = prompt.replace(regex, "")
        return result.replace(/\n{3,}/g, "\n\n")
      } catch {
        return prompt
      }
    }
  }

  return prompt
}

function applyFilters(prompt: string, rules: FilterRule[]): string {
  return rules
    .filter((r) => r.enabled)
    .reduce((p, rule) => applyRule(p, rule), prompt)
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * Extract all non-blank lines from a named section of the prompt.
 * Lines are returned as-is (no trimming) so they can be used as exact string
 * match patterns against the original prompt text.
 * Used to parse back promptSnippet / promptGuidelines content, since
 * getAllTools() does not expose those fields.
 *
 * Handles both markdown headings ("## Heading") and plain-text headings
 * ("Heading:") — which is what the default pi system prompt uses.
 * Stops at the first blank line after the heading, which is how sections
 * are delimited in the plain-text format.
 */
function parseSection(prompt: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Match "## Heading" or "Heading:" at line start, then capture consecutive non-blank lines.
  const match = prompt.match(
    new RegExp(`^(?:#{1,6} )?${escaped}:?[ \\t]*\\n((?:[^\\n]+\\n)*)`, "im")
  )
  if (!match) return []
  return match[1].split("\n").filter((l) => l.trim().length > 0)
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function systemPromptFilterExtension(pi: ExtensionAPI) {
  let config = loadConfig()
  let cachedOptions: BuildSystemPromptOptions | undefined

  // ── Filter: runs last (zzz- prefix) after all other extensions ──────────
  pi.on("before_agent_start", async (event) => {
    // Cache structured prompt options for use in /spf commands
    cachedOptions = (event as any).systemPromptOptions

    const enabled = config.rules.filter((r) => r.enabled)
    if (enabled.length === 0) return

    const filtered = applyFilters(event.systemPrompt, enabled)
    if (filtered !== event.systemPrompt) {
      return { systemPrompt: filtered }
    }
  })

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig()
  })

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("system-prompt-filter", undefined)
  })

  // ── Commands ──────────────────────────────────────────────────────────────
  pi.registerCommand("spf", {
    description:
      "Manage system prompt filters  (add | remove | toggle | list | show | test)",
    getArgumentCompletions: (prefix) => {
      const subs = ["add", "remove", "toggle", "list", "show", "test"]
      const filtered = subs.filter((s) => s.startsWith(prefix))
      return filtered.length > 0
        ? filtered.map((s) => ({ value: s, label: s }))
        : null
    },
    handler: async (args, ctx) => {
      const sub = args.trim().split(/\s+/)[0]
      switch (sub) {
        case "add":
          await handleAdd(ctx)
          break
        case "remove":
          await handleRemove(ctx)
          break
        case "toggle":
          await handleToggle(ctx)
          break
        case "list":
          handleList(ctx)
          break
        case "show":
          await handleShow(ctx)
          break
        case "test":
          await handleTest(ctx)
          break
        default:
          await handleMenu(ctx)
          break
      }
    },
  })

  // ── Menu ──────────────────────────────────────────────────────────────────
  async function handleMenu(ctx: ExtensionContext) {
    const active = config.rules.filter((r) => r.enabled).length
    const total = config.rules.length
    const summary =
      total === 0 ? "no rules yet" : `${active}/${total} rules active`

    const options = [
      `add    — add a new filter rule`,
      `remove — remove a rule`,
      `toggle — enable / disable a rule`,
      `list   — list all rules (${summary})`,
      `show   — inspect system prompt (headings / snippets / guidelines / write to file)`,
      `test   — preview prompt after filters are applied`,
    ]

    const chosen = await ctx.ui.select(
      `System Prompt Filters  (${summary})`,
      options
    )
    if (!chosen) return

    const sub = chosen.split(" ")[0]
    switch (sub) {
      case "add":
        await handleAdd(ctx)
        break
      case "remove":
        await handleRemove(ctx)
        break
      case "toggle":
        await handleToggle(ctx)
        break
      case "list":
        handleList(ctx)
        break
      case "show":
        await handleShow(ctx)
        break
      case "test":
        await handleTest(ctx)
        break
    }
  }

  // ── Helpers: get structured data from cache or fallback to regex ────────
  function getToolSnippetLines(prompt: string): string[] {
    if (cachedOptions?.toolSnippets) {
      return Object.entries(cachedOptions.toolSnippets).map(
        ([name, desc]) => `- ${name}: ${desc}`
      )
    }
    return parseSection(prompt, "Available tools")
  }

  function getGuidelineLines(prompt: string): string[] {
    if (cachedOptions?.promptGuidelines && cachedOptions.promptGuidelines.length > 0) {
      return cachedOptions.promptGuidelines.map((g) =>
        g.startsWith("-") ? g : `- ${g}`
      )
    }
    return parseSection(prompt, "Guidelines")
  }

  // ── Add ───────────────────────────────────────────────────────────────────
  async function handleAdd(ctx: ExtensionContext) {
    const prompt = ctx.getSystemPrompt()
    const toolItems = getToolSnippetLines(prompt)
    const guideItems = getGuidelineLines(prompt)
    const hasPromptItems = toolItems.length > 0 || guideItems.length > 0

    const modeChoices = [
      ...(hasPromptItems
        ? [
            `pick   — choose items from Available tools (${toolItems.length}) & Guidelines (${guideItems.length})`,
          ]
        : []),
      `manual — enter a pattern manually (string / section / regex)`,
    ]

    const mode = await ctx.ui.select("Add filter rule", modeChoices)
    if (!mode) return

    if (mode.startsWith("pick")) {
      await handlePickFromPrompt(ctx, toolItems, guideItems)
    } else {
      await handleAddManual(ctx)
    }
  }

  // Pick from parsed prompt sections. First choose section, then multi-select items.
  async function handlePickFromPrompt(
    ctx: ExtensionContext,
    toolItems: string[],
    guideItems: string[]
  ) {
    // Step 1: choose which section to browse
    const sectionChoices = [
      ...(toolItems.length > 0
        ? [`tools      — Available tools (${toolItems.length} items)`]
        : []),
      ...(guideItems.length > 0
        ? [`guidelines — Guidelines (${guideItems.length} items)`]
        : []),
      ...(toolItems.length > 0 && guideItems.length > 0
        ? [`both       — browse both sections`]
        : []),
    ]

    const sectionChoice = await ctx.ui.select("Which section?", sectionChoices)
    if (!sectionChoice) return
    const section = sectionChoice.split(" ")[0]

    // Step 2: pick from each chosen section, collecting raw strings
    const selectedRaws: string[] = []

    if (section === "tools" || section === "both") {
      const picked = await pickFromList(ctx, "Available tools", toolItems)
      if (picked === null) return // Escape = cancel whole flow
      selectedRaws.push(...picked)
    }

    if (section === "guidelines" || section === "both") {
      const picked = await pickFromList(ctx, "Guidelines", guideItems)
      if (picked === null) return
      selectedRaws.push(...picked)
    }

    if (selectedRaws.length === 0) return

    for (const raw of selectedRaws) {
      config.rules.push({
        id: generateId(),
        name: raw
          .trim()
          .replace(/^[-*]\s*/, "")
          .slice(0, 50),
        type: "string",
        // Include trailing newline so the entire line is cleanly removed
        pattern: raw + "\n",
        enabled: true,
      })
    }

    saveConfig(config)
    ctx.ui.notify(
      `Added ${selectedRaws.length} filter rule${selectedRaws.length === 1 ? "" : "s"}`,
      "success"
    )
  }

  // Single-section multi-select loop. Returns selected raw strings, or null if Escape pressed.
  async function pickFromList(
    ctx: ExtensionContext,
    title: string,
    items: string[]
  ): Promise<string[] | null> {
    const existingPatterns = new Set(config.rules.map((r) => r.pattern))
    const selected = new Set<number>()

    while (true) {
      const doneLabel =
        selected.size > 0
          ? `\u2713 Done \u2014 add ${selected.size} rule${selected.size === 1 ? "" : "s"}`
          : "\u2717 Cancel"

      const displayList = [
        doneLabel,
        ...items.map((raw, i) => {
          const covered = existingPatterns.has(raw + "\n")
          const mark = selected.has(i)
            ? "\u2713"
            : covered
              ? "\u2605"
              : "\u25cb"
          return `${mark} ${raw.trim()}`
        }),
      ]

      const choice = await ctx.ui.select(
        `${title}  (${selected.size} selected, \u2605 = already filtered)`,
        displayList
      )

      if (!choice) return null // Escape = cancel whole flow
      if (choice === doneLabel || choice.startsWith("\u2717")) break

      const choiceText = choice.replace(/^[\u2713\u2605\u25cb] /, "")
      const idx = items.findIndex((raw) => raw.trim() === choiceText)
      if (idx === -1) continue

      if (selected.has(idx)) {
        selected.delete(idx)
      } else {
        selected.add(idx)
      }
    }

    return [...selected].map((i) => items[i])
  }

  // Manual add: type-selection + pattern-input flow
  async function handleAddManual(ctx: ExtensionContext) {
    const typeChoices = [
      `string  — remove an exact literal string (fastest, safest)`,
      `section — remove an entire ## Section heading and its body`,
      `regex   — remove text matching a JavaScript regex`,
    ]

    const typeChoice = await ctx.ui.select("Filter type", typeChoices)
    if (!typeChoice) return
    const type = typeChoice.split(" ")[0] as FilterType

    const patternHint =
      type === "section"
        ? "Section name without #, e.g:  Guidelines"
        : type === "regex"
          ? "JS regex, e.g:  Available tools:[\\s\\S]*?(?=\\n##)"
          : "Exact text to remove, e.g:  Use only snake_case variables."

    const pattern = await ctx.ui.input("Pattern", patternHint)
    if (!pattern?.trim()) return

    const name = await ctx.ui.input(
      "Rule name",
      "Short label, e.g:  Remove guidelines"
    )
    if (!name?.trim()) return

    const rule: FilterRule = {
      id: generateId(),
      name: name.trim(),
      type,
      pattern: pattern.trim(),
      enabled: true,
    }

    if (type === "regex") {
      try {
        new RegExp(rule.pattern)
      } catch (err) {
        ctx.ui.notify(
          `Invalid regex: ${(err as Error).message}\nRule not saved. Try /spf add again.`,
          "error"
        )
        return
      }
    }

    config.rules.push(rule)
    saveConfig(config)

    const preview =
      rule.pattern.length > 50
        ? rule.pattern.slice(0, 47) + "\u2026"
        : rule.pattern
    ctx.ui.notify(
      `Filter "${rule.name}" added  [${rule.type}: ${preview}]`,
      "success"
    )
  }

  // ── Remove ────────────────────────────────────────────────────────────────
  async function handleRemove(ctx: ExtensionContext) {
    if (config.rules.length === 0) {
      ctx.ui.notify(
        "No filter rules to remove. Use /spf add to create one.",
        "info"
      )
      return
    }

    const items = config.rules.map(
      (r) =>
        `${r.enabled ? "\u2713" : "\u25cb"} [${r.type}] ${r.name}  \u2014  ${r.pattern.slice(0, 50)}`
    )
    const chosen = await ctx.ui.select("Remove which rule?", items)
    if (!chosen) return

    const index = items.indexOf(chosen)
    const rule = config.rules[index]

    const ok = await ctx.ui.confirm("Remove filter", `Remove "${rule.name}"?`)
    if (!ok) return

    config.rules.splice(index, 1)
    saveConfig(config)
    ctx.ui.notify(`Filter "${rule.name}" removed`, "info")
  }

  // ── Toggle ────────────────────────────────────────────────────────────────
  async function handleToggle(ctx: ExtensionContext) {
    if (config.rules.length === 0) {
      ctx.ui.notify(
        "No filter rules defined. Use /spf add to create one.",
        "info"
      )
      return
    }

    const items = config.rules.map(
      (r) =>
        `${r.enabled ? "\u2713 enabled " : "\u25cb disabled"} [${r.type}] ${r.name}`
    )
    const chosen = await ctx.ui.select("Toggle which rule?", items)
    if (!chosen) return

    const index = items.indexOf(chosen)
    config.rules[index].enabled = !config.rules[index].enabled
    saveConfig(config)

    const rule = config.rules[index]
    ctx.ui.notify(
      `"${rule.name}" is now ${rule.enabled ? "enabled \u2713" : "disabled \u25cb"}`,
      "info"
    )
  }

  // ── List ──────────────────────────────────────────────────────────────────
  function handleList(ctx: ExtensionContext) {
    if (config.rules.length === 0) {
      ctx.ui.notify(
        "No filter rules defined. Use /spf add to create one.",
        "info"
      )
      return
    }

    const lines = config.rules.map(
      (r, i) =>
        `${i + 1}. ${r.enabled ? "\u2713" : "\u25cb"} [${r.type}] ${r.name}\n   ${r.pattern}`
    )

    const active = config.rules.filter((r) => r.enabled).length
    ctx.ui.notify(
      `System prompt filter rules (${active}/${config.rules.length} active):\n\n${lines.join("\n\n")}`,
      "info"
    )
  }

  // ── Show ──────────────────────────────────────────────────────────────────
  async function handleShow(ctx: ExtensionContext) {
    const prompt = ctx.getSystemPrompt()
    const lines = prompt.split("\n")
    const totalChars = prompt.length
    const totalLines = lines.length

    // Section headings — useful for building section-type filter rules
    const headings = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /^#{1,6} /.test(line))
      .map(
        ({ line, i }) =>
          `  line ${String(i + 1).padStart(4, " ")} \u2502 ${line}`
      )

    const toolSnippets = getToolSnippetLines(prompt)
    const guidelineItems = getGuidelineLines(prompt)
    const skillCount = cachedOptions?.skills?.length ?? 0
    const contextFileCount = cachedOptions?.contextFiles?.length ?? 0
    const source = cachedOptions ? "structured" : "parsed"

    const options = [
      `headings   — list all ${headings.length} section headings`,
      `snippets   — show tool snippets (${toolSnippets.length} found, ${source})`,
      `guidelines — show guideline bullets (${guidelineItems.length} found, ${source})`,
      ...(cachedOptions ? [
        `skills     — show loaded skills (${skillCount})`,
        `context    — show loaded context files (${contextFileCount})`,
      ] : []),
      `preview    — show first 25 lines of content`,
      `write      — write the full prompt to a file`,
    ]

    const chosen = await ctx.ui.select(
      `System prompt \u2014 ${totalChars} chars, ${totalLines} lines`,
      options
    )
    if (!chosen) return

    const sub = chosen.split(" ")[0]

    switch (sub) {
      case "headings":
        ctx.ui.notify(
          `System prompt \u2014 ${totalChars} chars, ${totalLines} lines\n\n` +
            `Section headings (${headings.length}):\n` +
            (headings.length > 0 ? headings.join("\n") : "  (none found)"),
          "info"
        )
        break

      case "snippets":
        ctx.ui.notify(
          toolSnippets.length > 0
            ? `Tool snippets (${toolSnippets.length}, ${source}):\n\n${toolSnippets.join("\n")}`
            : 'No tool snippets found.',
          "info"
        )
        break

      case "guidelines":
        ctx.ui.notify(
          guidelineItems.length > 0
            ? `Guideline bullets (${guidelineItems.length}, ${source}):\n\n${guidelineItems.join("\n")}`
            : 'No guidelines found.',
          "info"
        )
        break

      case "skills": {
        const skills = cachedOptions?.skills ?? []
        if (skills.length === 0) {
          ctx.ui.notify('No skills loaded.', "info")
        } else {
          const skillLines = skills.map(
            (s) => `  ${s.name} — ${s.description.slice(0, 80)}${s.description.length > 80 ? '…' : ''}`
          )
          ctx.ui.notify(
            `Loaded skills (${skills.length}):\n\n${skillLines.join("\n")}`,
            "info"
          )
        }
        break
      }

      case "context": {
        const files = cachedOptions?.contextFiles ?? []
        if (files.length === 0) {
          ctx.ui.notify('No context files loaded.', "info")
        } else {
          const fileLines = files.map(
            (f) => `  ${f.path} (${f.content.length} chars)`
          )
          ctx.ui.notify(
            `Loaded context files (${files.length}):\n\n${fileLines.join("\n")}`,
            "info"
          )
        }
        break
      }

      case "preview": {
        const preview = lines.slice(0, 25).join("\n")
        const truncNote =
          totalLines > 25 ? `\n\u2026 (${totalLines - 25} more lines)` : ""
        ctx.ui.notify(
          `System prompt preview (${totalChars} chars):\n\n${preview}${truncNote}`,
          "info"
        )
        break
      }

      case "write": {
        const defaultPath = join(ctx.cwd, "system-prompt.md")
        const inputPath = await ctx.ui.input("Write to file", defaultPath)
        if (!inputPath?.trim()) return

        const resolvedPath = resolve(ctx.cwd, inputPath.trim())
        try {
          writeFileSync(resolvedPath, prompt, "utf-8")
          ctx.ui.notify(`System prompt written to:\n${resolvedPath}`, "success")
        } catch (err) {
          ctx.ui.notify(
            `Failed to write file: ${(err as Error).message}`,
            "error"
          )
        }
        break
      }
    }
  }

  // ── Test ──────────────────────────────────────────────────────────────────
  async function handleTest(ctx: ExtensionContext) {
    const prompt = ctx.getSystemPrompt()
    const enabled = config.rules.filter((r) => r.enabled)

    if (enabled.length === 0) {
      ctx.ui.notify(
        "No enabled rules to test. Use /spf add to create one.",
        "info"
      )
      return
    }

    const filtered = applyFilters(prompt, enabled)
    const removed = prompt.length - filtered.length
    const pct =
      prompt.length > 0 ? Math.round((removed / prompt.length) * 100) : 0

    let cursor = prompt
    const ruleStats = enabled.map((rule) => {
      const after = applyRule(cursor, rule)
      const delta = cursor.length - after.length
      cursor = after
      return `  ${rule.enabled ? "\u2713" : "\u25cb"} "${rule.name}"  \u2192  ${delta > 0 ? `-${delta} chars` : "no match"}`
    })

    const previewLines = filtered.split("\n").slice(0, 20).join("\n")
    const truncNote =
      filtered.split("\n").length > 20
        ? `\n\u2026 (${filtered.split("\n").length - 20} more lines)`
        : ""

    ctx.ui.notify(
      `Filter test (${enabled.length} rule${enabled.length === 1 ? "" : "s"}):\n\n` +
        `  Before: ${prompt.length} chars\n` +
        `  After:  ${filtered.length} chars\n` +
        `  Saved:  ${removed} chars (${pct}%)\n\n` +
        `Per-rule breakdown:\n${ruleStats.join("\n")}\n\n` +
        `Filtered prompt preview:\n\n${previewLines}${truncNote}`,
      "info"
    )
  }
}
