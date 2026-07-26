/**
 *
 * Tools Extension
 *
 * Provides a /tools command to enable/disable tools interactively.
 * Tools are grouped by source (built-in, extensions) in a tree view.
 * Only disabled tools are tracked — anything not listed is always enabled.
 * State is stored globally in ~/.pi/agent/tools-disabled.json so it
 * persists across all sessions and projects.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type {
  ExtensionAPI,
  Theme,
  ToolInfo,
} from "@mariozechner/pi-coding-agent"
import { matchesKey } from "@mariozechner/pi-tui"

const CONFIG_DIR = join(homedir(), ".pi", "agent")
const CONFIG_FILE = join(CONFIG_DIR, "tools-disabled.json")

interface GlobalState {
  disabledTools: string[]
}

function loadDisabledTools(): Set<string> {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8")
    const parsed = JSON.parse(raw) as GlobalState
    return new Set(
      Array.isArray(parsed.disabledTools) ? parsed.disabledTools : []
    )
  } catch {
    return new Set()
  }
}

function saveDisabledTools(disabled: Set<string>) {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ disabledTools: Array.from(disabled) }, null, 2)
  )
}

// ── Grouping logic ──────────────────────────────────────────────────

interface ToolEntry {
  name: string
  active: boolean
}

interface SourceGroup {
  label: string
  tools: ToolEntry[]
}

interface ScopeGroup {
  scope: string
  directTools: ToolEntry[]
  sources: SourceGroup[]
}

function shortenPath(p: string): string {
  const home = homedir()
  if (p.startsWith(home)) {
    return `~${p.slice(home.length)}`
  }
  return p
}

function buildGroups(
  tools: ToolInfo[],
  disabledTools: Set<string>
): ScopeGroup[] {
  type ScopeData = {
    directTools: ToolEntry[]
    sourceMap: Map<string, ToolEntry[]>
  }
  const scopeMap = new Map<string, ScopeData>()
  function getOrCreate(map: Map<string, ScopeData>, key: string): ScopeData {
    let v = map.get(key)
    if (!v) {
      v = { directTools: [], sourceMap: new Map() }
      map.set(key, v)
    }
    return v
  }

  for (const tool of tools) {
    const si = tool.sourceInfo
    const isBuiltin = si.path.startsWith("<") || si.source === "builtin"
    const isSdk = si.source === "sdk"
    const active = !disabledTools.has(tool.name)
    const entry: ToolEntry = { name: tool.name, active }

    if (isBuiltin) {
      const scope = "builtin"
      getOrCreate(scopeMap, scope).directTools.push(entry)
    } else if (isSdk) {
      const scope = "sdk"
      getOrCreate(scopeMap, scope).directTools.push(entry)
    } else {
      // Extension tool — group by scope, then by source
      const scope = si.scope === "temporary" ? "other" : si.scope
      const group = getOrCreate(scopeMap, scope)

      const isPackage = si.origin === "package" && si.source !== "local"
      const sourceLabel = isPackage ? si.source : shortenPath(si.path)

      if (!group.sourceMap.has(sourceLabel))
        group.sourceMap.set(sourceLabel, [])
      group.sourceMap.get(sourceLabel)?.push(entry)
    }
  }

  // Convert to ordered ScopeGroup[]
  const scopeOrder = ["builtin", "sdk", "project", "user", "other"]
  const result: ScopeGroup[] = []

  for (const scope of scopeOrder) {
    const data = scopeMap.get(scope)
    if (!data) continue

    const sources: SourceGroup[] = []
    const sortedSources = Array.from(data.sourceMap.entries()).sort(
      ([a], [b]) => a.localeCompare(b)
    )
    for (const [label, tools] of sortedSources) {
      sources.push({
        label,
        tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
      })
    }

    result.push({
      scope,
      directTools: data.directTools.sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      sources,
    })
  }

  return result
}

// ── Row model for the flat selectable list ──────────────────────────

type Row =
  | { type: "scope"; scope: string }
  | { type: "source"; label: string }
  | { type: "tool"; name: string; active: boolean; indent: number }

function buildRows(groups: ScopeGroup[]): Row[] {
  const rows: Row[] = []
  for (const group of groups) {
    rows.push({ type: "scope", scope: group.scope })
    for (const tool of group.directTools) {
      rows.push({
        type: "tool",
        name: tool.name,
        active: tool.active,
        indent: 2,
      })
    }
    for (const source of group.sources) {
      rows.push({ type: "source", label: source.label })
      for (const tool of source.tools) {
        rows.push({
          type: "tool",
          name: tool.name,
          active: tool.active,
          indent: 3,
        })
      }
    }
  }
  return rows
}

function renderRow(row: Row, selected: boolean, theme: Theme): string {
  switch (row.type) {
    case "scope":
      return theme.fg("accent", row.scope)
    case "source":
      return `  ${theme.fg("mdLink", row.label)}`
    case "tool": {
      const cursor = selected ? theme.fg("accent", "→ ") : "  "
      const pad = row.indent === 3 ? "  " : ""
      const check = row.active
        ? theme.fg("success", "[✓]")
        : theme.fg("dim", "[ ]")
      const name = row.active
        ? selected
          ? theme.fg("accent", row.name)
          : row.name
        : theme.fg("dim", row.name)
      return `${cursor}${pad}${check} ${name}`
    }
  }
}

function buildStatsLine(tools: ToolInfo[], disabledTools: Set<string>): string {
  const total = tools.length
  const active = tools.filter((t) => !disabledTools.has(t.name)).length
  const extCount = tools.filter(
    (t) =>
      !t.sourceInfo.path.startsWith("<") &&
      t.sourceInfo.source !== "builtin" &&
      t.sourceInfo.source !== "sdk"
  ).length
  const parts = [`${total} tool${total !== 1 ? "s" : ""}`, `${active} active`]
  if (extCount > 0) {
    parts.push(`${extCount} from extension${extCount !== 1 ? "s" : ""}`)
  }
  return parts.join(" · ")
}

// ── Extension ───────────────────────────────────────────────────────

export default function toolsExtension(pi: ExtensionAPI) {
  let disabledTools: Set<string> = loadDisabledTools()
  let allTools: ToolInfo[] = []

  function applyTools() {
    const active = allTools
      .filter((t) => !disabledTools.has(t.name))
      .map((t) => t.name)
    pi.setActiveTools(active)
  }

  function refreshAndApply() {
    allTools = pi.getAllTools()
    disabledTools = loadDisabledTools()
    applyTools()
  }

  pi.registerCommand("tools", {
    description: "Enable/disable tools",
    handler: async (_args, ctx) => {
      allTools = pi.getAllTools()
      disabledTools = loadDisabledTools()

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const groups = buildGroups(allTools, disabledTools)
        const rows = buildRows(groups)
        let selectedIndex = rows.findIndex((r) => r.type === "tool")
        if (selectedIndex < 0) selectedIndex = 0

        // Max visible rows (excluding header + stats)
        const maxVisible = 20

        function moveSelection(dir: number) {
          let next = selectedIndex + dir
          // Skip non-tool rows
          while (
            next >= 0 &&
            next < rows.length &&
            rows[next].type !== "tool"
          ) {
            next += dir
          }
          if (next >= 0 && next < rows.length) {
            selectedIndex = next
          }
        }

        function toggleSelected() {
          const row = rows[selectedIndex]
          if (row?.type !== "tool") return
          if (disabledTools.has(row.name)) {
            disabledTools.delete(row.name)
            row.active = true
          } else {
            disabledTools.add(row.name)
            row.active = false
          }
          saveDisabledTools(disabledTools)
          applyTools()
        }

        return {
          render(_width: number) {
            const lines: string[] = []
            lines.push(theme.fg("accent", theme.bold("Tool Configuration")))
            lines.push("")

            // Determine visible window
            let startIdx = 0
            let endIdx = rows.length
            if (rows.length > maxVisible) {
              const half = Math.floor(maxVisible / 2)
              startIdx = Math.max(
                0,
                Math.min(selectedIndex - half, rows.length - maxVisible)
              )
              endIdx = Math.min(startIdx + maxVisible, rows.length)
            }

            for (let i = startIdx; i < endIdx; i++) {
              const row = rows[i]
              const isSelected = i === selectedIndex
              lines.push(renderRow(row, isSelected, theme))
            }

            // Stats
            lines.push("")
            lines.push(
              theme.fg("dim", `  ${buildStatsLine(allTools, disabledTools)}`)
            )

            // Hints
            lines.push("")
            lines.push(
              theme.fg("dim", "  ↑/↓ navigate · space/enter toggle · esc close")
            )

            return lines
          },
          invalidate() {},
          handleInput(data: string) {
            if (matchesKey(data, "up") || matchesKey(data, "k")) {
              moveSelection(-1)
            } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
              moveSelection(1)
            } else if (matchesKey(data, "enter") || matchesKey(data, "space")) {
              toggleSelected()
            } else if (matchesKey(data, "escape") || matchesKey(data, "q")) {
              done(undefined)
              return
            }
            tui.requestRender()
          },
        }
      })
    },
  })

  pi.on("session_start", async () => refreshAndApply())
  pi.on("session_tree", async () => refreshAndApply())
  pi.on("session_fork", async () => refreshAndApply())
}
