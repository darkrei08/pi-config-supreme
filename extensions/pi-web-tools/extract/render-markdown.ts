import type { WebExtractOutput } from "./providers/types"

function renderItemContent(item: WebExtractOutput["results"][number]): string {
  if (item.error) return `Error: ${item.error}`

  const parts: string[] = []
  if (item.source) parts.push(`Source: ${item.source}`)
  if (item.title) parts.push(`Title: ${item.title}`)
  if (parts.length > 0) parts.push("")

  if (item.content) parts.push(item.content)
  if (item.excerpts && item.excerpts.length > 0) {
    parts.push("### Excerpts")
    parts.push("")
    parts.push(...item.excerpts.map((excerpt) => `- ${excerpt}`))
  }

  return parts.join("\n")
}

export function renderMarkdown(output: WebExtractOutput): string {
  const lines: string[] = []

  for (const item of output.results) {
    lines.push("", `## ${item.url}`, "", renderItemContent(item))
  }

  return lines.join("\n")
}
