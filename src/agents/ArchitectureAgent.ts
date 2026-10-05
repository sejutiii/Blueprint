import { LLMClient } from "../llm/LLMClient";
import { ArchBlueprint } from "../types";
import { ARCH_GENERATION_SYSTEM_PROMPT, buildArchGenerationPrompt } from "../prompts/archPrompts";
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
