import { ADR } from "../types";

// "Add Decision": the developer describes a decision or a changed requirement in their own
// words; BluePrint drafts the ADR and says which existing decision, if any, it replaces.

export const DECISION_DRAFT_SYSTEM_PROMPT = `You are an architectural decision analyst. A developer describes a decision, constraint, or change of requirement for their project in their own words. Turn it into one Architectural Decision Record.

Respond with ONLY valid JSON. No markdown, no code fences.

Schema (omit "supersedes" and "supersedesReason" when it replaces nothing):
{
  "draft": {
    "title": "Short decision title, phrased as the rule itself (e.g. 'Store uploaded files in Amazon S3')",
    "context": "Why this decision is needed: the problem or change behind it (2-3 sentences)",
    "decision": "The decision stated clearly and enforceably (1-2 sentences)",
    "consequences": "What it implies for the rest of the project (2-3 sentences)"
  },
  "tentative": false,
  "supersedes": "0003",
  "supersedesReason": "One sentence: what the old decision said and why this one replaces it"
}

Rules:
- Always produce a draft, even for a vague description; the developer will edit it.
- "tentative" is true when the description is not a firm decision ("maybe", "we might", "considering", "someday").
- One decision per ADR. If several are described, draft the most significant one.
- "supersedes": the id of the existing decision below that this one changes, contradicts, or makes obsolete — for example a different database, provider, or rule on the same topic. Only use an id from the list. Do not set it when the new decision merely adds to an existing one or is on a different topic.
- Keep each field to 2-3 sentences maximum.`;

export function buildDecisionDraftPrompt(description: string, existing: ADR[]): string {
  const list = existing.length
    ? existing.map((a) => `[${a.id}] ${a.title}\nDecision: ${a.decision}`).join("\n\n")
    : "None.";
  return `EXISTING DECISIONS (most related first):
${list}

THE DEVELOPER'S DESCRIPTION:
"${description}"`;
}
