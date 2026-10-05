import { describe, it, expect, vi, afterEach } from "vitest";
import { LLMClient } from "../src/llm/LLMClient";

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

/** Stub global fetch with a queue of responses; returns the recorded calls. */
function stubFetch(...responses: (Response | Error)[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) { throw new Error("no stubbed response left"); }
    if (next instanceof Error) { throw next; }
    return next;
  }));
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("LLMClient routing", () => {
  it("T7: Gemini — generateContent with systemInstruction/contents; key in a header, not the URL", async () => {
    const calls = stubFetch(json({ candidates: [{ content: { parts: [{ text: "hel" }, { text: "lo" }] } }] }));
    expect(await new LLMClient("gemini", "KEY123").complete("sys", "user")).toBe("hello");
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent");
    expect(calls[0].url).not.toContain("KEY123");
    expect(calls[0].init.headers["x-goog-api-key"]).toBe("KEY123");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      systemInstruction: { parts: [{ text: "sys" }] }, contents: [{ parts: [{ text: "user" }] }],
    });
  });

  it("T8: Anthropic — /v1/messages with x-api-key and anthropic-version", async () => {
    const calls = stubFetch(json({ content: [{ type: "text", text: "ok" }] }));
    expect(await new LLMClient("anthropic", "sk-ant").complete("sys", "user")).toBe("ok");
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].init.headers).toMatchObject({ "x-api-key": "sk-ant", "anthropic-version": "2023-06-01" });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ system: "sys", messages: [{ role: "user", content: "user" }] });
  });

  it.each([
    ["openai", "https://api.openai.com/v1/chat/completions"],
    ["groq", "https://api.groq.com/openai/v1/chat/completions"],
    ["openrouter", "https://openrouter.ai/api/v1/chat/completions"],
  ] as const)("T9: %s — /chat/completions with Bearer auth and system+user messages", async (provider, url) => {
    const calls = stubFetch(json({ choices: [{ message: { content: "ok" } }] }));
    expect(await new LLMClient(provider, "k").complete("sys", "user")).toBe("ok");
    expect(calls[0].url).toBe(url);
    expect(calls[0].init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(String(calls[0].init.body)).messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "user" }]);
  });

  it("a model override is used instead of the default", async () => {
    const calls = stubFetch(json({ choices: [{ message: { content: "ok" } }] }));
    await new LLMClient("openai", "k", "gpt-4o").complete("s", "u");
    expect(JSON.parse(String(calls[0].init.body)).model).toBe("gpt-4o");
  });
});

describe("LLMClient errors and retries", () => {
  it("T10: a non-OK response throws with the status code and body, without retrying", async () => {
    const calls = stubFetch(new Response("API key not valid", { status: 400 }));
    await expect(new LLMClient("gemini", "bad").complete("s", "u")).rejects.toThrow(/Gemini API error 400: API key not valid/);
    expect(calls).toHaveLength(1);
  });

  it("retries 429 (honouring retry-after) and then succeeds", async () => {
    const calls = stubFetch(
      new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
      json({ choices: [{ message: { content: "ok" } }] }),
    );
    expect(await new LLMClient("groq", "k").complete("s", "u")).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("gives up after 3 attempts", async () => {
    const busy = () => new Response("busy", { status: 503, headers: { "retry-after": "0" } });
    const calls = stubFetch(busy(), busy(), busy());
    await expect(new LLMClient("openai", "k").complete("s", "u")).rejects.toThrow(/503/);
    expect(calls).toHaveLength(3);
  });

  it("an empty or blocked Gemini response is an error, not a crash", async () => {
    stubFetch(json({ candidates: [], promptFeedback: { blockReason: "SAFETY" } }));
    await expect(new LLMClient("gemini", "k").complete("s", "u")).rejects.toThrow(/empty response \(blocked: SAFETY\)/);
  });
});

describe("LLMClient.validate (setup wizard key check)", () => {
  it.each([
    [new Response("unauthorized", { status: 401 }), /rejected this API key/],
    [new Response("API key not valid. Please pass a valid API key.", { status: 400 }), /rejected this API key/],
    [new Response("model not found", { status: 404 }), /could not find the model/],
  ])("maps failures to actionable messages (%#)", async (response, expected) => {
    stubFetch(response);
    expect(await new LLMClient("gemini", "k").validate()).toMatch(expected);
  });

  it("returns null when the key works", async () => {
    stubFetch(json({ choices: [{ message: { content: "OK" } }] }));
    expect(await new LLMClient("groq", "k").validate()).toBeNull();
  });
});

describe("LLMClient secrets (T5)", () => {
  class MemorySecrets {
    private readonly data = new Map<string, string>();
    async get(key: string) { return this.data.get(key); }
    async store(key: string, value: string) { this.data.set(key, value); }
    async delete(key: string) { this.data.delete(key); }
  }

  it("round-trips provider and key through SecretStorage only", async () => {
    const secrets = new MemorySecrets();
    expect(await LLMClient.fromSecrets(secrets as never)).toBeNull(); // T6 precondition: nothing configured
    await LLMClient.saveToSecrets(secrets as never, "gemini", "KEY");
    const client = await LLMClient.fromSecrets(secrets as never);
    expect(client).toBeInstanceOf(LLMClient);
  });

  it("no default key outside a dev build", () => {
    expect(LLMClient.getDefault()).toBeNull();
  });
});
