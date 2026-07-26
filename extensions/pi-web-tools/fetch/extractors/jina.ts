import { fetchJinaReader } from "../../providers/jina"
import type { Extractor } from "./types"

export const jina: Extractor = {
  name: "jina-ai",
  async extract(url, signal, options) {
    const json = await fetchJinaReader({ url, rawHtml: options?.rawHtml }, signal)
    if (!json) return null

    if (options?.rawHtml) {
      const html = json?.data?.html || json?.data?.content
      if (typeof html !== "string") return null
      return { markdown: "", html: html.trim() }
    }

    const content = json?.data?.content
    if (typeof content !== "string") return null
    const title = json?.data?.title
    return {
      markdown: content.trim(),
      metadata: title ? { title } : undefined,
    }
  },
}
