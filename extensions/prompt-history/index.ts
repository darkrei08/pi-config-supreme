import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@mariozechner/pi-coding-agent";
import { Container, fuzzyFilter, Input, matchesKey, Spacer, Text, type Focusable, type TUI } from "@mariozechner/pi-tui";

type Prompt = {
	text: string;
	timestamp: number;
	sessionPath: string;
};

type SessionMessageEntry = {
	type: "message";
	timestamp?: string;
	message?: {
		role?: string;
		content?: unknown;
		timestamp?: number;
	};
};

const CACHE_TTL_MS = 30_000;
const MAX_PROMPTS = 50;
const MAX_VISIBLE_RESULTS = 10;
const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

let cachedPrompts: Prompt[] = [];
let cacheLoadedAt = 0;
let cacheWarmup: Promise<Prompt[]> | undefined;
let historyIndex = -1;
let activePrefix = "";
let selectedText: string | undefined;

function extractText(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;

	const text = content
		.filter((block): block is { type: string; text: string } => {
			return (
				!!block &&
				typeof block === "object" &&
				"type" in block &&
				"text" in block &&
				(block as { type: unknown }).type === "text" &&
				typeof (block as { text: unknown }).text === "string"
			);
		})
		.map((block) => block.text)
		.join("\n")
		.trim();

	return text || undefined;
}

function promptTimestamp(messageTimestamp: unknown, entryTimestamp: unknown, fallback = 0): number {
	if (typeof messageTimestamp === "number" && Number.isFinite(messageTimestamp)) return messageTimestamp;
	if (typeof entryTimestamp === "string") {
		const parsed = Date.parse(entryTimestamp);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

async function listSessionFiles(): Promise<Array<{ path: string; modified: number }>> {
	const files: Array<{ path: string; modified: number }> = [];

	async function walk(dir: string) {
		let entries;
		try {
			entries = await opendir(dir);
		} catch {
			return;
		}

		for await (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(path);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

			try {
				const info = await stat(path);
				files.push({ path, modified: info.mtimeMs });
			} catch {
				// Session disappeared during scan.
			}
		}
	}

	await walk(SESSIONS_DIR);
	return files.sort((a, b) => b.modified - a.modified);
}

async function readPromptsFromSession(sessionPath: string): Promise<Prompt[]> {
	const prompts: Prompt[] = [];
	const stream = createReadStream(sessionPath, { encoding: "utf8" });
	stream.on("error", () => undefined);

	const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (!line.trim()) continue;

			let entry: SessionMessageEntry;
			try {
				entry = JSON.parse(line) as SessionMessageEntry;
			} catch {
				continue;
			}

			if (entry.type !== "message" || entry.message?.role !== "user") continue;

			const text = extractText(entry.message.content)?.trim();
			if (!text) continue;

			prompts.push({
				text,
				timestamp: promptTimestamp(entry.message.timestamp, entry.timestamp),
				sessionPath,
			});
		}
	} catch {
		return prompts;
	}

	return prompts;
}

function uniqueRecentPrompts(prompts: Prompt[], limit = MAX_PROMPTS): Prompt[] {
	const seen = new Set<string>();
	const unique: Prompt[] = [];

	for (const prompt of prompts.sort((a, b) => b.timestamp - a.timestamp)) {
		if (seen.has(prompt.text)) continue;
		seen.add(prompt.text);
		unique.push(prompt);
		if (unique.length >= limit) break;
	}

	return unique;
}

async function loadAllPrompts(): Promise<Prompt[]> {
	const now = Date.now();
	if (now - cacheLoadedAt < CACHE_TTL_MS) return cachedPrompts;
	if (cacheWarmup) return cacheWarmup;

	cacheWarmup = (async () => {
		const prompts: Prompt[] = [];

		for (const session of await listSessionFiles()) {
			prompts.push(...(await readPromptsFromSession(session.path)));
		}

		cachedPrompts = uniqueRecentPrompts(prompts);
		cacheLoadedAt = Date.now();
		return cachedPrompts;
	})().finally(() => {
		cacheWarmup = undefined;
	});

	return cacheWarmup;
}

function prewarmPromptCache(): void {
	void loadAllPrompts().catch(() => undefined);
}

function collectCurrentSessionPrompts(ctx: ExtensionContext): Prompt[] {
	const sessionPath = ctx.sessionManager.getSessionFile() ?? "(current-session)";
	const prompts: Prompt[] = [];

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message") continue;

		const message = entry.message as { role?: string; content?: unknown; timestamp?: unknown };
		if (message.role !== "user") continue;

		const text = extractText(message.content)?.trim();
		if (!text) continue;

		prompts.push({
			text,
			timestamp: promptTimestamp(message.timestamp, entry.timestamp, Date.now()),
			sessionPath,
		});
	}

	return prompts;
}

async function getPrompts(ctx: ExtensionContext): Promise<Prompt[]> {
	return uniqueRecentPrompts([...collectCurrentSessionPrompts(ctx), ...(await loadAllPrompts())]);
}

function resetPrefixHistory() {
	historyIndex = -1;
	activePrefix = "";
	selectedText = undefined;
}

function compactWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function preview(text: string, max = 90): string {
	const cleaned = compactWhitespace(text);
	if (cleaned.length <= max) return cleaned;
	return `${cleaned.slice(0, max - 1)}…`;
}

function filterPrompts(prompts: Prompt[], query: string): Prompt[] {
	return fuzzyFilter(prompts, query, (prompt) => prompt.text);
}

function formatPromptLine(prompt: Prompt, theme: Theme, selected: boolean): string {
	const marker = selected ? "→ " : "  ";
	const color = selected ? "accent" : "text";
	return `${marker}${theme.fg(color, preview(prompt.text))}`;
}

class PromptHistorySearch extends Container implements Focusable {
	private readonly input = new Input();
	private readonly list = new Container();
	private filtered: Prompt[] = [];
	private selectedIndex = 0;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly prompts: Prompt[],
		initialQuery: string,
		private readonly onSelect: (prompt: Prompt) => void,
		private readonly onCancel: () => void,
	) {
		super();

		this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		this.addChild(new Text(theme.fg("accent", theme.bold(" Prompt History Search ")), 0, 0));
		this.addChild(new Text(theme.fg("dim", "Type to fuzzy-filter prompt text"), 0, 0));
		this.addChild(new Spacer(1));

		this.input.setValue(initialQuery);
		this.input.onSubmit = () => this.selectCurrent();
		this.input.onEscape = () => this.onCancel();
		this.addChild(this.input);

		this.addChild(new Spacer(1));
		this.addChild(this.list);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "↑↓ move • enter select • esc cancel"), 0, 0));
		this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

		this.applyFilter(initialQuery);
	}

	private applyFilter(query: string): void {
		this.filtered = filterPrompts(this.prompts, query);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
		this.rebuildList();
	}

	private rebuildList(): void {
		this.list.clear();

		if (this.filtered.length === 0) {
			this.list.addChild(new Text(this.theme.fg("warning", "No matching prompts"), 0, 0));
			return;
		}

		const start = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE_RESULTS / 2), this.filtered.length - MAX_VISIBLE_RESULTS),
		);
		const end = Math.min(start + MAX_VISIBLE_RESULTS, this.filtered.length);

		for (let i = start; i < end; i++) {
			const prompt = this.filtered[i];
			if (prompt) this.list.addChild(new Text(formatPromptLine(prompt, this.theme, i === this.selectedIndex), 0, 0));
		}

		this.list.addChild(new Text(this.theme.fg("muted", `${this.selectedIndex + 1}/${this.filtered.length}`), 0, 0));
	}

	private selectCurrent(): void {
		const selected = this.filtered[this.selectedIndex];
		if (selected) this.onSelect(selected);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "up")) {
			if (this.filtered.length > 0) {
				this.selectedIndex = this.selectedIndex === 0 ? this.filtered.length - 1 : this.selectedIndex - 1;
				this.rebuildList();
			}
		} else if (matchesKey(data, "down")) {
			if (this.filtered.length > 0) {
				this.selectedIndex = this.selectedIndex === this.filtered.length - 1 ? 0 : this.selectedIndex + 1;
				this.rebuildList();
			}
		} else if (matchesKey(data, "enter")) {
			this.selectCurrent();
		} else if (matchesKey(data, "escape")) {
			this.onCancel();
		} else {
			this.input.handleInput(data);
			this.selectedIndex = 0;
			this.applyFilter(this.input.getValue());
		}

		this.tui.requestRender();
	}
}

async function recallPrompt(ctx: ExtensionContext, direction: "previous" | "next") {
	const editorText = ctx.ui.getEditorText();
	if (historyIndex === -1 || editorText !== selectedText) {
		activePrefix = editorText;
		historyIndex = -1;
		selectedText = undefined;
	}

	const prompts = (await getPrompts(ctx)).filter((prompt) => prompt.text.startsWith(activePrefix));
	if (prompts.length === 0) {
		ctx.ui.notify("No matching prompt history", "info");
		return;
	}

	if (direction === "previous") {
		historyIndex = Math.min(historyIndex + 1, prompts.length - 1);
	} else {
		historyIndex = Math.max(historyIndex - 1, -1);
	}

	selectedText = historyIndex === -1 ? activePrefix : prompts[historyIndex].text;
	ctx.ui.setEditorText(selectedText);
}

async function searchPrompts(ctx: ExtensionContext) {
	resetPrefixHistory();

	const prompts = await getPrompts(ctx);
	if (prompts.length === 0) {
		ctx.ui.notify("No prompt history found", "warning");
		return;
	}

	const initialQuery = ctx.ui.getEditorText();
	const selected = await ctx.ui.custom<Prompt | null>((tui, theme, _keybindings, done) => {
		return new PromptHistorySearch(
			tui,
			theme,
			prompts,
			initialQuery,
			(prompt) => done(prompt),
			() => done(null),
		);
	});

	if (!selected) return;

	ctx.ui.setEditorText(selected.text);
	ctx.ui.notify(`Loaded prompt from ${basename(selected.sessionPath)}`, "info");
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		prewarmPromptCache();
	});

	pi.registerShortcut("ctrl+k", {
		description: "Recall older prompt from all Pi sessions",
		handler: async (ctx) => {
			await recallPrompt(ctx, "previous");
		},
	});

	pi.registerShortcut("ctrl+j", {
		description: "Recall newer prompt from all Pi sessions",
		handler: async (ctx) => {
			await recallPrompt(ctx, "next");
		},
	});

	pi.registerShortcut("ctrl+r", {
		description: "Search prompt history from all Pi sessions",
		handler: async (ctx) => {
			await searchPrompts(ctx);
		},
	});

	pi.on("input", () => {
		resetPrefixHistory();
		return { action: "continue" };
	});
}
