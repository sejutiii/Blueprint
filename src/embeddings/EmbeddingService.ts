// Local, offline sentence-embedding model (runs in-process via ONNX Runtime — no API key, no
// network calls after the one-time model download on first use).
let pipelinePromise: Promise<any> | null = null;
let cacheDir: string | null = null;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
// 8-bit quantized weights (~23 MB instead of ~87 MB fp32); quality is near-identical for retrieval.
const MODEL_DTYPE = "q8";

/** Called on activation: where downloaded model weights are cached (VS Code global storage). */
export function configureEmbeddings(options: { cacheDir: string }): void {
  cacheDir = options.cacheDir;
}

async function getPipeline(): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // CommonJS require (not import()) so the same transformers.node.cjs file is used in
      // development and in the packaged extension's staged runtime (dist/node_modules).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { pipeline, env } = require("@huggingface/transformers");
      if (cacheDir) { env.cacheDir = cacheDir; }
      return pipeline("feature-extraction", MODEL_ID, { dtype: MODEL_DTYPE });
    })();
  }
  return pipelinePromise;
}

export class EmbeddingService {
  private static loadFailed = false;

  /**
   * Returns a 384-dim, L2-normalized embedding for the given text, or null if the
   * local model failed to load (e.g. no network on first run to fetch model weights, or a
   * platform without a bundled ONNX runtime). Callers treat null as "semantic search
   * unavailable" and fall back to TF-IDF.
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
