import { Text } from "@mariozechner/pi-tui"
import type { WebSearchDetails } from "./types"

export function renderCall(args: any, theme: any): typeof Text.prototype {
  const qs = (args.queries ?? []).map((q: string) => `"${q}"`).join(", ")
  let text = theme.fg("toolTitle", theme.bold("web_search "))
  text += theme.fg("accent", qs || "...")

  const tags: string[] = []
  if (args.age) tags.push(`age:${args.age}`)
  if (args.includeDomains?.length) tags.push(`include:${args.includeDomains.join(",")}`)
  if (args.excludeDomains?.length) tags.push(`exclude:${args.excludeDomains.join(",")}`)
  if (args.includeContent) tags.push("content")
  if (args.limit) tags.push(`limit:${args.limit}`)
  if (tags.length > 0) text += " " + theme.fg("dim", tags.join(" "))

  return new Text(text, 0, 0)
}

export function renderResult(
  result: any,
  { expanded }: { expanded: boolean },
  theme: any
): typeof Text.prototype {
  const details = result.details as WebSearchDetails | undefined

  if (details?.error) {
    return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0)
  }

  let text = theme.fg("success", "✓ ")
  text += theme.fg("toolTitle", "web_search")
  text += theme.fg("muted", ` (${details?.resultCount ?? "?"} results`)
  if ((details?.queries?.length ?? 0) > 1) {
    text += theme.fg("dim", ` across ${details!.queries.length} queries`)
  }
  text += theme.fg("muted", ")")

  if (details?.sources && Object.keys(details.sources).length > 0) {
    const sources = Object.entries(details.sources)
      .map(([source, count]) => `${source}=${count}`)
      .join(" | ")
    text += `\n${theme.fg("muted", `  ${sources}`)}`
  }

  if (expanded) {
    const content = result.content[0]
    if (content?.type === "text") {
      text += "\n\n" + theme.fg("toolOutput", content.text)
    }
  } else if (details?.urls?.length) {
    text += "\n  " + theme.fg("dim", details.urls.slice(0, 3).join("\n  "))
    if (details.urls.length > 3) {
      text += theme.fg("muted", `\n  ... +${details.urls.length - 3} more`)
    }
  }

  return new Text(text, 0, 0)
}
