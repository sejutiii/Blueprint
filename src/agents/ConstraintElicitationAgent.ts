import { LLMClient } from "../llm/LLMClient";
import {
  CONSTRAINT_QUESTIONS,
  CONSTRAINT_ANALYSIS_SYSTEM_PROMPT,
  buildConstraintAnalysisPrompt,
  ConstraintAnalysisResult,
  QuestionStep,
} from "../prompts/constraintPrompts";

export class ConstraintElicitationAgent {
  constructor(private readonly llm: LLMClient) {}

  getQuestions(): QuestionStep[] {
    return CONSTRAINT_QUESTIONS;
  }

  async analyzeAnswer(question: QuestionStep, answer: string): Promise<ConstraintAnalysisResult> {
    if (!answer.trim()) {
      return { hasConstraint: false };
    }

    const raw = await this.llm.complete(
      CONSTRAINT_ANALYSIS_SYSTEM_PROMPT,
      buildConstraintAnalysisPrompt(question.question, answer)
    );

    return this.parseResponse(raw);
  }

  private parseResponse(raw: string): ConstraintAnalysisResult {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    try {
      return JSON.parse(cleaned) as ConstraintAnalysisResult;
    } catch {
      return { hasConstraint: false };
    }
  }
}
