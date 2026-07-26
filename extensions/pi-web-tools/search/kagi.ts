import type { WebSearchResult } from "./types"

export function formatResults(
  queries: string[],
  resultSets: WebSearchResult[][]
): string {
  const sections: string[] = []
  let counter = 1

  for (let i = 0; i < queries.length; i++) {
    const results = resultSets[i] ?? []
    const body = results
      .map((r) => {
        const lines = [
          `${counter++}: ${r.title}`,
          r.url,
          `Source: ${r.source ?? "unknown"}`,
          `Published: ${r.published ?? "N/A"}`,
          r.snippet ?? "No snippet available",
        ]
        return lines.join("\n")
      })
      .join("\n\n")

    sections.push(`-----\nResults for "${queries[i]}":\n-----\n${body}`)
  }

  return sections.join("\n\n")
}
