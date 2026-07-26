import { fetchYouContents } from "../../providers/you"
import type { Extractor } from "./types"

export const you: Extractor = {
  name: "you",
  async extract(url, signal, options) {
    const formats = options?.rawHtml ? ["html" as const] : ["markdown" as const]
    const json = await fetchYouContents(
      { urls: [url], formats, crawl_timeout: 10 },
      signal
    )
    if (!json) return null

    const item = Array.isArray(json) ? json[0] : null

    if (options?.rawHtml) {
      const html = item?.html
      if (typeof html !== "string") return null
      return {
        markdown: "",
        html: html.trim(),
        title: item?.title,
        metadata: item?.title ? { title: item.title } : undefined,
      }
    }

    const markdown = item?.markdown
    if (typeof markdown !== "string") return null
    return {
      markdown: markdown.trim(),
      title: item?.title,
      metadata: item?.title ? { title: item.title } : undefined,
    }
  },
}
