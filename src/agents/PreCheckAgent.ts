import { LLMClient } from "../llm/LLMClient";
import { ADR, ArchBlueprint } from "../types";
import {
  PRE_CHECK_SYSTEM_PROMPT,
  buildPreCheckPrompt,
  PreCheckResult,
} from "../prompts/preCheckPrompts";
import { parseJsonObject, str, oneOf, objectArray } from "../util/llmJson";

const SEVERITIES = ["low", "medium", "high"] as const;

export class PreCheckAgent {
  constructor(private readonly llm: LLMClient) {}

  async check(
    promptText: string,
    blueprint: ArchBlueprint,
    adrs: ADR[]
  ): Promise<PreCheckResult> {
    const raw = await this.llm.complete(
      PRE_CHECK_SYSTEM_PROMPT,
      buildPreCheckPrompt(promptText, blueprint, adrs)
    );
    return PreCheckAgent.parseResponse(raw);
  }

  static parseResponse(raw: string): PreCheckResult {
    const obj = parseJsonObject(raw);
    if (!obj) { return { hasConflicts: false, conflicts: [] }; }

    const conflicts = objectArray(obj.conflicts)
      .map((c) => ({
        constraintId: str(c.constraintId, "unspecified"),
        description:  str(c.description),
        severity:     oneOf(c.severity, SEVERITIES, "medium"),
        suggestion:   str(c.suggestion),
      }))
      .filter((c) => c.description.trim().length > 0);

    const revisedPrompt = str(obj.revisedPrompt).trim();
    return conflicts.length > 0 && revisedPrompt
      ? { hasConflicts: true, conflicts, revisedPrompt }
      : { hasConflicts: conflicts.length > 0, conflicts };
  }
}
