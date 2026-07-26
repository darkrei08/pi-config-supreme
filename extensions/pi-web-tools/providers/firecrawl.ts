import { postJson } from "./http"

export interface FirecrawlScrapeParams {
  url: string
  formats: Array<string | Record<string, unknown>>
}

export async function scrapeFirecrawl(
  params: FirecrawlScrapeParams,
  signal?: AbortSignal
): Promise<any | null> {
  return postJson({
    url: "https://api.firecrawl.dev/v2/scrape",
    apiKeyEnv: "PI_WEB_FETCH_FIRECRAWL_API_KEY",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
    body: params,
    signal,
  })
}
