import { extractParallel } from "../../providers/parallel"
import type { Extractor } from "./types"

export const parallel: Extractor = {
  name: "parallel",
  async extract(url, signal) {
    const json = await extractParallel(
      {
        urls: [url],
        advanced_settings: { full_content: true },
      },
      signal
    )
    if (!json) return null

    // Treat non-empty errors array as failure
    if (json?.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      return null
    }

    const result = json?.results?.[0]
    const markdown =
      result?.full_content ||
      (Array.isArray(result?.excerpts) ? result.excerpts.join("\n\n") : null)
    if (typeof markdown !== "string") return null
    const metadata: Record<string, unknown> = {}
    if (result?.title) metadata.title = result.title
    return {
      markdown: markdown.trim(),
      title: result?.title,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }
  },
}
