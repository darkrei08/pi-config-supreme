import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent"

export interface TruncationResult {
  text: string
  details: Record<string, any>
}

export async function truncateToTemp(
  fullText: string,
  url: string,
  extraDetails: Record<string, any> = {},
  ext = "md"
): Promise<TruncationResult> {
  const t = truncateHead(fullText, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  })

  if (!t.truncated) {
    return {
      text: t.content,
      details: { url, totalLines: t.totalLines, ...extraDetails },
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "pi-web-tools-"))
  const tempFile = join(tempDir, `output.${ext}`)
  await writeFile(tempFile, fullText, "utf8")

  let output = t.content
  output += `\n\n[Truncated: showing ${t.outputLines} of ${t.totalLines} lines`
  output += ` (${formatSize(t.outputBytes)} of ${formatSize(t.totalBytes)}).`
  output += ` Full output saved to: ${tempFile}]`

  return {
    text: output,
    details: {
      url,
      truncated: true,
      totalLines: t.totalLines,
      fullOutputPath: tempFile,
      ...extraDetails,
    },
  }
}
