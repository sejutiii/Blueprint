import { LLMClient } from "../llm/LLMClient";
import { ArchBlueprint } from "../types";
import {
  ARCH_GENERATION_SYSTEM_PROMPT, buildArchGenerationPrompt,
  ARCH_FROM_CODE_SYSTEM_PROMPT, buildArchFromCodePrompt,
} from "../prompts/archPrompts";
import { parseJsonObject, str, strArray, objectArray } from "../util/llmJson";
import { MAX_COMPONENT_FILES } from "../storage/archPatch";

export class ArchitectureAgent {
  constructor(private readonly llm: LLMClient) {}

  async generate(systemDescription: string): Promise<ArchBlueprint> {
    const raw = await this.llm.complete(
      ARCH_GENERATION_SYSTEM_PROMPT,
      buildArchGenerationPrompt(systemDescription)
    );
    const blueprint = ArchitectureAgent.parseResponse(raw);
    // Built from a description, not from code: every component starts as planned. A review marks
    // one implemented when code for it appears (or Regenerate finds it in the codebase).
    const components = blueprint.components.map(({ files: _files, ...c }) => ({ ...c, status: "planned" as const }));
    return { ...blueprint, components, lastUpdated: new Date().toISOString() };
  }

  /**
   * Re-derive the blueprint from the codebase, using the current blueprint as the baseline.
   * Constraints are never dropped: code cannot reveal team decisions, so every existing
   * constraint is carried over and the model's code-evident ones are added to it.
   */
  async regenerateFromCodebase(current: ArchBlueprint, snapshot: string): Promise<ArchBlueprint> {
    const raw = await this.llm.complete(ARCH_FROM_CODE_SYSTEM_PROMPT, buildArchFromCodePrompt(current, snapshot));
    const next = ArchitectureAgent.parseResponse(raw);
    // A status the model left out keeps the component's current one (planned if it is new).
    const before = new Map(current.components.map((c) => [c.name.toLowerCase(), c]));
    const components = next.components.map((c) => {
      if (c.status) { return c.status === "planned" ? { ...c, files: undefined } : c; }
      const old = before.get(c.name.toLowerCase());
      return old?.status === "implemented"
        ? { ...c, status: "implemented" as const, files: c.files ?? old.files }
        : { ...c, status: "planned" as const };
    });
    return {
      ...next,
      components,
      constraints: mergeConstraints(current.constraints, next.constraints),
      lastUpdated: new Date().toISOString(),
    };
  }

  // Unlike the checking agents there is no safe default here: a silently empty blueprint
  // would be written to disk, so an unparseable response surfaces as an error with the raw text (T14).
  static parseResponse(raw: string): Omit<ArchBlueprint, "lastUpdated"> {
    const obj = parseJsonObject(raw);
    if (!obj) {
      throw new Error(
        `Architecture Agent received a non-JSON response from the model.\n\nRaw response:\n${raw}`
      );
    }

    return {
      systemOverview: str(obj.systemOverview),
      components: objectArray(obj.components)
        .filter((c) => str(c.name).trim())
        .map((c) => {
          const technology = str(c.technology).trim();
          const status = c.status === "implemented" || c.status === "planned" ? c.status : undefined;
          const files  = strArray(c.files).map((f) => f.trim()).filter(Boolean).slice(0, MAX_COMPONENT_FILES);
          return {
            name:           str(c.name).trim(),
            responsibility: str(c.responsibility),
            ...(technology ? { technology } : {}),
            ...(status ? { status } : {}),
            ...(status === "implemented" && files.length ? { files } : {}),
          };
        }),
      dataFlow:      str(obj.dataFlow),
      constraints:   strArray(obj.constraints),
      openQuestions: strArray(obj.openQuestions),
    };
  }
}

/** Existing constraints first (in their order), then new ones not already present (case-insensitive). */
export function mergeConstraints(existing: string[], added: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...existing, ...added]) {
    const key = c.trim().toLowerCase();
    if (!key || seen.has(key)) { continue; }
    seen.add(key);
    out.push(c.trim());
  }
  return out;
}
