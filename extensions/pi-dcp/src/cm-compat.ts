/**
 * Condensed-milk compatibility helpers.
 *
 * Detects condensed-milk placeholder patterns so DCP can skip
 * entries that CM has already compressed to tiny placeholders.
 * Keeps the detection logic isolated — if CM changes its format,
 * only this file needs updating.
 */

/** Prefixes used by condensed-milk for masked tool results. */
const CM_PREFIXES = [
  "[cm-masked ",   // v1.9.0+ (current)
  "[masked ",      // pre-v1.9.0 legacy
];

/**
 * Returns true if the text looks like a condensed-milk placeholder.
 *
 * Examples:
 *   [cm-masked bash] git status
 *   [cm-masked read] src/index.ts (247 lines, 8.3KB)
 *   [masked bash] git diff        (legacy)
 */
export function isMaskedByCondensedMilk(text: string): boolean {
  if (!text) return false;
  for (const prefix of CM_PREFIXES) {
    if (text.startsWith(prefix)) return true;
  }
  return false;
}
