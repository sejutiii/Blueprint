import { LLMClient } from "../llm/LLMClient";
import { ADR, ArchBlueprint, ComplianceResult, DiffSummary, ExtensionDetail } from "../types";
import {
  COMPLIANCE_SYSTEM_PROMPT, buildCompliancePrompt,
  EXTENSION_DETECTION_SYSTEM_PROMPT, buildExtensionDetectionPrompt,
} from "../prompts/compliancePrompts";

export interface ExtensionResult {
  extensionDetected: boolean;
  extension?: ExtensionDetail;
}

export class ComplianceAgent {
  constructor(private readonly llm: LLMClient) {}

  async check(
    diffSummary: DiffSummary,
    blueprint: ArchBlueprint,
    adrs: ADR[]
  ): Promise<ComplianceResult> {
    const raw = await this.llm.complete(
      COMPLIANCE_SYSTEM_PROMPT,
      buildCompliancePrompt(diffSummary, blueprint, adrs)
    );

    const parsed = this.parseComplianceResponse(raw);
    return {
      ...parsed,
      adrsUsed: adrs.map((a) => a.id),
    };
  }

  async detectExtension(
    diffSummary: DiffSummary,
    blueprint: ArchBlueprint
  ): Promise<ExtensionResult> {
    const raw = await this.llm.complete(
      EXTENSION_DETECTION_SYSTEM_PROMPT,
      buildExtensionDetectionPrompt(diffSummary, blueprint)
    );
    return this.parseExtensionResponse(raw);
  }

  private parseComplianceResponse(raw: string): Omit<ComplianceResult, "adrsUsed"> {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    try {
      return JSON.parse(cleaned) as Omit<ComplianceResult, "adrsUsed">;
    } catch {
      return { violation: false, violations: [] };
    }
  }

  private parseExtensionResponse(raw: string): ExtensionResult {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    try {
      return JSON.parse(cleaned) as ExtensionResult;
    } catch {
      return { extensionDetected: false };
    }
  }
}
