/**
 * Protected file patterns — shields file-related tool outputs from pruning
 * when their file paths match configured glob patterns.
 *
 * Complements protected-tools.ts (which matches by tool name).
 * Used by tool-cache visibility, LLM-driven tools, and automatic rules.
 */

/**
 * Normalize path separators to forward slashes.
 */
function normalizePath(input: string): string {
  return input.replaceAll("\\", "/");
}

/**
 * Escape a character for use in a RegExp character class or literal context.
 */
function escapeRegExpChar(ch: string): string {
  return /[\\^$+{}()|[\].]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * Match a file path against a glob pattern.
 * Supports:
 *   **  — zero or more path segments (matches across /)
 *   *   — zero or more non-/ characters within a segment
 *   ?   — exactly one non-/ character
 */
export function matchesFileGlob(inputPath: string, pattern: string): boolean {
  if (!pattern) return false;

  const input = normalizePath(inputPath);
  const pat = normalizePath(pattern);

  let regex = "^";

  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];

    if (ch === "*") {
      const next = pat[i + 1];
      if (next === "*") {
        const after = pat[i + 2];
        if (after === "/") {
          // **/ — zero or more directories
          regex += "(?:.*/)?" ;
          i += 2;
          continue;
        }
        // ** at end or before non-/ — match anything
        regex += ".*";
        i++;
        continue;
      }
      // * — match within a single segment
      regex += "[^/]*";
      continue;
    }

    if (ch === "?") {
      regex += "[^/]";
      continue;
    }

    if (ch === "/") {
      regex += "/";
      continue;
    }

    regex += escapeRegExpChar(ch);
  }

  regex += "$";
  return new RegExp(regex).test(input);
}

/**
 * Extract file paths from a tool call's parameters.
 *
 * Handles pi-specific tool parameter shapes:
 * - read/write/edit/find/ls: params.path
 * - grep: params.path (directory to search)
 * - edit: params.path + params.edits (array with file references)
 */
export function getFilePathsFromToolCall(
  toolName: string,
  parameters: unknown
): string[] {
  if (typeof parameters !== "object" || parameters === null) return [];

  const params = parameters as Record<string, any>;
  const paths: string[] = [];

  // Standard `path` parameter (read, write, edit, find, ls, grep)
  if (typeof params.path === "string") {
    paths.push(params.path);
  }

  // Legacy / alternative param name
  if (typeof params.file_path === "string") {
    paths.push(params.file_path);
  }

  // edit tool: edits array may reference paths
  if (toolName === "edit" && Array.isArray(params.edits)) {
    for (const edit of params.edits) {
      if (edit && typeof edit.path === "string") {
        paths.push(edit.path);
      }
    }
  }

  // Return unique non-empty paths
  return [...new Set(paths)].filter((p) => p.length > 0);
}

/**
 * Check if any of the given file paths match any protected pattern.
 */
export function isFilePathProtected(
  filePaths: string[],
  patterns: string[]
): boolean {
  if (!filePaths || filePaths.length === 0) return false;
  if (!patterns || patterns.length === 0) return false;

  return filePaths.some((path) =>
    patterns.some((pattern) => matchesFileGlob(path, pattern))
  );
}
