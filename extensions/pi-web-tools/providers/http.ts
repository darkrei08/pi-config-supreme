export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number
}

export async function fetchWithTimeout(
  url: string,
  init: FetchWithTimeoutOptions = {},
  defaultTimeout = 30_000
): Promise<Response> {
  const { timeout = defaultTimeout, signal, ...fetchInit } = init
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timeoutId = setTimeout(abort, timeout)

  try {
    if (signal) {
      if (signal.aborted) abort()
      else signal.addEventListener("abort", abort, { once: true })
    }
    return await fetch(url, { ...fetchInit, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener("abort", abort)
  }
}

export async function fetchJson<T>(
  url: string,
  init: FetchWithTimeoutOptions = {}
): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(url, init)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export interface PostJsonOptions {
  url: string
  apiKeyEnv: string
  headers: Record<string, string> | ((apiKey: string) => Record<string, string>)
  body: unknown
  signal?: AbortSignal
  timeout?: number
}

export async function postJson<T>({
  url,
  apiKeyEnv,
  headers,
  body,
  signal,
  timeout,
}: PostJsonOptions): Promise<T | null> {
  const apiKey = process.env[apiKeyEnv]
  if (!apiKey) return null

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: typeof headers === "function" ? headers(apiKey) : headers,
      body: JSON.stringify(body),
      signal,
      timeout,
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
