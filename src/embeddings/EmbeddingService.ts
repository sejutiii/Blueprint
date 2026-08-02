// Local, offline sentence-embedding model (runs in-process via ONNX Runtime — no API key, no network calls after the one-time model download).
let pipelinePromise: Promise<any> | null = null;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

async function getPipeline(): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", MODEL_ID)
    );
  }
  return pipelinePromise;
}

export class EmbeddingService {
  private static loadFailed = false;

  /**
   * Returns a 384-dim, L2-normalized embedding for the given text, or null if the
   * local model failed to load (e.g. no network on first run to fetch model weights).
   * Callers should treat null as "semantic search unavailable" and fall back to TF-IDF.
   */
  async embed(text: string): Promise<number[] | null> {
    if (EmbeddingService.loadFailed) { return null; }
    try {
      const extractor = await getPipeline();
      const output = await extractor(text, { pooling: "mean", normalize: true });
      return Array.from(output.data as Float32Array);
    } catch (err) {
      console.error("BluePrint: local embedding model unavailable, falling back to TF-IDF only.", err);
      EmbeddingService.loadFailed = true;
      pipelinePromise = null;
      return null;
    }
  }
}
