import { LLMClient } from "../llm/LLMClient";
import {
  CONSTRAINT_QUESTIONS,
  CONSTRAINT_ANALYSIS_SYSTEM_PROMPT,
  buildConstraintAnalysisPrompt,
  ConstraintAnalysisResult,
  QuestionStep,
} from "../prompts/constraintPrompts";
import { parseJsonObject, str } from "../util/llmJson";
import { ElicitationSession, WizardQuestion } from "./ElicitationSession";

export class ConstraintElicitationAgent {
  constructor(private readonly llm: LLMClient) {}

  getQuestions(): QuestionStep[] {
    return CONSTRAINT_QUESTIONS;
  }

  startSession(): ElicitationSession {
    return new ElicitationSession(CONSTRAINT_QUESTIONS);
  }

  async analyzeAnswer(question: WizardQuestion | QuestionStep, answer: string): Promise<ConstraintAnalysisResult> {
    if (!answer.trim()) {
      return { hasConstraint: false }; // no LLM call for empty answers (T18)
    }

    const parent = "parent" in question ? question.parent : undefined;
    const raw = await this.llm.complete(
      CONSTRAINT_ANALYSIS_SYSTEM_PROMPT,
      buildConstraintAnalysisPrompt(question.question, answer, parent)
    );

    return ConstraintElicitationAgent.parseResponse(raw);
  }

  static parseResponse(raw: string): ConstraintAnalysisResult {
    const obj = parseJsonObject(raw);
    if (!obj) { return { hasConstraint: false }; }

    const follow = obj.followUp && typeof obj.followUp === "object"
      ? (obj.followUp as Record<string, unknown>)
      : null;
    const followUp = follow && str(follow.question).trim()
      ? { question: str(follow.question).trim(), placeholder: str(follow.placeholder) }
      : undefined;

    const draft = obj.hasConstraint === true && obj.draft && typeof obj.draft === "object"
      ? (obj.draft as Record<string, unknown>)
      : null;
    if (!draft || !str(draft.title).trim() || !str(draft.decision).trim()) {
      return followUp ? { hasConstraint: false, followUp } : { hasConstraint: false };
    }
    return {
      hasConstraint: true,
      draft: {
        title:        str(draft.title).trim(),
        context:      str(draft.context),
        decision:     str(draft.decision),
        consequences: str(draft.consequences),
      },
      ...(followUp ? { followUp } : {}),
    };
  }
}
