import { fetchWithTimeout } from "../providers/http"
import { buildResult } from "./result"
import type { FetchResult } from "./result"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

export async function fetchMarkdownViaContentNegotiation(
  url: string,
  signal?: AbortSignal
): Promise<FetchResult | null> {
  const res = await fetchWithTimeout(url, {
    signal,
    headers: {
      "User-Agent": UA,
      Accept: "text/markdown",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  })

  if (!res.ok || !(res.headers.get("content-type") || "").includes("markdown")) {
    return null
  }

  const raw = await res.text()
  return raw.trim()
    ? buildResult(url, { markdown: raw }, "content-negotiation")
    : null
}
