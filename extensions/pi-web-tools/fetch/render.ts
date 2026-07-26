import { Text } from "@mariozechner/pi-tui"

export function renderCall(args: any, theme: any): typeof Text.prototype {
  let text = theme.fg("toolTitle", theme.bold("web_fetch"))
  text += ` ${theme.fg("accent", args.url || "...")}`
  if (args.rawHtml) {
    text += ` ${theme.fg("muted", "rawHtml")}`
  }
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
  if (d?.title) text += `${theme.fg("toolTitle", d.title)} `
  const source =
    c?.source ??
    (d?.method === "domain-handler" ? "domain-handler" : (d?.stage ?? "?"))
  text += theme.fg("muted", `(${source}`)
  if (d?.truncated) text += theme.fg("warning", ", truncated")
  text += theme.fg("muted", `, ${d?.totalLines ?? "?"} lines)`)

  if (c?.metadata && Object.keys(c.metadata).length > 0) {
    const meta = Object.entries(c.metadata)
      .map(([k, v]) => `${k}=${v}`)
      .join(" | ")
    text += `\n${theme.fg("muted", `  ${meta}`)}`
  }

  if (d?.fullOutputPath) {
    text += `\n${theme.fg("muted", `Full output: ${d.fullOutputPath}`)}`
  }

  // Content preview (like read tool)
  if (c?.type === "text" && c.text) {
    const lines = c.text.split("\n")
    const maxLines = expanded ? lines.length : 5
    const displayLines = lines.slice(0, maxLines)
    const remaining = lines.length - displayLines.length

    if (displayLines.length > 0) {
      text += `\n\n${displayLines.map((l: string) => theme.fg("toolOutput", l)).join("\n")}`
    }

    if (remaining > 0 && !expanded) {
      text += `\n${theme.fg("muted", `... (${remaining} more lines, expand for full)`)}`
    }
  }

  return new Text(text, 0, 0)
}
