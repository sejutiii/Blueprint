import { LLMClient } from "../llm/LLMClient";
import { ADR, ArchBlueprint, ComplianceResult, DiffSummary, ExtensionDetail, ViolationDetail } from "../types";
import {
  COMPLIANCE_SYSTEM_PROMPT, buildCompliancePrompt,
  EXTENSION_DETECTION_SYSTEM_PROMPT, buildExtensionDetectionPrompt, MAX_EXTENSIONS,
} from "../prompts/compliancePrompts";
import { parseJsonObject, str, oneOf, objectArray } from "../util/llmJson";

const SEVERITIES = ["low", "medium", "high"] as const;

export class ComplianceAgent {
  constructor(private readonly llm: LLMClient) {}

  /** Pass 1 — violation detection. */
  async check(
    diffSummary: DiffSummary,
    blueprint: ArchBlueprint,
    adrs: ADR[]
  ): Promise<Pick<ComplianceResult, "violation" | "violations" | "adrsUsed">> {
    const raw = await this.llm.complete(
      COMPLIANCE_SYSTEM_PROMPT,
      buildCompliancePrompt(diffSummary, blueprint, adrs)
    );

    return { ...ComplianceAgent.parseComplianceResponse(raw), adrsUsed: adrs.map((a) => a.id) };
  }

  /** Pass 2 — extension detection. Independent of Pass 1, so the two run in parallel. */
  async detectExtensions(
    diffSummary: DiffSummary,
    blueprint: ArchBlueprint
  ): Promise<ExtensionDetail[]> {
    const raw = await this.llm.complete(
      EXTENSION_DETECTION_SYSTEM_PROMPT,
      buildExtensionDetectionPrompt(diffSummary, blueprint)
    );
    return ComplianceAgent.parseExtensionResponse(raw, blueprint.components.map((c) => c.name));
  }

  // Safe default on anything unparseable: no violation, so a flaky model never blocks the developer (T35).
  static parseComplianceResponse(raw: string): Pick<ComplianceResult, "violation" | "violations"> {
    const obj = parseJsonObject(raw);
    if (!obj) { return { violation: false, violations: [] }; }

    const violations: ViolationDetail[] = objectArray(obj.violations)
      .map((v) => ({
        constraintId:         str(v.constraintId, "unspecified"),
        description:          str(v.description),
        severity:             oneOf(v.severity, SEVERITIES, "medium"),
        affectedCodeLocation: str(v.affectedCodeLocation),
      }))
      .filter((v) => v.description.trim().length > 0);

    return { violation: violations.length > 0, violations };
  }

  /**
   * Accepts the documented `{ extensions: [...] }` shape and, defensively, the older single
   * `{ extensionDetected, extension }` shape. Drops entries that name an existing component
   * and duplicates within the response; caps at MAX_EXTENSIONS.
   */
  static parseExtensionResponse(raw: string, existingComponents: string[] = []): ExtensionDetail[] {
    const obj = parseJsonObject(raw);
    if (!obj) { return []; }

    const candidates = Array.isArray(obj.extensions)
      ? objectArray(obj.extensions)
      : obj.extensionDetected === true ? objectArray([obj.extension]) : [];

    const seen = new Set(existingComponents.map((n) => n.trim().toLowerCase()));
    const result: ExtensionDetail[] = [];
    for (const ext of candidates) {
      const name = str(ext.name).trim();
      if (!name || seen.has(name.toLowerCase())) { continue; }
      seen.add(name.toLowerCase());
      const technology = str(ext.technology).trim();
      result.push({
        name,
        responsibility: str(ext.responsibility),
        ...(technology ? { technology } : {}),
        rationale:      str(ext.rationale),
      });
      if (result.length === MAX_EXTENSIONS) { break; }
    }
    return result;
  }
}
