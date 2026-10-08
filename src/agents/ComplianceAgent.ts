import { LLMClient } from "../llm/LLMClient";
import {
  ADR, ArchBlueprint, ArchComponent, CheckedFile, ComplianceResult, DiffSummary, ExtensionDetail,
  PlannedComponentMatch, ViolationDetail, componentStatus,
} from "../types";
import {
  COMPLIANCE_SYSTEM_PROMPT, buildCompliancePrompt,
  EXTENSION_DETECTION_SYSTEM_PROMPT, buildExtensionDetectionPrompt, MAX_EXTENSIONS,
} from "../prompts/compliancePrompts";
import { parseJsonObject, str, strArray, oneOf, objectArray } from "../util/llmJson";

/** Pass 2's answer: new components, planned ones now in code, and why the other added files aren't either. */
export interface ExtensionReport {
  extensions: ExtensionDetail[];
  plannedImplemented: PlannedComponentMatch[];
  notReported: CheckedFile[];
}

const EMPTY_REPORT: ExtensionReport = { extensions: [], plannedImplemented: [], notReported: [] };

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
  ): Promise<ExtensionReport> {
    const raw = await this.llm.complete(
      EXTENSION_DETECTION_SYSTEM_PROMPT,
      buildExtensionDetectionPrompt(diffSummary, blueprint)
    );
    return ComplianceAgent.parseExtensionResponse(raw, blueprint.components);
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
   * Accepts the documented three-group shape and, defensively, the older single
   * `{ extensionDetected, extension }` shape. Checked against the real components, because the
   * model's labels can't be trusted: an "extension" named after a planned component is that
   * component appearing in code; one named after an implemented component is dropped; a planned
   * match must name a component that is still planned. Caps extensions at MAX_EXTENSIONS.
   */
  static parseExtensionResponse(raw: string, components: ArchComponent[] = []): ExtensionReport {
    const obj = parseJsonObject(raw);
    if (!obj) { return { ...EMPTY_REPORT }; }

    const byName = new Map(components.map((c) => [c.name.trim().toLowerCase(), c]));
    const plannedNamed = (name: string) => {
      const c = byName.get(name.trim().toLowerCase());
      return c && componentStatus(c) === "planned" ? c : undefined;
    };
    const files = (v: unknown) => [...new Set(strArray(v).map((f) => f.trim()).filter(Boolean))];

    const planned = new Map<string, PlannedComponentMatch>();
    const addPlanned = (component: ArchComponent, paths: string[], rationale: string) => {
      const existing = planned.get(component.name);
      if (existing) { existing.files = [...new Set([...existing.files, ...paths])]; return; }
      planned.set(component.name, { component: component.name, files: paths, rationale });
    };
    for (const m of objectArray(obj.plannedImplemented)) {
      const component = plannedNamed(str(m.component));
      if (component) { addPlanned(component, files(m.files), str(m.rationale)); }
    }

    const candidates = Array.isArray(obj.extensions)
      ? objectArray(obj.extensions)
      : obj.extensionDetected === true ? objectArray([obj.extension]) : [];
    const seen = new Set<string>();
    const extensions: ExtensionDetail[] = [];
    for (const ext of candidates) {
      const name = str(ext.name).trim();
      const key  = name.toLowerCase();
      if (!name || seen.has(key)) { continue; }
      seen.add(key);
      const asPlanned = plannedNamed(name);
      if (asPlanned) { addPlanned(asPlanned, files(ext.files), str(ext.rationale)); continue; }
      if (byName.has(key)) { continue; } // an implemented component is not new
      if (extensions.length === MAX_EXTENSIONS) { continue; }
      const technology = str(ext.technology).trim();
      const paths = files(ext.files);
      extensions.push({
        name,
        responsibility: str(ext.responsibility),
        ...(technology ? { technology } : {}),
        rationale:      str(ext.rationale),
        ...(paths.length ? { files: paths } : {}),
      });
    }

    const reported = new Set([...planned.values(), ...extensions].flatMap((x) => x.files ?? []));
    const notReported: CheckedFile[] = [];
    for (const n of objectArray(obj.notReported)) {
      const file = str(n.file).trim();
      if (!file || reported.has(file) || notReported.some((c) => c.file === file)) { continue; }
      notReported.push({ file, reason: str(n.reason).trim() });
    }

    return { extensions, plannedImplemented: [...planned.values()], notReported };
  }
}
