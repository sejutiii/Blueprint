// Pure role resolution (SRS 3.2.5). No VS Code or git imports so it is unit-testable.

export type Role = "developer" | "architect";

export interface RolesManifest {
  architects: string[];
  developers?: string[];
}

export const ROLES_MANIFEST_PATH = [".blueprint", "roles.json"] as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parse a roles.json body; returns null if it is missing or malformed. */
export function parseRolesManifest(raw: string | null): RolesManifest | null {
  if (!raw) { return null; }
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const list = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map(normalizeEmail) : [];
    return { architects: list(obj.architects), developers: list(obj.developers) };
  } catch {
    return null;
  }
}

/**
 * Role lookup. If there is no manifest, or it names no Architects (e.g. a new solo project),
 * every developer is an Architect until one is explicitly configured. An unknown identity
 * (no git email) is a Developer once a real manifest exists, so it can propose but not approve.
 */
export function roleFor(email: string | null, manifest: RolesManifest | null): Role {
  if (!manifest || manifest.architects.length === 0) { return "architect"; }
  if (!email) { return "developer"; }
  return manifest.architects.includes(normalizeEmail(email)) ? "architect" : "developer";
}
