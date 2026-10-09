// Branching constraint-elicitation dialogue (SRS 3.1): walks the fixed topic questions and
// inserts at most one answer-specific follow-up after each topic. Each topic yields at most one
// ADR draft: when a follow-up is asked, the draft waits for its answer (D5). Pure state, no I/O.
import { ConstraintAnalysisResult, ConstraintDraft, ParentExchange, QuestionStep } from "../prompts/constraintPrompts";

export interface WizardQuestion {
  id: string;
  question: string;
  placeholder: string;
  topicIndex: number;   // 0-based index of the topic this question belongs to
  topicTotal: number;
  isFollowUp: boolean;
  parent?: ParentExchange;
}

/** A draft to show now, and what it was written from (the wizard words its banner from this). */
export interface DraftToShow {
  draft: ConstraintDraft;
  basis: "answer"       // a topic answer with no follow-up
       | "both"         // the topic answer and its follow-up together
       | "first";       // the topic answer alone: the follow-up was skipped or added nothing concrete
}

export class ElicitationSession {
  private topic = 0;
  private current: WizardQuestion | null;
  private queuedFollowUp: WizardQuestion | null = null;
  // The topic answer's draft, held back while its follow-up is asked.
  private heldDraft: ConstraintDraft | null = null;

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
   * Record the analysis of the current question's answer and return the draft to show now, if
   * any. A topic answer with a follow-up shows nothing yet: its draft is held and the follow-up
   * comes next (only for topic questions, so each topic adds at most one question). A follow-up's
   * answer is analysed together with the topic answer; if it yields nothing, the held draft stands.
   */
  recordAnswer(answer: string, result: ConstraintAnalysisResult): DraftToShow | null {
    const q = this.current;
    if (!q) { return null; }
    const draft = result.hasConstraint && result.draft ? result.draft : null;

    if (q.isFollowUp) {
      if (draft) { this.heldDraft = null; return { draft, basis: "both" }; }
      return this.takeHeldDraft();
    }
    if (result.followUp?.question.trim()) {
      this.queuedFollowUp = {
        id: `${q.id}-followup`,
        question: result.followUp.question.trim(),
        placeholder: result.followUp.placeholder ?? "",
        topicIndex: q.topicIndex,
        topicTotal: q.topicTotal,
        isFollowUp: true,
        parent: { question: q.question, answer },
      };
      this.heldDraft = draft;
      return null;
    }
    return draft ? { draft, basis: "answer" } : null;
  }

  /** Skipping a follow-up still offers the draft from the topic answer, if there was one. */
  takeHeldDraft(): DraftToShow | null {
    const draft = this.current?.isFollowUp ? this.heldDraft : null;
    this.heldDraft = null;
    return draft ? { draft, basis: "first" } : null;
  }

  /** Move to the queued follow-up, else to the next topic. Returns null when the dialogue is over. */
  advance(): WizardQuestion | null {
    if (this.queuedFollowUp) {
      this.current = this.queuedFollowUp;
      this.queuedFollowUp = null;
      return this.current;
    }
    this.topic += 1;
    this.heldDraft = null;
    this.current = this.topic < this.topics.length ? this.topicQuestion(this.topic) : null;
    return this.current;
  }

  /** Skipping a question drops any follow-up it would have produced (see takeHeldDraft for its draft). */
  skip(): WizardQuestion | null {
    this.queuedFollowUp = null;
    return this.advance();
  }
}
