import { extractExa } from "./providers/exa"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { extractFirecrawlSummary } from "./providers/firecrawl"
import { createKagiSummaryExtractor } from "./providers/kagi"
import { extractParallelTargeted } from "./providers/parallel"
import { extractTavilyTargeted } from "./providers/tavily"
import type { WebExtractItem, WebExtractOutput, WebExtractProviderParams } from "./providers/types"

type WebExtractProvider = (
  params: WebExtractProviderParams
) => Promise<Array<WebExtractItem | null> | null>

function pendingMask(results: WebExtractItem[]): boolean[] {
  return results.map((item) => !item.source)
}

function markMissing(results: WebExtractItem[]) {
  for (const item of results) {
    if (!item.source) item.error = "No provider returned content for this URL"
  }
}

async function runEnvStage(
  params: Omit<WebExtractProviderParams, "pending" | "signal">,
  providersByName: Record<string, WebExtractProvider>,
  supportedStages: Record<string, string[]>,
  signal?: AbortSignal
): Promise<WebExtractOutput | null> {
  const envStage = process.env.PI_WEB_EXTRACT_STAGE
  if (!envStage) return null

  if (!supportedStages[params.mode].includes(envStage)) {
    throw new Error(
      `Stage "${envStage}" not supported for ${params.mode}. Supported: ${supportedStages[params.mode].join(", ")}`
    )
  }

  const provider = providersByName[envStage]
  const providerResults = await provider({
    ...params,
    pending: params.urls.map(() => true),
    signal,
  })
  if (!providerResults) throw new Error(`Extractor "${envStage}" returned no content`)

  const results: WebExtractItem[] = params.urls.map(
    (url, index) => providerResults[index] ?? { url }
  )
  markMissing(results)

  return {
    mode: params.mode,
    prompt: params.prompt,
    results,
  }
}

export async function runWebExtract(
  pi: ExtensionAPI,
  params: Omit<WebExtractProviderParams, "pending" | "signal">,
  signal?: AbortSignal
): Promise<WebExtractOutput> {
  const extractKagiSummary = createKagiSummaryExtractor(pi)
  const providersByName = {
    firecrawl: extractFirecrawlSummary,
    exa: extractExa,
    parallel: extractParallelTargeted,
    tavily: extractTavilyTargeted,
    kagi: extractKagiSummary,
  }
  const summaryProviders = [extractFirecrawlSummary, extractExa, extractKagiSummary]
  const targetedProviders = [extractExa, extractParallelTargeted, extractTavilyTargeted]
  const supportedStages = {
    summary: ["firecrawl", "exa", "kagi"],
    targeted: ["exa", "parallel", "tavily"],
  }

  const envResult = await runEnvStage(params, providersByName, supportedStages, signal)
  if (envResult) return envResult

  const results: WebExtractItem[] = params.urls.map((url) => ({ url }))
  const providers = params.mode === "summary" ? summaryProviders : targetedProviders

  for (const provider of providers) {
    const pending = pendingMask(results)
    if (!pending.some(Boolean)) break

    const providerResults = await provider({ ...params, pending, signal })
    if (!providerResults) continue

    for (const [index, item] of providerResults.entries()) {
      if (item && !results[index].source) results[index] = item
    }
  }

  markMissing(results)

  return {
    mode: params.mode,
    prompt: params.prompt,
    results,
  }
}
