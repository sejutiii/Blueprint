// Defensive parsing for LLM output (SRS 4.3): fence-stripped JSON plus shape
// validators that fall back to a named safe default instead of throwing.

/** Parse a JSON object out of a model response, tolerating code fences and prose around it. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  for (const candidate of [stripped, sliceOuterBraces(stripped)]) {
    if (!candidate) { continue; }
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch { /* try next candidate */ }
  }
  return null;
}

function sliceOuterBraces(text: string): string | null {
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : null;
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v))
    : [];
}
