export type WebExtractMode = "summary" | "targeted"
export type WebExtractSource = "firecrawl" | "exa" | "parallel" | "tavily" | "kagi"

export interface WebExtractProviderParams {
  urls: string[]
  mode: WebExtractMode
  prompt?: string
  pending?: boolean[]
  signal?: AbortSignal
}

export interface WebExtractItem {
  url: string
  title?: string
  content?: string
  excerpts?: string[]
  error?: string
  source?: WebExtractSource
  metadata?: Record<string, unknown>
}

export interface WebExtractOutput {
  mode: WebExtractMode
  prompt?: string
  results: WebExtractItem[]
  metadata?: Record<string, unknown>
}
