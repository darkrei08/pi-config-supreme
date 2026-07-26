import type { ExtractResult } from "./extractors"

export type ExtractionStage =
  | "content-negotiation"
  | "jina-ai"
  | "firecrawl"
  | "parallel"
  | "tavily"
  | "exa"
  | "you"
  | "markdown-new"
  | "defuddle"

export interface FetchResult {
  title: string
  content: string
  byline: string
  length: number
  url: string
  stage: ExtractionStage
  metadata?: Record<string, unknown>
}

function extractTitle(md: string, fallback: string): string {
  const match = md.match(/^#\s+(.+)$/m)
  return match?.[1] || fallback
}

export function buildResult(
  url: string,
  extracted: ExtractResult,
  stage: string,
  rawHtml = false
): FetchResult {
  const content = rawHtml ? (extracted.html ?? "") : extracted.markdown
  const title = extracted.title || (rawHtml ? url : extractTitle(content, url))

  return {
    title,
    content,
    byline: extracted.byline || "",
    length: content.length,
    url,
    stage: stage as ExtractionStage,
    metadata: extracted.metadata,
  }
}
