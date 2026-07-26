import { homedir } from "node:os"
import { relative } from "node:path"
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@mariozechner/pi-coding-agent"
import {
  type EditorTheme,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui"

const TOP_MARGIN_LINES = 0
const MIN_BODY_LINES = 3
const MAX_BODY_LINES = Number(
  process.env.PI_BETTER_PROMPT_EDITOR_MAX_BODY_LINES ?? 8
)
const STATUS_ROW_GAP_LINES = 0
const INSTALL_DELAY_MS = 0

const STATUS_ORDER = ["sandbox", "caveman", "mcp", "pi-hindsight", "link"]
const HIDDEN_STATUS_IDS = new Set<string>([])
const HIDDEN_STATUS_TEXT_INCLUDES = [
  // Border already renders cwd/model/thinking/context/cost.
  "ctx ",
  "no-model",
  "no model",
].map((s) => s.toLowerCase())
const SHOW_STATUS_IDS = process.env.SHOW_STATUS_IDS
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const CURSOR_MARKER = `${ESC}_pi:c${BEL}`
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g")

function compactPath(cwd: string): string {
  const home = homedir()
  if (cwd === home) return "~"
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`
  return cwd
}

function isEditorRule(line: string): boolean {
  const plain = line.replace(ANSI_PATTERN, "").trim()
  return (
    plain.includes("─") &&
    [...plain].every((char) => "─↑↓ 0123456789more".includes(char))
  )
}

function splitEditorRender(lines: string[]): {
  editorLines: string[]
  popupLines: string[]
} {
  const withoutTop = lines.slice(1)
  const bottomRuleIndex = withoutTop.findIndex(isEditorRule)

  if (bottomRuleIndex === -1) {
    return { editorLines: withoutTop, popupLines: [] }
  }

  return {
    editorLines: withoutTop.slice(0, bottomRuleIndex),
    popupLines: withoutTop.slice(bottomRuleIndex + 1),
  }
}

function selectBodyWindow(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines

  const cursorIndex = lines.findIndex((line) => line.includes(CURSOR_MARKER))
  if (cursorIndex === -1) return lines.slice(lines.length - maxLines)

  const halfWindow = Math.floor(maxLines / 2)
  const start = Math.max(
    0,
    Math.min(cursorIndex - halfWindow, lines.length - maxLines)
  )
  return lines.slice(start, start + maxLines)
}

function formatContext(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage()
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow
  if (!contextWindow || !usage || usage.percent === null) return "?"
  return `${Math.round(usage.percent)}%/${(contextWindow / 1000).toFixed(0)}k`
}

function contextStatusColor(
  ctx: ExtensionContext
): "success" | "accent" | "warning" | "error" | "muted" {
  const percent = ctx.getContextUsage()?.percent
  if (percent === null || percent === undefined) return "muted"
  if (percent > 75) return "error"
  if (percent >= 50) return "warning"
  if (percent >= 40) return "accent"
  return "muted"
}

function formatThinking(level: string): string {
  return level === "off" ? "off" : level
}

function formatCost(ctx: ExtensionContext): string {
  let total = 0

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue
    }

    const cost = entry.message.usage?.cost?.total
    if (typeof cost === "number" && Number.isFinite(cost)) total += cost
  }

  if (total === 0) return "$0.000"
  if (total >= 1) return `$${total.toFixed(2)}`
  if (total >= 0.001) return `$${total.toFixed(3)}`
  return `$${total.toFixed(4)}`
}

function compactModelId(modelId: string, maxWidth: number): string {
  if (visibleWidth(modelId) <= maxWidth) return modelId

  const simplified = modelId
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/-20\d{6}$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")

  if (visibleWidth(simplified) <= maxWidth) return simplified
  return truncateToWidth(simplified, maxWidth, "…")
}

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim()
}

function formatExtensionStatuses(
  statuses: ReadonlyMap<string, string>
): string[] {
  const entries = Array.from(statuses.entries())
    .map(([id, text]) => ({ id, text: sanitizeStatusText(text) }))
    .filter(({ id, text }) => {
      if (!text) return false
      if (HIDDEN_STATUS_IDS.has(id)) return false
      const lowered = text.toLowerCase()
      return !HIDDEN_STATUS_TEXT_INCLUDES.some((needle) =>
        lowered.includes(needle)
      )
    })

  entries.sort((a, b) => {
    const aOrder = STATUS_ORDER.indexOf(a.id)
    const bOrder = STATUS_ORDER.indexOf(b.id)
    const aKnown = aOrder !== -1
    const bKnown = bOrder !== -1

    if (aKnown && bKnown) return aOrder - bOrder
    if (aKnown) return -1
    if (bKnown) return 1
    return a.id.localeCompare(b.id)
  })

  return entries.map((entry) =>
    SHOW_STATUS_IDS ? `[${entry.id}] ${entry.text}` : entry.text
  )
}

export default function (pi: ExtensionAPI) {
  let activeTui: TUI | undefined
  let branch: string | undefined

  const requestRender = () => activeTui?.requestRender()

  const refreshBranch = async (ctx: ExtensionContext) => {
    branch = undefined
    const result = await pi
      .exec("git", ["branch", "--show-current"], { cwd: ctx.cwd })
      .catch(() => undefined)
    const stdout = result?.stdout.trim()
    branch = stdout && stdout.length > 0 ? stdout : undefined
    requestRender()
  }

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return

    void refreshBranch(ctx)

    class BorderStatusEditor extends CustomEditor {
      constructor(
        tui: TUI,
        theme: EditorTheme,
        keybindings: KeybindingsManager
      ) {
        super(tui, theme, keybindings, { paddingX: 1 })
        this.borderColor = ctx.ui.theme.getThinkingBorderColor(pi.getThinkingLevel())
        activeTui = tui
      }

      render(width: number): string[] {
        this.borderColor = this.getCurrentBorderColor()
        if (width < 12) return super.render(width)

        const innerWidth = Math.max(1, width - 2)
        const base = super.render(innerWidth)
        const { editorLines, popupLines } = splitEditorRender(base)
        const body = [...editorLines]
        const maxBodyLines = Math.max(
          MIN_BODY_LINES,
          Number.isFinite(MAX_BODY_LINES) ? MAX_BODY_LINES : 8
        )

        while (body.length < MIN_BODY_LINES) {
          body.push(" ".repeat(innerWidth))
        }

        const visibleBody = selectBodyWindow(body, maxBodyLines)

        const theme = ctx.ui.theme
        const modelId = ctx.model?.id ?? "no-model"
        const topRightRaw = `${compactModelId(modelId, Math.max(8, Math.floor(innerWidth * 0.3)))} · ${formatThinking(pi.getThinkingLevel())}`
        const topRight = theme.fg("muted", ` ${topRightRaw} `)
        const bottomLeft = theme.fg(
          contextStatusColor(ctx),
          ` ${formatCost(ctx)} · ${formatContext(ctx)} `
        )
        const bottomRight = theme.fg(
          "muted",
          ` ${compactPath(ctx.cwd)}${branch ? ` (${branch})` : ""} `
        )

        return [
          ...Array.from({ length: TOP_MARGIN_LINES }, () => ""),
          this.borderWithLabels(width, "", topRight),
          ...visibleBody.map((line) => this.wrapBody(line, innerWidth)),
          this.borderWithLabels(width, bottomLeft, bottomRight, "╰", "╯"),
          ...this.wrapPopupBlock(popupLines, width),
        ]
      }

      private getCurrentBorderColor(): (text: string) => string {
        if (this.getText().trimStart().startsWith("!")) {
          return ctx.ui.theme.getBashModeBorderColor()
        }
        return ctx.ui.theme.getThinkingBorderColor(pi.getThinkingLevel())
      }

      private borderWithLabels(
        width: number,
        leftLabel: string,
        rightLabel: string,
        open = "╭",
        close = "╮"
      ): string {
        const innerWidth = Math.max(0, width - 2)
        let left = leftLabel
        let right = rightLabel

        while (
          visibleWidth(left) + visibleWidth(right) > innerWidth &&
          visibleWidth(right) > 0
        ) {
          right = truncateToWidth(right, visibleWidth(right) - 1, "")
        }

        while (
          visibleWidth(left) + visibleWidth(right) > innerWidth &&
          visibleWidth(left) > 0
        ) {
          left = truncateToWidth(left, visibleWidth(left) - 1, "")
        }

        const fill = Math.max(
          0,
          innerWidth - visibleWidth(left) - visibleWidth(right)
        )
        return `${this.borderColor(open)}${left}${this.borderColor("─".repeat(fill))}${right}${this.borderColor(close)}`
      }

      private wrapBody(line: string, innerWidth: number): string {
        const clipped = truncateToWidth(line, innerWidth, "")
        const padding = " ".repeat(
          Math.max(0, innerWidth - visibleWidth(clipped))
        )
        const content = clipped ? ctx.ui.theme.fg("text", clipped) : clipped
        return `${this.borderColor("│")}${content}${padding}${this.borderColor("│")}`
      }

      private wrapPopupBlock(lines: string[], width: number): string[] {
        if (lines.length === 0) return []

        return lines.map((line) => {
          const clipped = truncateToWidth(line, width, "")
          const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)))
          return clipped + padding
        })
      }
    }

    setTimeout(() => {
      if (!ctx.hasUI) return

      ctx.ui.setEditorComponent(
        (tui, theme, keybindings) =>
          new BorderStatusEditor(tui, theme, keybindings)
      )

      ctx.ui.setFooter((tui, theme, footerData) => {
        activeTui = tui

        return {
          invalidate() {},
          render(width: number): string[] {
            const extensionStatuses =
              footerData.getExtensionStatuses() as ReadonlyMap<string, string>
            const statusParts = formatExtensionStatuses(extensionStatuses)
            if (statusParts.length === 0) return []

            const statusSep = ` ${theme.fg("dim", "·")} `
            const statusLine = statusParts
              .map((part) => theme.fg("dim", part))
              .join(statusSep)
            const lines: string[] = []
            for (let i = 0; i < STATUS_ROW_GAP_LINES; i++) lines.push("")
            lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "…")))
            return lines
          },
        }
      })
    }, INSTALL_DELAY_MS)
  })

  pi.on("thinking_level_select", requestRender)
  pi.on("message_update", requestRender)
  pi.on("agent_end", requestRender)
  pi.on("session_shutdown", (_event, ctx) => {
    activeTui = undefined
    branch = undefined

    if (ctx.hasUI) {
      ctx.ui.setEditorComponent(undefined)
      ctx.ui.setFooter(undefined)
    }
  })
}
