/** Only allow relative in-app paths as post-auth destinations (no open redirects). */
export function safeNext(value: unknown, fallback = "/rosa"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value;
}
