import { Type } from "@sinclair/typebox"
import { domainHandlers } from "./domain-handlers"
import { fetchAndExtract, fetchRawHtml } from "./pipeline"
import { renderCall, renderResult } from "./render"
import { truncateToTemp } from "./truncate"
import { validateFetchUrl } from "./url-safety"

export const webFetchTool = {
  name: "web_fetch" as const,
  label: "Web Fetch",
  promptSnippet: "Fetch URL content as clean Markdown or raw HTML",
  description:
    "Fetch a URL and return clean, readable content as Markdown, or raw HTML when requested. Output is truncated to agent limits. If truncated, full output is saved to a temp file — use the read tool to page through it.",
  parameters: Type.Object({
    url: Type.String({ description: "URL to fetch" }),
    rawHtml: Type.Optional(
      Type.Boolean({
        default: false,
        description: "Return raw HTML instead of Markdown. Default: false.",
      })
    ),
  }),

  async execute(_toolCallId: string, params: any, signal?: AbortSignal) {
    try {
      const url = validateFetchUrl(params.url)

      // Try domain handlers first
      for (const handler of domainHandlers) {
        const out = await handler(url, signal)
        if (out !== null) {
          const { text, details } = await truncateToTemp(out, url, {
            method: "domain-handler",
          })
          const result = {
            content: [{ type: "text" as const, text, source: "domain-handler" }],
            details,
          }
          return result
        }
      }

      // Normal fetch pipeline
      const rawHtml = params.rawHtml === true
      const result = rawHtml
        ? await fetchRawHtml(url, signal)
        : await fetchAndExtract(url, signal)

      let fullText: string
      if (rawHtml) {
        fullText = result.content
      } else {
        const header = [
          result.title && `# ${result.title}`,
          result.byline && `*${result.byline}*`,
          `Source: ${result.url}`,
        ]
          .filter(Boolean)
          .join("\n")
        fullText = `${header}\n\n---\n\n${result.content}`
      }

      const { text, details } = await truncateToTemp(
        fullText,
        result.url,
        {
          title: result.title,
          stage: result.stage,
        },
        rawHtml ? "html" : "md"
      )

      return {
        content: [
          {
            type: "text" as const,
            text,
            source: result.stage,
            metadata: result.metadata,
          },
        ],
        details,
      }
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch ${params.url}: ${err.message}`,
            source: "error",
          },
        ],
        details: { url: params.url, error: err.message },
        isError: true,
      }
    }
  },

  renderCall,
  renderResult,
}
