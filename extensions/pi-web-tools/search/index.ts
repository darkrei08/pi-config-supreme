import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { formatResults } from "./kagi"
import { runWebSearch } from "./pipeline"
import { renderCall, renderResult } from "./render"
import type { WebSearchDetails } from "./types"

export function createWebSearchTool(pi: ExtensionAPI) {
  return {
    name: "web_search" as const,
    label: "Web Search",
    promptSnippet:
      "Search web for current information or docs. Supports multiple parallel queries and allows filtering results by age and website domains. Fetching page contents for search results is also supported.",
    description:
      "Search the web for current information, facts from the internet, or documentation. Args: queries (one or more self-contained search queries, run in parallel), limit (max results per query, default 10, max 50), age (day/week/month/year), includeDomains (restrict results to domains), excludeDomains (exclude domains; cannot be combined with includeDomains), includeContent (request provider-supported page content in results). Results are numbered continuously across all queries.",
    parameters: Type.Object({
      queries: Type.Array(
        Type.String({
          description: "A self-contained search query with enough context to stand alone.",
        }),
        {
          description:
            "One or more search queries to run in parallel. Include essential context within each query for standalone use.",
          minItems: 1,
        }
      ),
      limit: Type.Optional(
        Type.Number({
          description:
            "Maximum number of results per query (default: 10, max: 50)",
          minimum: 1,
          maximum: 50,
        })
      ),
      age: Type.Optional(
        Type.Union(
          [
            Type.Literal("day"),
            Type.Literal("week"),
            Type.Literal("month"),
            Type.Literal("year"),
          ],
          {
            description:
              "Restrict results to content from the last day, week, month, or year where supported.",
          }
        )
      ),
      includeDomains: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Restrict results to these domains. Cannot be combined with excludeDomains.",
        })
      ),
      excludeDomains: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Exclude results from these domains. Cannot be combined with includeDomains.",
        })
      ),
      includeContent: Type.Optional(
        Type.Boolean({
          description:
            "When true, request provider-supported page content from search results. Uses Firecrawl markdown, Tavily markdown, Parallel excerpts, Exa summaries, and You.com markdown; unsupported providers are skipped.",
        })
      ),
    }),

    async execute(_toolCallId: string, params: any, signal?: AbortSignal) {
      const {
        queries,
        limit = 10,
        age,
        includeDomains,
        excludeDomains,
        includeContent,
      } = params

      if (includeDomains?.length && excludeDomains?.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Search failed: includeDomains and excludeDomains cannot be combined.",
            },
          ],
          details: {
            queries,
            limit,
            resultCount: 0,
            error: "includeDomains and excludeDomains cannot be combined",
          } as WebSearchDetails,
          isError: true,
        }
      }

      let output
      try {
        output = await runWebSearch(
          pi,
          {
            queries,
            limit,
            age,
            includeDomains,
            excludeDomains,
            includeContent,
              },
          signal
        )
      } catch (e: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: signal?.aborted
                ? "Search was cancelled."
                : `Search failed: ${e?.message ?? String(e)}`,
            },
          ],
          details: {
            queries,
            limit,
            resultCount: 0,
            error: signal?.aborted ? "cancelled" : e?.message ?? String(e),
          } as WebSearchDetails,
          isError: true,
        }
      }

      const { resultSets, errors } = output

      const totalCount = resultSets.reduce((sum, r) => sum + r.length, 0)
      const allUrls = resultSets.flatMap((r) => r.map((item) => item.url))
      const sources = output.queryOutputs.reduce<Record<string, number>>((acc, queryOutput) => {
        if (queryOutput.source && queryOutput.results.length > 0) {
          acc[queryOutput.source] = (acc[queryOutput.source] ?? 0) + queryOutput.results.length
        }
        return acc
      }, {})

      if (totalCount === 0 && errors.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No results found for: ${queries.join(", ")}`,
            },
          ],
          details: { queries, limit, resultCount: 0 } as WebSearchDetails,
        }
      }

      let text = formatResults(queries, resultSets)
      if (errors.length > 0) text += "\n\nErrors:\n" + errors.join("\n")
      return {
        content: [{ type: "text" as const, text }],
        details: {
          queries,
          limit,
          resultCount: totalCount,
          urls: allUrls,
          sources,
        } as WebSearchDetails,
      }
    },

    renderCall,
    renderResult,
  }
}
