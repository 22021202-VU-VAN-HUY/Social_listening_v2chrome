import {
  buildSentimentBatchSystemPrompt,
  buildSentimentBatchUserPrompt,
  buildSentimentSystemPrompt,
  buildSentimentUserPrompt,
} from "../prompt.js";
import {
  SentimentBatchResultSchema,
  SentimentResultSchema,
  type SentimentBatchResult,
  type SentimentInput,
  type SentimentProvider,
  type SentimentResult,
} from "../schema.js";

interface OllamaOptions {
  baseUrl: string;
  model: string;
}

export class OllamaSentimentProvider implements SentimentProvider {
  readonly name = "ollama";
  readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OllamaOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.model = options.model;
  }

  async analyze(input: SentimentInput): Promise<SentimentResult> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: buildSentimentSystemPrompt() },
          { role: "user", content: buildSentimentUserPrompt(input) },
        ],
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
    };
    const content = payload.message?.content;
    if (!content) {
      throw new Error("Ollama returned an empty response.");
    }

    return SentimentResultSchema.parse(JSON.parse(content) as unknown);
  }

  async analyzeBatch(inputs: SentimentInput[]): Promise<SentimentBatchResult> {
    if (inputs.length === 0) return [];
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: buildSentimentBatchSystemPrompt() },
          { role: "user", content: buildSentimentBatchUserPrompt(inputs) },
        ],
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as {
      message?: { content?: string };
    };
    const content = payload.message?.content;
    if (!content) throw new Error("Ollama returned an empty response.");
    const results = SentimentBatchResultSchema.parse(
      JSON.parse(content) as unknown,
    ).results;
    const requested = new Set(inputs.map((input) => input.entityId));
    if (
      new Set(results.map((result) => result.entityId)).size !== results.length ||
      results.length !== requested.size ||
      results.some((result) => !requested.has(result.entityId))
    ) {
      throw new Error("Ollama returned an incomplete sentiment batch.");
    }
    return results;
  }
}
