import { getExaContents } from "../../providers/exa"
import type { WebExtractItem, WebExtractProviderParams } from "./types"
import { emptyScatter, hasAny, selectPending } from "./utils"

function statusOk(json: any, url: string): boolean {
  const statuses = json?.statuses
  if (!Array.isArray(statuses)) return true
  const status = statuses.find(
    (s: any) => s?.id === url || s?.id === decodeURIComponent(url)
  )
  return Boolean(status && status.status === "success")
}

export async function extractExa({
  urls,
  mode,
  prompt,
  pending,
  signal,
}: WebExtractProviderParams): Promise<Array<WebExtractItem | null> | null> {
  const selected = selectPending(urls, pending)
  if (selected.length === 0) return null

  const summary = mode === "targeted" ? { query: prompt } : true
  const json = await getExaContents(
    { urls: selected.map(({ url }) => url), summary, text: false },
    signal
  )
  if (!json) return null

  const output = emptyScatter<WebExtractItem>(urls)
  for (const [resultIndex, { url, index }] of selected.entries()) {
    if (!statusOk(json, url)) continue
    const result = json?.results?.[resultIndex]
    const content = result?.summary
    if (typeof content !== "string" || !content.trim()) continue
    output[index] = {
      url,
      title: result?.title,
      content: content.trim(),
      source: "exa",
      metadata: result,
    }
  }

  return hasAny(output) ? output : null
}
