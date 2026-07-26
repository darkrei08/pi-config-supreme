import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { WebExtractItem, WebExtractProviderParams } from "./types"
import { emptyScatter, hasAny, selectPending } from "./utils"

const TIMEOUT_MS = 30_000

interface KagiResponse {
  data?: {
    markdown?: unknown
    title?: unknown
    url?: unknown
  }
}

function extractMarkdown(response: KagiResponse): string | null {
  const content = response.data?.markdown
  return typeof content === "string" && content.trim() ? content.trim() : null
}

export function createKagiSummaryExtractor(pi: ExtensionAPI) {
  return async function extractKagiSummary({
    urls,
    mode,
    pending,
    signal,
  }: WebExtractProviderParams): Promise<Array<WebExtractItem | null> | null> {
    if (mode !== "summary") return null

    const selected = selectPending(urls, pending)
    if (selected.length === 0) return null

    const settled = await Promise.allSettled(
      selected.map(({ url }) =>
        pi.exec(
          "kagi",
          [
            "summarize",
            "--subscriber",
            "--length",
            "long",
            "--summary-type",
            "keypoints",
            "--url",
            url,
          ],
          { signal, timeout: TIMEOUT_MS }
        )
      )
    )

    const output = emptyScatter<WebExtractItem>(urls)
    for (const [selectedIndex, result] of settled.entries()) {
      if (result.status === "rejected") continue

      const { stdout, code } = result.value
      if (code !== 0) continue

      try {
        const response = JSON.parse(stdout) as KagiResponse
        const markdown = extractMarkdown(response)
        if (!markdown) continue

        const { url, index } = selected[selectedIndex]
        const title = response.data?.title
        output[index] = {
          url,
          title: typeof title === "string" ? title : undefined,
          content: markdown,
          source: "kagi",
          metadata: response.data,
        }
      } catch {
        continue
      }
    }

    return hasAny(output) ? output : null
  }
}
