/**
 * Only allow relative in-app paths as post-auth destinations (no open redirects).
 * Rejects protocol-relative ("//host") and backslash tricks ("/\host").
 */
export function safeNext(value: unknown, fallback = "/rosa"): string {
  if (typeof value !== "string") return fallback;
  if (!/^\/(?![/\\])/.test(value)) return fallback;
  if (/[\\\s]/.test(value)) return fallback;
  return value;
}
