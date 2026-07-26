/**
 * Domain handler signature.
 *
 * Return a string (markdown output) to short-circuit the normal fetch pipeline.
 * Return null to fall through to the standard HTML → Defuddle path.
 */
export type DomainHandler = (
  url: string,
  signal?: AbortSignal
) => Promise<string | null>
