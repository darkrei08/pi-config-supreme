import { fetchWithTimeout } from "../providers/http"
import type { FetchResult } from "./result"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

function patchJSDOMQuerySelectorAll(window: Window): void {
  const w = window as any
  const patch = (proto: any) => {
    const original = proto.querySelectorAll
    proto.querySelectorAll = function (selector: string) {
      try {
        return original.call(this, selector)
      } catch (e: any) {
        if (e instanceof w.DOMException && e.name === "SyntaxError") {
          return original.call(this, "__defuddle_unsupported_selector__")
        }
        throw e
      }
    }
  }
  patch(w.Document.prototype)
  patch(w.Element.prototype)
}

function cleanMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]*?)\]\([^)]*?\)/g, "$1")
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^#+\s*$/gm, "")
    .replace(
      /^.*(Share|Tweet|Pin|Email|Print)(\s+(this|on|via))?.{0,20}$/gim,
      ""
    )
    .replace(/^.*(cookie|consent|privacy policy|accept all).*$/gim, "")
    .trim()
}

export async function defuddle(
  url: string,
  markdown: boolean,
  signal?: AbortSignal
): Promise<FetchResult> {
  const res = await fetchWithTimeout(url, {
    signal,
    headers: {
      "User-Agent": UA,
      Accept:
        "text/html, application/xhtml+xml;q=0.9, application/xml;q=0.8, */*;q=0.1",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

  const [{ Defuddle }, { JSDOM, VirtualConsole }] = await Promise.all([
    import("defuddle/node"),
    import("jsdom"),
  ])
  const virtualConsole = new VirtualConsole()
  virtualConsole.on("error", () => {})
  virtualConsole.on("jsdomError", () => {})

  const rawHtml = await res.text()
  const dom = new JSDOM(rawHtml, { url, virtualConsole })
  patchJSDOMQuerySelectorAll(dom.window)

  const defResult = await Defuddle(dom.window.document, url, {
    markdown,
    removeImages: true,
  })

  if (!defResult.content?.trim()) {
    throw new Error(
      markdown
        ? "Could not extract content from this page"
        : "Could not extract HTML content from this page"
    )
  }

  const content = markdown ? cleanMarkdown(defResult.content) : defResult.content

  return {
    title: defResult.title || "",
    content,
    byline: defResult.author || "",
    length: defResult.wordCount || content.length,
    url,
    stage: "defuddle",
  }
}
