import { getExaContents } from "../../providers/exa"
import type { Extractor } from "./types"

export const exa: Extractor = {
  name: "exa",
  async extract(url, signal) {
    const json = await getExaContents(
      { ids: [url], text: { verbosity: "full" } },
      signal
    )
    if (!json) return null

    // Treat any non-success status as failure
    const statuses = json?.statuses
    if (Array.isArray(statuses)) {
      const ourStatus = statuses.find(
        (s: any) => s?.id === url || s?.id === decodeURIComponent(url)
      )
      if (!ourStatus || ourStatus.status !== "success") return null
    }

    const result = json?.results?.[0]
    const text = result?.text
    if (typeof text !== "string") return null
    return {
      markdown: text.trim(),
      title: result?.title,
      metadata: result?.title ? { title: result.title } : undefined,
    }
  },
}
