import { fetchWithTimeout } from "../../providers/http"
import type { Extractor } from "./types"

export const markdownNew: Extractor = {
  name: "markdown-new",
  async extract(url, signal) {
    try {
      const res = await fetchWithTimeout(
        `https://markdown.new/${url}`,
        { signal, timeout: 15_000 }
      )
      if (!res.ok) return null
      const text = await res.text()
      const trimmed = text.trim()
      return trimmed ? { markdown: trimmed } : null
    } catch {
      return null
    }
  },
}
