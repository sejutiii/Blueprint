import { LLMClient } from "../llm/LLMClient";
import { ArchBlueprint } from "../types";
import {
  ARCH_GENERATION_SYSTEM_PROMPT, buildArchGenerationPrompt,
  ARCH_FROM_CODE_SYSTEM_PROMPT, buildArchFromCodePrompt,
} from "../prompts/archPrompts";
import { parseJsonObject, str, strArray, objectArray } from "../util/llmJson";

export class ArchitectureAgent {
  constructor(private readonly llm: LLMClient) {}

  async generate(systemDescription: string): Promise<ArchBlueprint> {
    const raw = await this.llm.complete(
      ARCH_GENERATION_SYSTEM_PROMPT,
      buildArchGenerationPrompt(systemDescription)
    );
    return { ...ArchitectureAgent.parseResponse(raw), lastUpdated: new Date().toISOString() };
  }

  /**
   * Re-derive the blueprint from the codebase, using the current blueprint as the baseline.
   * Constraints are never dropped: code cannot reveal team decisions, so every existing
   * constraint is carried over and the model's code-evident ones are added to it.
   */
  async regenerateFromCodebase(current: ArchBlueprint, snapshot: string): Promise<ArchBlueprint> {
    const raw = await this.llm.complete(ARCH_FROM_CODE_SYSTEM_PROMPT, buildArchFromCodePrompt(current, snapshot));
    const next = ArchitectureAgent.parseResponse(raw);
    return {
      ...next,
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
          return {
            name:           str(c.name).trim(),
            responsibility: str(c.responsibility),
            ...(technology ? { technology } : {}),
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
