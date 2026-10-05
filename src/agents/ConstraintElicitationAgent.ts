import { LLMClient } from "../llm/LLMClient";
import {
  CONSTRAINT_QUESTIONS,
  CONSTRAINT_ANALYSIS_SYSTEM_PROMPT,
  buildConstraintAnalysisPrompt,
  ConstraintAnalysisResult,
  QuestionStep,
} from "../prompts/constraintPrompts";
import { parseJsonObject, str } from "../util/llmJson";

export class ConstraintElicitationAgent {
  constructor(private readonly llm: LLMClient) {}

  getQuestions(): QuestionStep[] {
    return CONSTRAINT_QUESTIONS;
  }

  async analyzeAnswer(question: QuestionStep, answer: string): Promise<ConstraintAnalysisResult> {
    if (!answer.trim()) {
      return { hasConstraint: false }; // no LLM call for empty answers (T18)
    }

    const raw = await this.llm.complete(
      CONSTRAINT_ANALYSIS_SYSTEM_PROMPT,
      buildConstraintAnalysisPrompt(question.question, answer)
    );

    return ConstraintElicitationAgent.parseResponse(raw);
  }

  static parseResponse(raw: string): ConstraintAnalysisResult {
    const obj = parseJsonObject(raw);
    const draft = obj && obj.hasConstraint === true && obj.draft && typeof obj.draft === "object"
      ? (obj.draft as Record<string, unknown>)
      : null;
    if (!draft || !str(draft.title).trim() || !str(draft.decision).trim()) {
      return { hasConstraint: false };
    }
    return {
      hasConstraint: true,
      draft: {
        title:        str(draft.title).trim(),
        context:      str(draft.context),
        decision:     str(draft.decision),
        consequences: str(draft.consequences),
      },
    };
  }
}
