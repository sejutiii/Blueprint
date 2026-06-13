import { ADR, ArchBlueprint, DiffSummary } from "../types";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","as","is","was","are","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","not","that",
  "this","these","those","it","its","we","our","they","their","he","she","you",
]);

export class RetrievalAgent {
  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Return the top-K most relevant ADRs for the given query.
   * Falls back to returning all ADRs if count <= topK.
   */
  retrieve(
    query: string,
    adrs: ADR[],
    blueprint: ArchBlueprint | null,
    topK = 5
  ): ADR[] {
    if (adrs.length <= topK) { return adrs; }
    if (!query.trim())       { return adrs.slice(0, topK); }

    const adrTexts = adrs.map(RetrievalAgent.adrToText);
    const corpus   = [...adrTexts, query];
    const vocab    = RetrievalAgent.buildVocabulary(corpus);
    const idf      = RetrievalAgent.computeIdf(corpus, vocab);
    const queryVec = RetrievalAgent.tfidf(query, vocab, idf);

    // Component names used for keyword boost
    const componentNames = (blueprint?.components ?? [])
      .map((c) => c.name.toLowerCase());

    const queryLower = query.toLowerCase();

    const scored = adrs.map((adr, i) => {
      const adrVec   = RetrievalAgent.tfidf(adrTexts[i], vocab, idf);
      let score      = RetrievalAgent.cosine(queryVec, adrVec);
      const adrLower = adrTexts[i].toLowerCase();

      // Boost when both the ADR and the query mention the same component
      for (const name of componentNames) {
        if (name.length >= 3 && adrLower.includes(name) && queryLower.includes(name)) {
          score += 0.15;
        }
      }

      return { adr, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.adr);
  }

  /** Build a plain-text query string from a DiffSummary. */
  static queryFromDiff(diff: DiffSummary): string {
    return [
      ...diff.newFiles,
      ...diff.newSignatures,
      ...diff.newImports,
      ...diff.newDependencies,
    ].join(" ");
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private static adrToText(adr: ADR): string {
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
}
