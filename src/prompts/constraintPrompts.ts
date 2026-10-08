export interface QuestionStep {
  id: string;
  question: string;
  placeholder: string;
}

export interface ConstraintDraft {
  title: string;
  context: string;
  decision: string;
  consequences: string;
}

export interface FollowUpQuestion {
  question: string;
  placeholder: string;
}

export interface ConstraintAnalysisResult {
  hasConstraint: boolean;
  draft?: ConstraintDraft;
  /** Optional, answer-specific question that sharpens this topic (branching dialogue, SRS 3.1). */
  followUp?: FollowUpQuestion;
}

/** The question/answer a follow-up was generated from, so its answer is analyzed in context. */
export interface ParentExchange {
  question: string;
  answer: string;
}

export const CONSTRAINT_QUESTIONS: QuestionStep[] = [
  {
    id: "technology",
    question: "What technology choices are already locked in for this project?",
    placeholder:
      "e.g. React frontend, Node.js backend, PostgreSQL database, deploying to AWS.",
  },
  {
    id: "scalability",
    question: "What are the scalability and performance expectations?",
    placeholder:
      "e.g. 10,000 concurrent users, API responses under 200ms, 99.9% uptime.",
  },
  {
    id: "conventions",
    question: "Are there team conventions or coding standards that must be followed?",
    placeholder:
      "e.g. 80% test coverage, ESLint with Airbnb config, two PR approvals required.",
  },
  {
    id: "integrations",
    question: "What external systems or third-party services must this project integrate with?",
    placeholder:
      "e.g. Stripe for payments, SendGrid for email, existing CRM via REST API.",
  },
  {
    id: "nonfunctional",
    question: "Are there specific security, compliance, or availability requirements?",
    placeholder:
      "e.g. GDPR compliance, data encrypted at rest, SOC 2 Type II certification required.",
  },
];

export const CONSTRAINT_ANALYSIS_SYSTEM_PROMPT = `You are an architectural decision analyst. A developer answered a question about their project's constraints.

Analyze the answer. If it reveals a concrete architectural constraint or decision, draft an ADR for it. Then decide whether ONE follow-up question would turn what they said into a sharper, more enforceable constraint.

Respond with ONLY valid JSON. No markdown, no code fences.

Schema (omit "draft" when hasConstraint is false; omit "followUp" when no follow-up is needed):
{
  "hasConstraint": true,
  "draft": {
    "title": "Short decision title (e.g. 'Use PostgreSQL as primary database')",
    "context": "Why this decision matters and what problem it solves (2-3 sentences)",
    "decision": "The specific decision stated clearly (1-2 sentences)",
    "consequences": "What this decision implies for the rest of the project (2-3 sentences)"
  },
  "followUp": {
    "question": "One short question about a boundary the answer left open",
    "placeholder": "A short example answer"
  }
}

Rules for the draft:
- Only record decisions that are concrete: "We are using React" yes. "We might use React" no.
- One ADR per response — pick the most significant constraint if multiple are mentioned.
- For a follow-up, the draft covers BOTH answers as one decision, keeping every concrete fact from each (names, numbers, limits): the follow-up answer refines, bounds or adds detail to the earlier answer (e.g. "PostgreSQL is the primary datastore; Redis is allowed only for caching"). Never draft a separate decision about the follow-up alone. If neither answer is concrete, set hasConstraint to false.
- Keep each field to 2-3 sentences maximum.

Rules for followUp:
- Ask a follow-up only when the answer leaves an architecturally significant boundary open: whether alternatives or additional technologies are allowed (e.g. "Is PostgreSQL the only datastore, or are caches/search engines allowed?"), scope or exceptions, a measurable target behind a vague expectation, or which component owns an integration.
- For a tentative answer ("we might use React"), the follow-up may ask what would decide the choice.
- Never ask about something the answer already states. Never ask more than one question.
- If the prompt says follow-ups are disabled, omit "followUp".`;

export function buildConstraintAnalysisPrompt(
  question: string,
  answer: string,
  parent?: ParentExchange
): string {
  // The topic answer's draft is held until the follow-up is answered, so this one draft is the
  // only ADR for the topic and must cover both answers.
  const context = parent
    ? `This is a follow-up. Earlier question: "${parent.question}"\nEarlier answer: "${parent.answer}"\n` +
      "Draft ONE ADR that covers both answers together, keeping every concrete fact from each.\n\n"
    : "";
  // Follow-ups are one level deep, so the wizard stays bounded (5 topics, at most 10 questions).
  const followUps = parent
    ? "Follow-ups are disabled for this answer."
    : "Follow-ups are enabled for this answer.";
  return `${context}Question: "${question}"\n\nAnswer: "${answer}"\n\n${followUps}`;
}
