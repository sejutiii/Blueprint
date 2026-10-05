import * as vscode from "vscode";

export type Provider = "gemini" | "groq" | "openrouter" | "anthropic" | "openai";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
};

// Where a developer gets a key for each provider (shown in the setup wizard).
export const PROVIDER_KEY_PAGES: Record<Provider, { url: string; free: boolean }> = {
  gemini:     { url: "https://aistudio.google.com/apikey", free: true },
  groq:       { url: "https://console.groq.com/keys", free: true },
  openrouter: { url: "https://openrouter.ai/keys", free: true },
  anthropic:  { url: "https://console.anthropic.com/settings/keys", free: false },
  openai:     { url: "https://platform.openai.com/api-keys", free: false },
};

const DEFAULT_MODELS: Record<Provider, string> = {
  gemini: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "google/gemini-2.0-flash-exp:free",
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
};

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS       = 3;
const RETRYABLE_STATUS   = new Set([429, 500, 502, 503, 504]);

export class LLMClient {
  constructor(
    private readonly provider: Provider,
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODELS[provider]
  ) {}

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    switch (this.provider) {
      case "gemini":    return this.callGemini(systemPrompt, userMessage);
      case "anthropic": return this.callAnthropic(systemPrompt, userMessage);
      default:          return this.callOpenAICompatible(systemPrompt, userMessage);
    }
  }

  // POST with a timeout and retry-with-backoff on rate limits / transient server errors.
  // Free-tier providers hit 429 routinely, so one blip must not fail a whole workflow (T10).
  private async post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) {
          return res;
        }
        await sleep(LLMClient.backoffMs(attempt, res.headers.get("retry-after")));
      } catch (err) {
        lastError = err;
        if (attempt === MAX_ATTEMPTS) { break; }
        await sleep(LLMClient.backoffMs(attempt, null));
      } finally {
        clearTimeout(timer);
      }
    }
    const reason = lastError instanceof Error && lastError.name === "AbortError"
      ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
      : String(lastError instanceof Error ? lastError.message : lastError);
    throw new Error(`${PROVIDER_LABELS[this.provider]} request failed: ${reason}`);
  }

  private static backoffMs(attempt: number, retryAfter: string | null): number {
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(seconds) && seconds >= 0) { return Math.min(seconds, 30) * 1000; }
    return 1000 * 2 ** (attempt - 1);
  }

  private async failure(res: Response): Promise<Error> {
    return new Error(`${PROVIDER_LABELS[this.provider]} API error ${res.status}: ${await res.text()}`);
  }

  private async callOpenAICompatible(system: string, user: string): Promise<string> {
    const baseUrls: Partial<Record<Provider, string>> = {
      openai:     "https://api.openai.com/v1",
      groq:       "https://api.groq.com/openai/v1",
      openrouter: "https://openrouter.ai/api/v1",
    };
    const res = await this.post(
      `${baseUrls[this.provider]}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }
    );
    if (!res.ok) { throw await this.failure(res); }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") { throw new Error(`${PROVIDER_LABELS[this.provider]} returned no message content.`); }
    return text;
  }

  private async callGemini(system: string, user: string): Promise<string> {
    // Key goes in a header, not the URL, so it can't leak into logs or error text.
    const res = await this.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      { "x-goog-api-key": this.apiKey },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
      }
    );
    if (!res.ok) { throw await this.failure(res); }
    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      promptFeedback?: { blockReason?: string };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) {
      const why = data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : "";
      throw new Error(`Gemini returned an empty response${why}.`);
    }
    return text;
  }

  private async callAnthropic(system: string, user: string): Promise<string> {
    const res = await this.post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.model,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      }
    );
    if (!res.ok) { throw await this.failure(res); }
    const data = await res.json() as { content?: { type?: string; text?: string }[] };
    const text = data.content?.filter((c) => typeof c.text === "string").map((c) => c.text).join("");
    if (!text) { throw new Error("Anthropic returned an empty response."); }
    return text;
  }

  /**
   * Make one tiny request to confirm the key works before it is saved, and turn the common
   * failures into an actionable message. Returns null on success.
   */
  async validate(): Promise<string | null> {
    try {
      await this.complete("You are a connectivity check. Reply with the single word OK.", "ping");
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const label   = PROVIDER_LABELS[this.provider];
      if (/\b(401|403)\b/.test(message) || /API key not valid|invalid.*key|unauthori[sz]ed/i.test(message)) {
        return `${label} rejected this API key. Check that you copied the whole key and that it belongs to ${label}.`;
      }
      if (/\b429\b/.test(message)) {
        return `${label} accepted the key but is rate-limiting it right now (HTTP 429). Wait a minute and try again.`;
      }
      if (/\b404\b/.test(message)) {
        return `${label} could not find the model "${this.model}" for this key (HTTP 404). The key may not have access to it.`;
      }
      return `Could not reach ${label}: ${message}`;
    }
  }

  static async fromSecrets(secrets: vscode.SecretStorage): Promise<LLMClient | null> {
    const provider = await secrets.get("blueprint.provider") as Provider | undefined;
    const apiKey   = await secrets.get("blueprint.apiKey");
    if (!provider || !apiKey) { return null; }
    return new LLMClient(provider, apiKey);
  }

  static async saveToSecrets(
    secrets: vscode.SecretStorage,
    provider: Provider,
    apiKey: string
  ): Promise<void> {
    await secrets.store("blueprint.provider", provider);
    await secrets.store("blueprint.apiKey", apiKey);
  }

  // Baked in at build time from .env (BLUEPRINT_DEFAULT_PROVIDER / BLUEPRINT_DEFAULT_API_KEY),
  // never committed to source. Lets onboarding skip the "paste an API key" step.
  static getDefault(): { provider: Provider; apiKey: string } | null {
    const provider = process.env.BLUEPRINT_DEFAULT_PROVIDER as Provider | undefined;
    const apiKey   = process.env.BLUEPRINT_DEFAULT_API_KEY;
    if (!provider || !apiKey || !(provider in PROVIDER_LABELS)) { return null; }
    return { provider, apiKey };
  }

  static async useDefault(secrets: vscode.SecretStorage): Promise<boolean> {
    const def = LLMClient.getDefault();
    if (!def) { return false; }
    await LLMClient.saveToSecrets(secrets, def.provider, def.apiKey);
    return true;
  }
}
