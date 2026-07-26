import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { SearchFilters, WebSearchResult } from "./types"
import {
  createKagiSearchProvider,
  searchExa,
  searchFirecrawl,
  searchParallel,
  searchTavily,
  searchYou,
  type WebSearchProvider,
} from "./providers"

export interface WebSearchPipelineParams extends SearchFilters {
  queries: string[]
  limit: number
}

export interface WebSearchQueryOutput {
  query: string
  source?: string
  results: WebSearchResult[]
  errors: string[]
}

export interface WebSearchPipelineOutput {
  resultSets: WebSearchResult[][]
  queryOutputs: WebSearchQueryOutput[]
  errors: string[]
}

const providerNames = ["parallel", "exa", "kagi", "you", "firecrawl", "tavily"] as const
const contentProviderNames = ["parallel", "exa", "you", "firecrawl", "tavily"] as const

type ProviderName = (typeof providerNames)[number]

function providers(pi: ExtensionAPI): Record<ProviderName, WebSearchProvider> {
  return {
    kagi: createKagiSearchProvider(pi),
    firecrawl: searchFirecrawl,
    tavily: searchTavily,
    parallel: searchParallel,
    exa: searchExa,
    you: searchYou,
  }
}

function providerOrder(includeContent?: boolean): ProviderName[] {
  const supported = includeContent ? contentProviderNames : providerNames
  const forced = process.env.PI_WEB_SEARCH_STAGE
  if (!forced) return [...supported]
  if (!supported.includes(forced as (typeof supported)[number])) {
    throw new Error(`Stage "${forced}" not supported for web_search. Supported: ${supported.join(", ")}`)
  }
  return [forced as ProviderName]
}

export async function runWebSearch(
  pi: ExtensionAPI,
  params: WebSearchPipelineParams,
  signal?: AbortSignal
): Promise<WebSearchPipelineOutput> {
  const registry = providers(pi)
  const order = providerOrder(params.includeContent)

  const queryOutputs = await Promise.all(
    params.queries.map(async (query): Promise<WebSearchQueryOutput> => {
      const errors: string[] = []
      for (const name of order) {
        if (signal?.aborted) throw new Error("cancelled")
        try {
          const output = await registry[name]({ ...params, query, signal })
          if (!output) continue
          if (output.results.length > 0) {
            return { query, source: output.source, results: output.results, errors }
          }
          errors.push(`${name}: no results`)
        } catch (e: any) {
          errors.push(`${name}: ${e?.message ?? String(e)}`)
        }
      }

      return { query, results: [], errors }
    })
  )

  return {
    resultSets: queryOutputs.map((output) => output.results),
    queryOutputs,
    errors: queryOutputs.flatMap((output) =>
      output.errors.map((error) => `Query "${output.query}": ${error}`)
    ),
  }
}
