import { scrapeFirecrawl } from "../../providers/firecrawl"
import type { Extractor } from "./types"

export const firecrawl: Extractor = {
  name: "firecrawl",
  async extract(url, signal, options) {
    const formats = options?.rawHtml ? ["rawHtml"] : ["markdown"]
    const json = await scrapeFirecrawl({ url, formats }, signal)
    if (!json) return null

    const data = json?.data
    const meta = data?.metadata
    const metadata: Record<string, unknown> = {}
    if (meta?.title) metadata.title = meta.title
    if (meta?.cacheState) metadata.cacheState = meta.cacheState
    if (meta?.cachedAt) metadata.cachedAt = meta.cachedAt

    if (options?.rawHtml) {
      const html = data?.rawHtml
      if (typeof html !== "string") return null
      return { markdown: "", html: html.trim(), metadata }
    }

    const markdown = data?.markdown
    if (typeof markdown !== "string") return null
    return { markdown: markdown.trim(), metadata }
  },
}
