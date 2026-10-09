import { ADR, ArchBlueprint, DiffSummary } from "../types";
import { EmbeddingService } from "../embeddings/EmbeddingService";
import { AdrStore } from "../storage/AdrStore";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","as","is","was","are","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","not","that",
  "this","these","those","it","its","we","our","they","their","he","she","you",
]);

// Weight given to semantic (embedding) similarity vs. lexical (TF-IDF) similarity
// when both are available. Equal-weighted blend: neither signal dominates.
const SEMANTIC_WEIGHT = 0.5;
const COMPONENT_BOOST = 0.15;

// Minimum score for an ADR to be presented as "relevant". Calibrated on 6 sample prompts with
// all-MiniLM-L6-v2 (q8): clearly related prompt/ADR pairs blended to >= 0.14, unrelated ones
// stayed <= ~0.08. Lexical-only scoring (model unavailable) gets its own bar.
export const RELEVANCE_THRESHOLD = { blended: 0.10, lexical: 0.08 } as const;

// How many accepted ADRs go to the model as context: the `blueprint.retrieval.topK` setting.
export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;

/** The top-K setting as a whole number in 1–MAX_TOP_K; a hand-edited value that isn't a number gets the default. */
export function clampTopK(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) { return DEFAULT_TOP_K; }
  return Math.min(MAX_TOP_K, Math.max(1, Math.round(raw)));
}

export interface ScoredAdr {
  adr: ADR;
  score: number;
  relevant: boolean;
}

export class RetrievalAgent {
  constructor(private readonly embeddings: EmbeddingService = new EmbeddingService()) {}

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Return the top-K most relevant ADRs for the given query, ranked by a blend of
   * TF-IDF lexical similarity and local-embedding semantic similarity. Embeddings
   * are generated lazily and cached on the ADR (via adrStore) so repeat retrievals
   * don't re-embed unchanged ADRs. Semantic scoring is skipped (falls back to pure
   * TF-IDF) if the local embedding model is unavailable.
   */
  async retrieve(
    query: string,
    adrs: ADR[],
    blueprint: ArchBlueprint | null,
    topK = DEFAULT_TOP_K,
    adrStore?: AdrStore | null
  ): Promise<ADR[]> {
    // Only binding decisions count as context — pending, rejected and retired ADRs must not
    // be used to judge new code.
    const accepted = adrs.filter((a) => a.status === "accepted");
    if (accepted.length <= topK) { return accepted; } // nothing to rank (T26)
    if (!query.trim())           { return accepted.slice(0, topK); }

    const { results } = await this.retrieveScored(query, accepted, blueprint, topK, adrStore);
    return results.map((r) => r.adr);
  }

  /**
   * Like `retrieve`, but always scores (no short-circuit for small ADR sets) and returns each
   * ADR's score plus whether it clears the relevance threshold — used where the developer is
   * shown "relevant ADRs", so barely-related ones aren't presented as relevant.
   */
  async retrieveScored(
    query: string,
    adrs: ADR[],
    blueprint: ArchBlueprint | null,
    topK = DEFAULT_TOP_K,
    adrStore?: AdrStore | null
  ): Promise<{ results: ScoredAdr[]; semantic: boolean }> {
    const accepted = adrs.filter((a) => a.status === "accepted");
    if (!accepted.length || !query.trim()) { return { results: [], semantic: false }; }

    const adrTexts = accepted.map(RetrievalAgent.adrToText);
    const corpus   = [...adrTexts, query];
    const vocab    = RetrievalAgent.buildVocabulary(corpus);
    const idf      = RetrievalAgent.computeIdf(corpus, vocab);
    const queryVec = RetrievalAgent.tfidf(query, vocab, idf);

    // Component names used for keyword boost
    const componentNames = (blueprint?.components ?? [])
      .map((c) => c.name.toLowerCase());

    const queryLower     = query.toLowerCase();
    const queryEmbedding = await this.embeddings.embed(query);
    let semantic = false;

    const scored: { adr: ADR; score: number }[] = [];
    for (let i = 0; i < accepted.length; i++) {
      const adr    = accepted[i];
      const adrVec = RetrievalAgent.tfidf(adrTexts[i], vocab, idf);
      let score    = RetrievalAgent.cosine(queryVec, adrVec);

      if (queryEmbedding) {
        const adrEmbedding = await this.ensureEmbedding(adr, adrTexts[i], adrStore);
        if (adrEmbedding && adrEmbedding.length === queryEmbedding.length) {
          const semanticScore = RetrievalAgent.cosineArrays(queryEmbedding, adrEmbedding);
          score = (1 - SEMANTIC_WEIGHT) * score + SEMANTIC_WEIGHT * semanticScore;
          semantic = true;
        }
      }

      const adrLower = adrTexts[i].toLowerCase();
      // Boost when both the ADR and the query mention the same component
      for (const name of componentNames) {
        if (name.length >= 3 && adrLower.includes(name) && queryLower.includes(name)) {
          score += COMPONENT_BOOST;
        }
      }

      scored.push({ adr, score });
    }

    const threshold = semantic ? RELEVANCE_THRESHOLD.blended : RELEVANCE_THRESHOLD.lexical;
    return {
      semantic,
      results: scored
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((s) => ({ ...s, relevant: s.score >= threshold })),
    };
  }

  /** Returns the ADR's cached embedding, generating and persisting one if missing/stale. */
  async ensureEmbedding(
    adr: ADR,
    text: string,
    adrStore?: AdrStore | null
  ): Promise<number[] | null> {
    if (adr.embedding) { return adr.embedding; }

    const embedding = await this.embeddings.embed(text);
    if (embedding) {
      adr.embedding = embedding;
      if (adrStore) {
        try { await adrStore.storeEmbedding(adr.id, embedding); } catch { /* best effort */ }
      }
    }
    return embedding;
  }

  /** Build a plain-text query string from a DiffSummary. */
  static queryFromDiff(diff: DiffSummary): string {
    return [
      ...diff.changedFiles,
      ...diff.newSignatures,
      ...diff.newImports,
      ...diff.newDependencies,
      ...diff.removedDependencies,
    ].join(" ");
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  static adrToText(adr: ADR): string {
    return `${adr.title} ${adr.context} ${adr.decision} ${adr.consequences ?? ""}`;
  }

  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  }

  private static buildVocabulary(documents: string[]): Map<string, number> {
    const vocab = new Map<string, number>();
    for (const doc of documents) {
      for (const token of RetrievalAgent.tokenize(doc)) {
        if (!vocab.has(token)) { vocab.set(token, vocab.size); }
      }
    }
    return vocab;
  }

  private static computeIdf(documents: string[], vocab: Map<string, number>): Float64Array {
    const N  = documents.length;
    const df = new Float64Array(vocab.size);
    for (const doc of documents) {
      const unique = new Set(RetrievalAgent.tokenize(doc));
      for (const token of unique) {
        const i = vocab.get(token);
        if (i !== undefined) { df[i]++; }
      }
    }
    const idf = new Float64Array(vocab.size);
    for (let i = 0; i < vocab.size; i++) {
      idf[i] = Math.log((N + 1) / (df[i] + 1)) + 1; // smoothed IDF
    }
    return idf;
  }

  private static tfidf(
    text: string,
    vocab: Map<string, number>,
    idf: Float64Array
  ): Float64Array {
    const tokens = RetrievalAgent.tokenize(text);
    if (tokens.length === 0) { return new Float64Array(vocab.size); }

    const tf = new Map<string, number>();
    for (const t of tokens) { tf.set(t, (tf.get(t) ?? 0) + 1); }

    const vec = new Float64Array(vocab.size);
    for (const [token, count] of tf) {
      const i = vocab.get(token);
      if (i !== undefined) { vec[i] = (count / tokens.length) * idf[i]; }
    }

    // L2 normalise
    let norm = 0;
    for (const v of vec) { norm += v * v; }
    norm = Math.sqrt(norm);
    if (norm > 0) { for (let i = 0; i < vec.length; i++) { vec[i] /= norm; } }

    return vec;
  }

  private static cosine(a: Float64Array, b: Float64Array): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; }
    return dot; // already L2-normalised
  }

  /** Cosine similarity between two already L2-normalized embedding vectors. */
  private static cosineArrays(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; }
    return dot;
  }
}
