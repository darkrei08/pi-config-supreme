import { spawn } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { fileURLToPath } from "node:url"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent"
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui"
import { Type } from "@sinclair/typebox"

interface ClaudeConfig {
  model?: string
  effort?: string
  allowDangerouslySkipPermissions?: boolean
  allowedTools?: string[] | null
  additionalArgs?: string[]
  blockTimeoutMs?: number
  closePaneOnCompletion?: boolean
}

interface RunDetails {
  runId: string
  mode: "background" | "interactive"
  async: boolean
  exitCode?: number | null
  elapsedMs?: number
  transcriptPath?: string
  status?: "started"
}

interface RunResult {
  runId: string
  mode: "background" | "interactive"
  async: boolean
  report: string
  exitCode: number | null
  elapsedMs: number
  transcriptPath?: string
}

interface RunningClaude {
  runId: string
  prompt: string
  mode: "background" | "interactive"
  startTime: number
}

interface ClaudeResultMessageDetails extends RunDetails {
  prompt: string
}

interface ThemeLike {
  fg(name: string, text: string): string
  bg(name: string, text: string): string
  bold(text: string): string
}

const DEFAULT_BLOCK_TIMEOUT_MS = 600_000
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "plugin")
const runningClaude = new Map<string, RunningClaude>()
let latestCtx: ExtensionContext | null = null
let widgetInterval: ReturnType<typeof setInterval> | null = null

function loadClaudeConfig(): ClaudeConfig {
  const configPath = join(homedir(), ".pi", "agent", "pi-spawn-claude-code.json")
  try {
    if (!existsSync(configPath)) return {}
    return JSON.parse(readFileSync(configPath, "utf-8")) as ClaudeConfig
  } catch {
    return {}
  }
}

function buildClaudeArgs(
  prompt: string,
  mode: "background" | "interactive",
  config: ClaudeConfig,
  resumeSessionId?: string
): string[] {
  const args: string[] = []
  if (mode === "background") args.push("-p")
  if (config.allowDangerouslySkipPermissions !== false)
    args.push("--allow-dangerously-skip-permissions")
  if (config.model) args.push("--model", config.model)
  if (config.effort) args.push("--effort", config.effort)
  if (config.allowedTools)
    args.push("--allowed-tools", config.allowedTools.join(","))
  if (mode === "interactive" && existsSync(PLUGIN_DIR))
    args.push("--plugin-dir", PLUGIN_DIR)
  if (resumeSessionId) args.push("--resume", resumeSessionId)
  if (config.additionalArgs?.length) args.push(...config.additionalArgs)
  args.push(prompt)

  return args
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function commandFromArgs(command: string, args: string[]): string {
  return [command, ...args].map(shellEscape).join(" ")
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatResult(result: RunResult): string {
  const lines = [
    `Claude run ${result.runId} completed.`,
    "",
    `Mode: ${result.mode}`,
    `Exit code: ${result.exitCode ?? "unknown"}`,
    `Elapsed: ${formatDuration(result.elapsedMs)}`,
  ]
  if (result.transcriptPath) lines.push(`Transcript: ${result.transcriptPath}`)
  lines.push("", result.report)
  return lines.join("\n")
}

function padVisible(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)))
}

function renderPanel(
  title: string,
  subtitle: string,
  body: string[],
  width: number,
  theme: ThemeLike,
  tone: "running" | "success" | "error" = "running"
): string[] {
  const panelWidth = Math.max(44, Math.min(width, 110))
  const innerWidth = panelWidth - 4
  const borderColor = tone === "error" ? "error" : tone === "success" ? "success" : "accent"
  const bgColor = tone === "error" ? "toolErrorBg" : "toolSuccessBg"
  const paint = (line: string) => theme.bg(bgColor, line)
  const border = (text: string) => theme.fg(borderColor, text)
  const topLabel = ` ${title} `
  const topFill = Math.max(0, panelWidth - visibleWidth(topLabel) - 2)
  const top = paint(`${border("╭")}${border(topLabel)}${border("─".repeat(topFill))}${border("╮")}`)
  const lines = [top]
  if (subtitle) lines.push(boxedLine(theme.fg("muted", subtitle), innerWidth, paint, border))
  if (body.length > 0) lines.push(boxedLine("", innerWidth, paint, border))
  for (const line of body) {
    lines.push(boxedLine(line, innerWidth, paint, border))
  }
  lines.push(paint(`${border("╰")}${border("─".repeat(panelWidth - 2))}${border("╯")}`))
  return lines
}

function boxedLine(
  text: string,
  innerWidth: number,
  paint: (line: string) => string,
  border: (line: string) => string
): string {
  const clipped = truncateToWidth(text, innerWidth)
  return paint(`${border("│")} ${padVisible(clipped, innerWidth)} ${border("│")}`)
}

function toolResult(result: RunResult): AgentToolResult<RunDetails> {
  return {
    content: [{ type: "text", text: result.report }],
    details: {
      runId: result.runId,
      mode: result.mode,
      async: result.async,
      exitCode: result.exitCode,
      elapsedMs: result.elapsedMs,
      transcriptPath: result.transcriptPath,
    },
  }
}

function startedResult(runId: string, mode: "background" | "interactive"): AgentToolResult<RunDetails> {
  return {
    content: [{ type: "text", text: `Claude run started: ${runId}` }],
    details: { runId, mode, async: true, status: "started" },
  }
}

function updateWidget(): void {
  if (runningClaude.size === 0) {
    latestCtx?.ui.setWidget("pi-spawn-claude-code", undefined)
    if (widgetInterval) {
      clearInterval(widgetInterval)
      widgetInterval = null
    }
    return
  }

  if (!latestCtx?.hasUI) return

  latestCtx.ui.setWidget(
    "pi-spawn-claude-code",
    (_tui, theme) => ({
      invalidate() {},
      render(width: number) {
        const body: string[] = []
        for (const running of runningClaude.values()) {
          const elapsed = formatDuration(Date.now() - running.startTime)
          const firstLine =
            running.prompt.split("\n").find((line) => line.trim()) ?? running.prompt
          const preview =
            firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine
          body.push(
            `${theme.fg("accent", "●")} ${theme.fg("toolTitle", running.mode)} ${theme.fg("muted", running.runId)} ${theme.fg("success", elapsed)}`
          )
          body.push(`  ${theme.fg("toolOutput", preview)}`)
        }
        return renderPanel(
          "Claude Code",
          `${runningClaude.size} running`,
          body,
          width,
          theme,
          "running"
        )
      },
    }),
    { placement: "aboveEditor" }
  )
}

function trackAsyncRun(runId: string, prompt: string, mode: "background" | "interactive"): void {
  runningClaude.set(runId, { runId, prompt, mode, startTime: Date.now() })
  updateWidget()
  if (!widgetInterval) widgetInterval = setInterval(updateWidget, 1000)
}

function finishAsyncRun(runId: string): void {
  runningClaude.delete(runId)
  updateWidget()
}

function sendAsyncReport(
  pi: ExtensionAPI,
  prompt: string,
  result: RunResult
): void {
  pi.sendMessage<ClaudeResultMessageDetails>(
    {
      customType: "pi_spawn_claude_code_result",
      content: formatResult(result),
      display: true,
      details: {
        runId: result.runId,
        prompt,
        mode: result.mode,
        async: result.async,
        exitCode: result.exitCode,
        elapsedMs: result.elapsedMs,
        transcriptPath: result.transcriptPath,
      },
    },
    { triggerTurn: true, deliverAs: "steer" }
  )
}

function runBackground(
  runId: string,
  prompt: string,
  cwd: string,
  config: ClaudeConfig,
  signal: AbortSignal | undefined,
  asyncMode: boolean,
  resumeSessionId?: string,
): Promise<RunResult> {
  const start = Date.now()
  const child = spawn("claude", buildClaudeArgs(prompt, "background", config, resumeSessionId), {
    cwd,
    env: process.env,
    signal,
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))

  return new Promise((resolvePromise) => {
    child.on("error", (error) => {
      resolvePromise({
        runId,
        mode: "background",
        async: asyncMode,
        report: error.message,
        exitCode: null,
        elapsedMs: Date.now() - start,
      })
    })

    child.on("close", (exitCode) => {
      const out = Buffer.concat(stdout).toString("utf-8").trim()
      const err = Buffer.concat(stderr).toString("utf-8").trim()
      resolvePromise({
        runId,
        mode: "background",
        async: asyncMode,
        report: out || err || `Claude exited with code ${exitCode ?? "unknown"}`,
        exitCode,
        elapsedMs: Date.now() - start,
      })
    })
  })
}

function spawnTmux(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolvePromise) => {
    const child = spawn("tmux", args, { cwd, env: process.env })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", (error) => {
      resolvePromise({ stdout: "", stderr: error.message, exitCode: null })
    })
    child.on("close", (exitCode) => {
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf-8"),
        stderr: Buffer.concat(stderr).toString("utf-8"),
        exitCode,
      })
    })
  })
}

async function capturePane(paneId: string, cwd: string): Promise<string> {
  const result = await spawnTmux(
    ["capture-pane", "-p", "-t", paneId, "-S", "-200"],
    cwd
  )
  return result.stdout
}

function copyTranscript(cwd: string, transcriptPath: string): string {
  const outDir = join(cwd, ".pi", "agent", "sessions", "pi-spawn-claude-code")
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${Date.now().toString(36)}.jsonl`)
  copyFileSync(transcriptPath, outPath)
  return outPath
}

async function waitForInteractiveCompletion(
  runId: string,
  paneId: string,
  sentinelFile: string,
  cwd: string,
  config: ClaudeConfig,
  signal: AbortSignal | undefined,
): Promise<RunResult> {
  const start = Date.now()
  let exitCode: number | null = null
  let report = ""
  let transcriptPath: string | undefined

  while (!signal?.aborted) {
    if (existsSync(sentinelFile)) {
      try {
        report = readFileSync(sentinelFile, "utf-8").trim()
      } catch {}
      break
    }

    const screen = await capturePane(paneId, cwd)
    const match = screen.match(/__CLAUDE_DONE_(\d+)__/)
    if (match) {
      exitCode = Number.parseInt(match[1], 10)
      report = screen.trim()
      break
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }

  if (signal?.aborted) {
    report = "Claude run aborted."
  }

  const transcriptFile = `${sentinelFile}.transcript`
  if (existsSync(transcriptFile)) {
    try {
      const sourceTranscript =
        readFileSync(transcriptFile, "utf-8").trim() || undefined
      transcriptPath = sourceTranscript
        ? copyTranscript(cwd, sourceTranscript)
        : undefined
    } catch {}
  }

  if (!report) report = "Claude completed with no final message."

  if (exitCode === null) {
    const screen = await capturePane(paneId, cwd)
    const match = screen.match(/__CLAUDE_DONE_(\d+)__/)
    if (match) exitCode = Number.parseInt(match[1], 10)
  }

  if (config.closePaneOnCompletion !== false) {
    await spawnTmux(["kill-pane", "-t", paneId], cwd)
  }

  try {
    unlinkSync(sentinelFile)
  } catch {}
  try {
    unlinkSync(transcriptFile)
  } catch {}

  return {
    runId,
    mode: "interactive",
    async: false,
    report,
    exitCode,
    elapsedMs: Date.now() - start,
    transcriptPath,
  }
}

async function runInteractive(
  runId: string,
  prompt: string,
  cwd: string,
  config: ClaudeConfig,
  signal: AbortSignal | undefined,
  asyncMode: boolean,
  resumeSessionId?: string,
): Promise<RunResult> {
  const pane = await spawnTmux(
    ["split-window", "-d", "-h", "-P", "-F", "#{pane_id}"],
    cwd
  )
  const paneId = pane.stdout.trim()
  if (!paneId || pane.exitCode !== 0) {
    return {
      runId,
      mode: "interactive",
      async: asyncMode,
      report: pane.stderr.trim() || "Failed to create tmux pane.",
      exitCode: pane.exitCode,
      elapsedMs: 0,
    }
  }

  const sentinelFile = `/tmp/pi-claude-${runId}-done`
  const tempDir = mkdtempSync(join(tmpdir(), "pi-claude-"))
  const scriptPath = join(tempDir, "run.sh")
  const command = commandFromArgs(
    "claude",
    buildClaudeArgs(prompt, "interactive", config, resumeSessionId)
  )
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash\nset -uo pipefail\ncd ${shellEscape(resolve(cwd))}\nPI_CLAUDE_SENTINEL=${shellEscape(sentinelFile)} ${command}\nstatus=$?\necho "__CLAUDE_DONE_\${status}__"\n`,
    { mode: 0o700 },
  )

  await spawnTmux(["send-keys", "-t", paneId, scriptPath, "Enter"], cwd)

  const result = await waitForInteractiveCompletion(runId, paneId, sentinelFile, cwd, config, signal)
  result.async = asyncMode
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {}
  return result
}

function combineSignals(
  signal: AbortSignal | undefined,
  controller: AbortController
): AbortSignal {
  if (!signal) return controller.signal
  if (signal.aborted) controller.abort()
  else signal.addEventListener("abort", () => controller.abort(), { once: true })
  return controller.signal
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController
): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`Claude run timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export default function piSpawnClaudeCodeExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx
  })

  pi.on("session_shutdown", () => {
    if (widgetInterval) clearInterval(widgetInterval)
    widgetInterval = null
    runningClaude.clear()
    latestCtx?.ui.setWidget("pi-spawn-claude-code", undefined)
    latestCtx = null
  })

  pi.registerMessageRenderer<ClaudeResultMessageDetails>(
    "pi_spawn_claude_code_result",
    (message, options, theme) => {
      const details = message.details
      const content = typeof message.content === "string" ? message.content : ""
      const isError = details?.exitCode != null && details.exitCode !== 0
      const contentLines = content.split("\n")
      const body = options.expanded ? contentLines : contentLines.slice(0, 8)
      const remaining = contentLines.length - body.length
      const renderedBody = body.map((line, index) =>
        index === 0 ? theme.fg("toolOutput", line) : theme.fg("dim", line)
      )
      if (remaining > 0)
        renderedBody.push(theme.fg("muted", `… ${remaining} more lines`))
      if (details?.transcriptPath)
        renderedBody.push(
          theme.fg("muted", `Transcript: ${details.transcriptPath}`)
        )

      return {
        invalidate() {},
        render(width: number) {
          return renderPanel(
            isError ? "Claude Code failed" : "Claude Code complete",
            `${details?.mode ?? "unknown"}, ${formatDuration(details?.elapsedMs ?? 0)}`,
            renderedBody,
            width,
            theme,
            isError ? "error" : "success"
          )
        },
      }
    }
  )

  pi.registerTool({
    name: "claude",
    label: "Pi Spawn Claude Code",
    description:
      "Run Claude Code CLI in background or interactive tmux mode and collect its final report. Use for hands-on coding investigation, experiments, debugging, and direct Claude Code delegation; async runs return immediately and deliver results later via steer.",
    promptSnippet:
      "Run Claude Code CLI with a prompt in background or interactive tmux mode. Use for hands-on code investigation, experiments, debugging, and direct Claude Code delegation. Async runs return immediately; wait for the steered result before using findings.",
    promptGuidelines: [
      "Use claude when the user explicitly asks to run Claude Code CLI or when a task benefits from a separate hands-on Claude Code session with terminal and filesystem access.",
      "Good uses: exploring repo internals, debugging complex issues, trying libraries, running experiments, prototyping approaches, building or testing projects, and resuming prior Claude Code sessions.",
      "Do not use claude for simple file reads, small obvious edits, quick commands you can run yourself, web research, URL fetching, or documentation lookup.",
      "For async claude runs, wait for the steered completion report before summarizing findings or taking dependent action. Do not fabricate or assume results.",
      "Use resumeSessionId when continuing a prior Claude Code session; still include the follow-up instruction in prompt.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "Prompt to pass to Claude Code CLI" }),
      mode: Type.Union([Type.Literal("background"), Type.Literal("interactive")], {
        description: "Run with claude -p in background, or in an interactive tmux pane",
      }),
      async: Type.Boolean({ description: "Return immediately and steer completion later when true" }),
      resumeSessionId: Type.Optional(
        Type.String({
          description:
            "Resume a previous Claude Code session ID and send prompt as the follow-up instruction",
        })
      ),
    }),
    renderCall(args, theme, context) {
      const text =
        (context.lastComponent as Text | undefined) ?? new Text("", 0, 0)
      text.setText(
        `${theme.fg("toolTitle", theme.bold("claude"))}\n${theme.fg("muted", JSON.stringify(args, null, 2))}`
      )
      return text
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const config = loadClaudeConfig()
      const syncController = params.async ? undefined : new AbortController()
      const runSignal = syncController
        ? combineSignals(signal, syncController)
        : undefined
      const run =
        params.mode === "background"
          ? runBackground(
              runId,
              params.prompt,
              ctx.cwd,
              config,
              runSignal,
              params.async,
              params.resumeSessionId
            )
          : runInteractive(
              runId,
              params.prompt,
              ctx.cwd,
              config,
              runSignal,
              params.async,
              params.resumeSessionId
            )

      if (params.async) {
        trackAsyncRun(runId, params.prompt, params.mode)
        run.then(
          (result) => {
            finishAsyncRun(runId)
            sendAsyncReport(pi, params.prompt, result)
          },
          (error) => {
            finishAsyncRun(runId)
            sendAsyncReport(pi, params.prompt, {
              runId,
              mode: params.mode,
              async: true,
              report: error instanceof Error ? error.message : String(error),
              exitCode: null,
              elapsedMs: 0,
            })
          },
        )
        return startedResult(runId, params.mode)
      }

      try {
        if (!syncController) throw new Error("Missing sync abort controller")
        const result = await withTimeout(
          run,
          config.blockTimeoutMs ?? DEFAULT_BLOCK_TIMEOUT_MS,
          syncController
        )
        return toolResult(result)
      } catch (error) {
        return toolResult({
          runId,
          mode: params.mode,
          async: false,
          report: error instanceof Error ? error.message : String(error),
          exitCode: null,
          elapsedMs: 0,
        })
      }
    },
  })
}
