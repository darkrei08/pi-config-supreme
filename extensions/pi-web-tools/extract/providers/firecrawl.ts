import { scrapeFirecrawl } from "../../providers/firecrawl"
import type { WebExtractItem, WebExtractProviderParams } from "./types"
import { hasAny } from "./utils"

export async function extractFirecrawlSummary({
  urls,
  mode,
  pending,
  signal,
}: WebExtractProviderParams): Promise<Array<WebExtractItem | null> | null> {
  if (mode !== "summary") return null

  const results = await Promise.all(
    urls.map(async (url, index) => {
      if (pending && !pending[index]) return null
      const json = await scrapeFirecrawl(
        { url, formats: [{ type: "summary" }] },
        signal
      )
      const summary = json?.data?.summary
      if (typeof summary !== "string" || !summary.trim()) return null
      const metadata = json?.data?.metadata
      const title = metadata?.title
      return {
        url,
        title: typeof title === "string" ? title : undefined,
        content: summary.trim(),
        source: "firecrawl" as const,
        metadata,
      }
    })
  )

  return hasAny(results) ? results : null
}
