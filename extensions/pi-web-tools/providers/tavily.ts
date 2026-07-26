import { postJson } from "./http"

export interface TavilyExtractParams {
  urls: string | string[]
  query?: string
  chunks_per_source?: number
  extract_depth?: "basic" | "advanced"
  format?: "markdown" | "text"
}

export async function extractTavily(
  params: TavilyExtractParams,
  signal?: AbortSignal
): Promise<any | null> {
  return postJson({
    url: "https://api.tavily.com/extract",
    apiKeyEnv: "PI_WEB_FETCH_TAVILY_API_KEY",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
    body: params,
    signal,
  })
}
