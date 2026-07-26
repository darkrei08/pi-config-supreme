import { extractTavily } from "../../providers/tavily"
import type { WebExtractItem, WebExtractProviderParams } from "./types"
import { emptyScatter, hasAny, selectPending } from "./utils"

function failedUrls(json: any): Set<string> {
  const failed = new Set<string>()
  if (!Array.isArray(json?.failed_results)) return failed
  for (const item of json.failed_results) {
    if (typeof item?.url === "string") failed.add(item.url)
  }
  return failed
}

export async function extractTavilyTargeted({
  urls,
  mode,
  prompt,
  pending,
  signal,
}: WebExtractProviderParams): Promise<Array<WebExtractItem | null> | null> {
  if (mode !== "targeted") return null

  const selected = selectPending(urls, pending)
  if (selected.length === 0) return null

  const json = await extractTavily(
    {
      urls: selected.map(({ url }) => url),
      query: prompt,
      chunks_per_source: 5,
      extract_depth: "advanced",
      format: "markdown",
    },
    signal
  )
  if (!json) return null

  const failed = failedUrls(json)
  const output = emptyScatter<WebExtractItem>(urls)
  for (const [resultIndex, { url, index }] of selected.entries()) {
    if (failed.has(url)) continue
    const result = json?.results?.[resultIndex]
    const content = result?.raw_content
    if (typeof content !== "string" || !content.trim()) continue
    output[index] = {
      url,
      title: result?.title,
      content: content.trim(),
      source: "tavily",
      metadata: result,
    }
  }

  return hasAny(output) ? output : null
}
