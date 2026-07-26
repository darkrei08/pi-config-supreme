import { postJson } from "./http"

let sessionId: string | undefined

export interface ParallelExtractParams {
  urls: string[]
  objective?: string
  advanced_settings?: Record<string, unknown>
  max_chars_total?: number
}

export async function extractParallel(
  params: ParallelExtractParams,
  signal?: AbortSignal
): Promise<any | null> {
  const body: Record<string, unknown> = { ...params }
  if (sessionId) body.session_id = sessionId

  const json = await postJson<any>({
    url: "https://api.parallel.ai/v1/extract",
    apiKeyEnv: "PI_WEB_FETCH_PARALLEL_API_KEY",
    headers: (apiKey) => ({
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    }),
    body,
    signal,
  })
  if (json?.session_id) sessionId = json.session_id
  return json
}
