import { postJson } from "./http"

export interface ExaContentsParams {
  urls?: string[]
  ids?: string[]
  text?: boolean | Record<string, unknown>
  summary?: boolean | Record<string, unknown>
}

export async function getExaContents(
  params: ExaContentsParams,
  signal?: AbortSignal
): Promise<any | null> {
  return postJson({
    url: "https://api.exa.ai/contents",
    apiKeyEnv: "PI_WEB_FETCH_EXA_API_KEY",
    headers: (apiKey) => ({
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    }),
    body: params,
    signal,
  })
}
