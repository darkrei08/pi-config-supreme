import { fetchMarkdownViaContentNegotiation } from "./content-negotiation"
import { defuddle } from "./defuddle"
import { apiExtractors, firecrawl, jina, you } from "./extractors"
import { buildResult } from "./result"
import type { FetchResult } from "./result"

export type { ExtractionStage, FetchResult } from "./result"

async function runEnvStage(
  url: string,
  rawHtml: boolean,
  signal?: AbortSignal
): Promise<FetchResult | null> {
  const envStage = process.env.PI_WEB_FETCH_STAGE
  if (!envStage) return null

  if (envStage === "defuddle") return defuddle(url, !rawHtml, signal)

  if (!rawHtml && envStage === "content-negotiation") {
    const result = await fetchMarkdownViaContentNegotiation(url, signal)
    if (result) return result
    throw new Error("Content negotiation failed — server did not return markdown")
  }

  const extractors = rawHtml ? [jina, firecrawl, you] : apiExtractors
  const extractor = extractors.find((e) => e.name === envStage)
  if (extractor) {
    const extracted = await extractor.extract(url, signal, { rawHtml })
    if (extracted) return buildResult(url, extracted, extractor.name, rawHtml)
    throw new Error(
      rawHtml
        ? `Extractor "${envStage}" returned no HTML content`
        : `Extractor "${envStage}" returned no content`
    )
  }

  if (rawHtml) {
    throw new Error(
      `Stage "${envStage}" not supported for rawHtml. Supported: jina-ai, firecrawl, you, defuddle`
    )
  }

  throw new Error(`Unknown stage "${envStage}"`)
}

export async function fetchRawHtml(
  url: string,
  signal?: AbortSignal
): Promise<FetchResult> {
  const envResult = await runEnvStage(url, true, signal)
  if (envResult) return envResult

  for (const extractor of [jina, firecrawl, you]) {
    const result = await extractor.extract(url, signal, { rawHtml: true })
    if (result) return buildResult(url, result, extractor.name, true)
  }

  return defuddle(url, false, signal)
}

export async function fetchAndExtract(
  url: string,
  signal?: AbortSignal
): Promise<FetchResult> {
  const envResult = await runEnvStage(url, false, signal)
  if (envResult) return envResult

  const markdownResult = await fetchMarkdownViaContentNegotiation(url, signal)
  if (markdownResult) return markdownResult

  for (const extractor of apiExtractors) {
    const result = await extractor.extract(url, signal)
    if (result) return buildResult(url, result, extractor.name)
  }

  return defuddle(url, true, signal)
}
