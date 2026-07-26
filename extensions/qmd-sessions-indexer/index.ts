import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

const SCRIPT = join(homedir(), "bin", "rebuild-qmd-sessions-rendered.sh")
const EVENTS = [
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_before_tree",
  "session_tree",
  "session_shutdown",
] as const

let running = false
let pending = false

function runIndexer(reason: string): void {
  if (!existsSync(SCRIPT)) return

  if (running) {
    pending = true
    return
  }

  running = true
  const child = spawn(SCRIPT, [], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      QMD_SESSIONS_TRIGGER: reason,
    },
  })

  child.on("error", () => {
    running = false
    if (pending) {
      pending = false
      runIndexer("queued")
    }
  })

  child.on("exit", () => {
    running = false
    if (pending) {
      pending = false
      runIndexer("queued")
    }
  })

  child.unref()
}

export default function (pi: ExtensionAPI) {
  for (const eventName of EVENTS) {
    pi.on(eventName, async () => {
      runIndexer(eventName)
    })
  }
}
