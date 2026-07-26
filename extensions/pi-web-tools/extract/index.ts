import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { renderCall, renderResult } from "./render"
import { renderMarkdown } from "./render-markdown"
import { runWebExtract } from "./pipeline"
import { truncateToTemp } from "../fetch/truncate"

const parameters = Type.Object({
  urls: Type.Array(Type.String({ description: "URL to extract from" }), {
    minItems: 1,
    maxItems: 5,
    description: "URLs to extract from. Maximum 5 URLs.",
  }),
  mode: Type.Union([Type.Literal("summary"), Type.Literal("targeted")], {
    description:
      "summary = summarize each URL. targeted = extract information relevant to the prompt.",
  }),
  prompt: Type.Optional(
    Type.String({
      description:
        "Extraction instruction. Required for targeted mode; ignored for summary mode.",
    })
  ),
})

function sourceCounts(results: Array<{ source?: string }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const result of results) {
    if (!result.source) continue
    counts[result.source] = (counts[result.source] ?? 0) + 1
  }
  return counts
}

export function createWebExtractTool(pi: ExtensionAPI) {
  return {
    name: "web_extract" as const,
    label: "Web Extract",
    promptSnippet: "Extract summaries or targeted facts from URLs",
    description:
      "Extract summaries or targeted information from up to 5 URLs. Use summary mode to understand pages. Use targeted mode with a prompt to pull specific facts or evidence from pages.",
    parameters,
    renderCall,
    renderResult,
    async execute(_toolCallId: string, params: any, signal?: AbortSignal) {
      try {
        const urls = Array.isArray(params.urls)
          ? params.urls.map((url: unknown) => String(url).trim()).filter(Boolean)
          : []
        const mode = params.mode
        const rawPrompt = typeof params.prompt === "string" ? params.prompt.trim() : undefined
        const prompt = mode === "targeted" ? rawPrompt : undefined

        if (urls.length < 1) throw new Error("urls must contain at least 1 URL")
        if (urls.length > 5) throw new Error("urls must contain at most 5 URLs")
        if (mode !== "summary" && mode !== "targeted") {
          throw new Error("mode must be 'summary' or 'targeted'")
        }
        if (mode === "targeted" && !prompt) {
          throw new Error("prompt is required for targeted mode")
        }

        const output = await runWebExtract(pi, { urls, mode, prompt }, signal)
        const successCount = output.results.filter((result) => result.source).length
        if (successCount === 0) {
          throw new Error("No provider returned content for any URL")
        }

        const markdown = renderMarkdown(output)
        const truncated = await truncateToTemp(
          markdown,
          urls[0],
          {
            mode,
            prompt,
            urlCount: urls.length,
            successCount,
            sources: sourceCounts(output.results),
          },
          "md"
        )

        return {
          content: [
            {
              type: "text" as const,
              text: truncated.text,
              source: "web_extract",
              metadata: { mode, prompt, sources: sourceCounts(output.results) },
            },
          ],
          details: truncated.details,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
          details: { error: message },
        }
      }
    },
  }
}
