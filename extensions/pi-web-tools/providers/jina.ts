import { postJson } from "./http"

export interface JinaReaderParams {
  url: string
  rawHtml?: boolean
}

export async function fetchJinaReader(
  params: JinaReaderParams,
  signal?: AbortSignal
): Promise<any | null> {
  return postJson({
    url: "https://r.jina.ai/",
    apiKeyEnv: "PI_WEB_FETCH_JINA_API_KEY",
    headers: (apiKey) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      }
      if (params.rawHtml) headers["X-Respond-With"] = "html"
      return headers
    },
    body: { url: params.url },
    signal,
    timeout: 15_000,
  })
}
