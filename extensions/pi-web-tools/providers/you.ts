import { postJson } from "./http"

export interface YouContentsParams {
  urls: string[]
  formats: Array<"html" | "markdown">
  crawl_timeout?: number
}

export async function fetchYouContents(
  params: YouContentsParams,
  signal?: AbortSignal
): Promise<any | null> {
  return postJson({
    url: "https://ydc-index.io/v1/contents",
    apiKeyEnv: "PI_WEB_FETCH_YOU_API_KEY",
    headers: (apiKey) => ({
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    }),
    body: params,
    signal,
  })
}
