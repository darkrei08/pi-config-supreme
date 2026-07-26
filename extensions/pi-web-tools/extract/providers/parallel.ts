import { extractParallel } from "../../providers/parallel"
import type { WebExtractItem, WebExtractProviderParams } from "./types"
import { emptyScatter, hasAny, selectPending } from "./utils"

function failedUrls(json: any): Set<string> {
  const failed = new Set<string>()
  if (!Array.isArray(json?.errors)) return failed
  for (const error of json.errors) {
    if (typeof error?.url === "string") failed.add(error.url)
  }
  return failed
}

export async function extractParallelTargeted({
  urls,
  mode,
  prompt,
  pending,
  signal,
}: WebExtractProviderParams): Promise<Array<WebExtractItem | null> | null> {
  if (mode !== "targeted") return null

  const selected = selectPending(urls, pending)
  if (selected.length === 0) return null

  const json = await extractParallel(
    { urls: selected.map(({ url }) => url), objective: prompt },
    signal
  )
  if (!json) return null

  const failed = failedUrls(json)
  const output = emptyScatter<WebExtractItem>(urls)
  for (const [resultIndex, { url, index }] of selected.entries()) {
    if (failed.has(url)) continue
    const result = json?.results?.[resultIndex]
    const excerpts = result?.excerpts
    if (!Array.isArray(excerpts) || excerpts.length === 0) continue
    const clean = excerpts.filter((excerpt: unknown): excerpt is string =>
      typeof excerpt === "string" && excerpt.trim().length > 0
    )
    if (clean.length === 0) continue
    output[index] = {
      url,
      title: result?.title,
      excerpts: clean.map((excerpt) => excerpt.trim()),
      source: "parallel",
      metadata: result,
    }
  }

  return hasAny(output) ? output : null
}
