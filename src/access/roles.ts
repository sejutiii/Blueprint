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

/** True when the manifest names at least one Architect, i.e. roles are actually in force. */
export function rolesConfigured(manifest: RolesManifest | null): manifest is RolesManifest {
  return !!manifest && manifest.architects.length > 0;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL.test(email.trim());
}

/** Split free text (one email per line, or comma/space separated) into trimmed entries. */
export function parseEmailList(text: string): string[] {
  return text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

export type BuildManifestResult = { manifest: RolesManifest } | { error: string };

/**
 * Builds the manifest saved from the roles screens. The person saving is always an Architect,
 * so nobody can lock themselves out by accident (hand-editing roles.json still can). Emails are
 * normalized and de-duplicated, and anyone listed as an Architect is dropped from Developers.
 */
export function buildRolesManifest(self: string | null, otherArchitects: string[], developers: string[]): BuildManifestResult {
  if (!self || !isValidEmail(self)) {
    return { error: "Your git email isn't set, so BluePrint can't tell who you are. Run: git config user.email you@example.com" };
  }
  const invalid = [...otherArchitects, ...developers].filter((e) => !isValidEmail(e));
  if (invalid.length) {
    return { error: `Not a valid email: ${invalid.join(", ")}` };
  }
  const architects = [...new Set([self, ...otherArchitects].map(normalizeEmail))];
  const devs = [...new Set(developers.map(normalizeEmail))].filter((e) => !architects.includes(e));
  return { manifest: { architects, developers: devs } };
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
