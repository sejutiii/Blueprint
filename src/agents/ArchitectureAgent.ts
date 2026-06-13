import { LLMClient } from "../llm/LLMClient";
import { ArchBlueprint } from "../types";
import { ARCH_GENERATION_SYSTEM_PROMPT, buildArchGenerationPrompt } from "../prompts/archPrompts";

export class ArchitectureAgent {
  constructor(private readonly llm: LLMClient) {}

  async generate(systemDescription: string): Promise<ArchBlueprint> {
    const raw = await this.llm.complete(
      ARCH_GENERATION_SYSTEM_PROMPT,
      buildArchGenerationPrompt(systemDescription)
    );

    const parsed = this.parseResponse(raw);
    return { ...parsed, lastUpdated: new Date().toISOString() };
  }

  private parseResponse(raw: string): Omit<ArchBlueprint, "lastUpdated"> {
    // Strip markdown code fences if the model ignores the JSON-only instruction
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();

    try {
      return JSON.parse(cleaned) as Omit<ArchBlueprint, "lastUpdated">;
    } catch {
      throw new Error(
        `Architecture Agent received a non-JSON response from the model.\n\nRaw response:\n${raw}`
      );
    }
  }
}
