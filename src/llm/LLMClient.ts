import * as vscode from "vscode";

export type Provider = "gemini" | "groq" | "openrouter" | "anthropic" | "openai";

export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
};

const DEFAULT_MODELS: Record<Provider, string> = {
  gemini: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "google/gemini-2.0-flash-exp:free",
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
};

export class LLMClient {
  constructor(
    private readonly provider: Provider,
    private readonly apiKey: string
  ) {}

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    switch (this.provider) {
      case "gemini":    return this.callGemini(systemPrompt, userMessage);
      case "anthropic": return this.callAnthropic(systemPrompt, userMessage);
      default:          return this.callOpenAICompatible(systemPrompt, userMessage);
    }
  }

  private async callOpenAICompatible(system: string, user: string): Promise<string> {
    const baseUrls: Partial<Record<Provider, string>> = {
      openai:     "https://api.openai.com/v1",
      groq:       "https://api.groq.com/openai/v1",
      openrouter: "https://openrouter.ai/api/v1",
    };
    const url = `${baseUrls[this.provider]}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODELS[this.provider],
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`${PROVIDER_LABELS[this.provider]} API error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as { choices: { message: { content: string } }[] };
    return data.choices[0].message.content;
  }

  private async callGemini(system: string, user: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODELS.gemini}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as {
      candidates: { content: { parts: { text: string }[] } }[];
    };
    return data.candidates[0].content.parts[0].text;
  }

  private async callAnthropic(system: string, user: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODELS.anthropic,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as { content: { text: string }[] };
    return data.content[0].text;
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
