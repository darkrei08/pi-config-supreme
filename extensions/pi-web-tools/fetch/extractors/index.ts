import type { Extractor } from "./types"
import { exa } from "./exa"
import { firecrawl } from "./firecrawl"
import { jina } from "./jina"
import { markdownNew } from "./markdown-new"
import { parallel } from "./parallel"
import { tavily } from "./tavily"
import { you } from "./you"

export type { Extractor, ExtractResult } from "./types"
export { exa, firecrawl, jina, markdownNew, parallel, tavily, you }

export const apiExtractors: Extractor[] = [
  jina,
  firecrawl,
  parallel,
  exa,
  tavily,
  you,
  markdownNew,
]
