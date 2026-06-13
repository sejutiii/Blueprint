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

export interface ConstraintAnalysisResult {
  hasConstraint: boolean;
  draft?: ConstraintDraft;
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

Analyze the answer. If it reveals a concrete architectural constraint or decision, draft an ADR for it.

Respond with ONLY valid JSON. No markdown, no code fences.

If the answer contains a concrete constraint:
{
  "hasConstraint": true,
  "draft": {
    "title": "Short decision title (e.g. 'Use PostgreSQL as primary database')",
    "context": "Why this decision matters and what problem it solves (2-3 sentences)",
    "decision": "The specific decision stated clearly (1-2 sentences)",
    "consequences": "What this decision implies for the rest of the project (2-3 sentences)"
  }
}

If the answer is vague, empty, or contains no concrete constraint:
{
  "hasConstraint": false
}

Rules:
- Only record decisions that are concrete: "We are using React" yes. "We might use React" no.
- One ADR per response — pick the most significant constraint if multiple are mentioned
- Keep each field to 2-3 sentences maximum`;

export function buildConstraintAnalysisPrompt(question: string, answer: string): string {
  return `Question: "${question}"\n\nAnswer: "${answer}"`;
}
