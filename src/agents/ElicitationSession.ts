// Branching constraint-elicitation dialogue (SRS 3.1): walks the fixed topic questions and
// inserts at most one answer-specific follow-up after each topic. Pure state, no I/O.
import { FollowUpQuestion, ParentExchange, QuestionStep } from "../prompts/constraintPrompts";

export interface WizardQuestion {
  id: string;
  question: string;
  placeholder: string;
  topicIndex: number;   // 0-based index of the topic this question belongs to
  topicTotal: number;
  isFollowUp: boolean;
  parent?: ParentExchange;
}

export class ElicitationSession {
  private topic = 0;
  private current: WizardQuestion | null;
  private queuedFollowUp: WizardQuestion | null = null;

  constructor(private readonly topics: QuestionStep[]) {
    this.current = topics.length ? this.topicQuestion(0) : null;
  }

  private topicQuestion(index: number): WizardQuestion {
    const t = this.topics[index];
    return {
      id: t.id, question: t.question, placeholder: t.placeholder,
      topicIndex: index, topicTotal: this.topics.length, isFollowUp: false,
    };
  }

  getCurrent(): WizardQuestion | null {
    return this.current;
  }

  /**
   * Record the analysis of the current question's answer. A follow-up is queued only for a
   * topic question (never for a follow-up's answer), so each topic adds at most one question.
   */
  recordAnswer(answer: string, followUp?: FollowUpQuestion): void {
    const q = this.current;
    if (!q || q.isFollowUp || !followUp?.question.trim()) { return; }
    this.queuedFollowUp = {
      id: `${q.id}-followup`,
      question: followUp.question.trim(),
      placeholder: followUp.placeholder ?? "",
      topicIndex: q.topicIndex,
      topicTotal: q.topicTotal,
      isFollowUp: true,
      parent: { question: q.question, answer },
    };
  }

  /** Move to the queued follow-up, else to the next topic. Returns null when the dialogue is over. */
  advance(): WizardQuestion | null {
    if (this.queuedFollowUp) {
      this.current = this.queuedFollowUp;
      this.queuedFollowUp = null;
      return this.current;
    }
    this.topic += 1;
    this.current = this.topic < this.topics.length ? this.topicQuestion(this.topic) : null;
    return this.current;
  }

  /** Skipping a question drops any follow-up it would have produced. */
  skip(): WizardQuestion | null {
    this.queuedFollowUp = null;
    return this.advance();
  }
}
