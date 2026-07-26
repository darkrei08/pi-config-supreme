import type { ContentBlock, ImageContent } from "./content.ts";
import {
	createImageAttachmentEditor,
	type AttachmentEditorDeps,
	type DraftAttachment,
	type PendingSubmission,
} from "./editor-factory.ts";
import { ImageGallery, type GalleryImage } from "./image-gallery.ts";
import { upgradeScreenshotToolResult } from "./tool-result-upgrader.ts";

export type PiLike = {
	on(event: string, handler: (event: any, ctx: ExtensionContextLike) => any): void;
	sendUserMessage(content: string | ContentBlock[], options?: { deliverAs?: "steer" | "followUp" }): void;
};

export type ExtensionContextLike = {
	cwd: string;
	isIdle(): boolean;
	ui: {
		setWidget(
			key: string,
			content: string[] | ((tui: any, theme: any) => any) | undefined,
			options?: { placement?: "aboveEditor" | "belowEditor" },
		): void;
		setEditorComponent(factory: ((...args: any[]) => any) | undefined): void;
	};
};

export type ExtensionRuntimeDeps = AttachmentEditorDeps & {
	loadImageContentFromPath: (filePath: string) => Promise<ImageContent | null>;
};

const WIDGET_KEY = "pi-images";

export function registerImageUnifiedExtension(pi: PiLike, deps: ExtensionRuntimeDeps): void {
	let currentDraftAttachments: DraftAttachment[] = [];
	let pendingSubmission: PendingSubmission | undefined;
	let gallery: ImageGallery | null = null;

	/**
	 * Update the above-editor widget.
	 *
	 * When there are draft attachments, render a kitty graphics gallery
	 * (with text fallback for non-kitty terminals). When empty, clear the widget.
	 */
	const refreshWidget = (ctx: ExtensionContextLike) => {
		if (currentDraftAttachments.length === 0) {
			if (gallery) {
				gallery.dispose();
				gallery = null;
			}
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}

		const galleryImages: GalleryImage[] = currentDraftAttachments.map((attachment) => ({
			data: attachment.image.data,
			mimeType: attachment.image.mimeType,
			label: `${attachment.placeholder} ${attachment.label}`,
		}));

		// Dispose the previous gallery to free kitty image resources before replacement
		if (gallery) {
			gallery.dispose();
			gallery = null;
		}

		ctx.ui.setWidget(
			WIDGET_KEY,
			(_tui: any, theme: any) => {
				const galleryTheme = {
					accent: (s: string) => theme.fg("accent", s),
					muted: (s: string) => theme.fg("muted", s),
					dim: (s: string) => theme.fg("dim", s),
					bold: (s: string) => theme.bold(s),
				};

				gallery = new ImageGallery(galleryTheme);
				gallery.setImages(galleryImages);
				return gallery;
			},
			{ placement: "aboveEditor" },
		);
	};

	const EditorClass = createImageAttachmentEditor(deps);

	const installEditor = (ctx: ExtensionContextLike) => {
		ctx.ui.setEditorComponent((...args: any[]) =>
			new EditorClass(...args, {
				publishDraft: (attachments: DraftAttachment[]) => {
					currentDraftAttachments = [...attachments];
					refreshWidget(ctx);
				},
				queuePendingSubmission: (submission: PendingSubmission) => {
					pendingSubmission = submission;
				},
				sendImagesOnly: (images: ImageContent[]) => {
					currentDraftAttachments = [];
					pendingSubmission = undefined;
					refreshWidget(ctx);
					pi.sendUserMessage(images, ctx.isIdle() ? undefined : { deliverAs: "steer" });
				},
			}),
		);
		refreshWidget(ctx);
	};

	const resetDraft = (ctx: ExtensionContextLike) => {
		currentDraftAttachments = [];
		pendingSubmission = undefined;
		if (gallery) {
			gallery.dispose();
			gallery = null;
		}
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	};

	// Clean up kitty image resources when the process exits
	const cleanup = (): void => {
		if (gallery) {
			gallery.dispose();
			gallery = null;
		}
	};
	process.on("exit", cleanup);
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	pi.on("session_start", async (_event, ctx) => {
		resetDraft(ctx);
		installEditor(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		resetDraft(ctx);
		installEditor(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		return upgradeScreenshotToolResult(event, ctx.cwd, deps.loadImageContentFromPath);
	});

	pi.on("input", async (event, ctx) => {
		if (pendingSubmission && event.text === pendingSubmission.matchText) {
			const submission = pendingSubmission;
			const mergedImages = [...(event.images ?? []), ...submission.images];
			pendingSubmission = undefined;
			currentDraftAttachments = [];
			refreshWidget(ctx);
			return {
				action: "transform" as const,
				text: submission.transformedText,
				images: mergedImages,
			};
		}

		return { action: "continue" as const };
	});
}
