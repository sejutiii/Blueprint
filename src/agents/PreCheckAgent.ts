import { LLMClient } from "../llm/LLMClient";
import { ADR, ArchBlueprint } from "../types";
import {
  PRE_CHECK_SYSTEM_PROMPT,
  buildPreCheckPrompt,
  PreCheckResult,
} from "../prompts/preCheckPrompts";

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
    return this.parseResponse(raw);
  }

  private parseResponse(raw: string): PreCheckResult {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    try {
      return JSON.parse(cleaned) as PreCheckResult;
    } catch {
      return { hasConflicts: false, conflicts: [] };
    }
  }
}
