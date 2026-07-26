import { extractTavily } from "../../providers/tavily"
import type { Extractor } from "./types"

export const tavily: Extractor = {
  name: "tavily",
  async extract(url, signal) {
    const json = await extractTavily(
      { urls: [url], extract_depth: "advanced" },
      signal
    )
    if (!json) return null

    // Treat non-empty failed_results as failure
    const failed = json?.failed_results
    if (Array.isArray(failed) && failed.length > 0) return null

    const content = json?.results?.[0]?.raw_content
    if (typeof content !== "string") return null
    const title = json?.results?.[0]?.title
    return {
      markdown: content.trim(),
      metadata: title ? { title } : undefined,
    }
  },
}
