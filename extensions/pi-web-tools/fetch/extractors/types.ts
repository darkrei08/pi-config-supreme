export interface ExtractResult {
  markdown: string
  /** Raw HTML content when extractor is in rawHtml mode */
  html?: string
  title?: string
  byline?: string
  metadata?: Record<string, unknown>
}

export interface ExtractorOptions {
  rawHtml?: boolean
}

export interface Extractor {
  name: string
  extract(url: string, signal?: AbortSignal, options?: ExtractorOptions): Promise<ExtractResult | null>
}
