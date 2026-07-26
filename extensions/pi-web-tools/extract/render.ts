import { Text } from "@mariozechner/pi-tui"

function previewPrompt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const oneLine = value.trim().replace(/\s+/g, " ")
  if (!oneLine) return undefined
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine
}

export function renderCall(args: any, theme: any): typeof Text.prototype {
  let text = theme.fg("toolTitle", theme.bold("web_extract"))
  const urls = Array.isArray(args.urls) ? args.urls : []
  text += ` ${theme.fg("accent", `${urls.length || "?"} url${urls.length === 1 ? "" : "s"}`)}`
  if (args.mode) text += ` ${theme.fg("muted", args.mode)}`

  const prompt = args.mode === "targeted" ? previewPrompt(args.prompt) : undefined
  if (prompt) text += ` ${theme.fg("muted", "prompt:")} ${theme.fg("toolOutput", prompt)}`

  return new Text(text, 0, 0)
}

export function renderResult(
  result: any,
  { expanded }: { expanded: boolean },
  theme: any
): typeof Text.prototype {
  const d = result.details
  const c = result.content?.[0]
  if (d?.error) return new Text(theme.fg("error", `✗ ${d.error}`), 0, 0)

  let text = theme.fg("success", "✓ ")
  text += theme.fg("toolTitle", `web_extract ${d?.mode ?? ""}`)
  text += theme.fg("muted", ` (${d?.successCount ?? 0}/${d?.urlCount ?? "?"} URLs`)
  if (d?.truncated) text += theme.fg("warning", ", truncated")
  text += theme.fg("muted", ")")

  if (d?.sources && Object.keys(d.sources).length > 0) {
    const sources = Object.entries(d.sources)
      .map(([source, count]) => `${source}=${count}`)
      .join(" | ")
    text += `\n${theme.fg("muted", `  ${sources}`)}`
  }

  if (d?.fullOutputPath) {
    text += `\n${theme.fg("muted", `Full output: ${d.fullOutputPath}`)}`
  }

  if (c?.type === "text" && c.text) {
    const lines = c.text.split("\n")
    const maxLines = expanded ? lines.length : 5
    const displayLines = lines.slice(0, maxLines)
    const remaining = lines.length - displayLines.length

    if (displayLines.length > 0) {
      text += `\n\n${displayLines.map((line: string) => theme.fg("toolOutput", line)).join("\n")}`
    }

    if (remaining > 0 && !expanded) {
      text += `\n${theme.fg("muted", `... (${remaining} more lines, expand for full)`)}`
    }
  }

  return new Text(text, 0, 0)
}
