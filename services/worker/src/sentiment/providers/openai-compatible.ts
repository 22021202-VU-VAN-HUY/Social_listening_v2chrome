import { buildSentimentSystemPrompt, buildSentimentUserPrompt } from "../prompt.js";
import {
  SentimentResultSchema,
  type SentimentInput,
  type SentimentProvider,
  type SentimentResult,
} from "../schema.js";

interface ProviderOptions {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  name?: string;
}

function isGpt56Model(model: string): boolean {
  return /^gpt-5\.6(?:$|-)/u.test(model);
}

function isGeminiModel(model: string): boolean {
  return /^gemini-/u.test(model);
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
}

export class OpenAICompatibleSentimentProvider
  implements SentimentProvider
{
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(options: ProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.name = options.name ?? "openai-compatible";
  }

  async analyze(input: SentimentInput): Promise<SentimentResult> {
    const requestBody = {
      model: this.model,
      ...(
        isGpt56Model(this.model)
          ? { reasoning_effort: "none" }
          : isGeminiModel(this.model)
            ? { reasoning_effort: "low" }
            : { temperature: 0 }
      ),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSentimentSystemPrompt() },
        { role: "user", content: buildSentimentUserPrompt(input) },
      ],
    };
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey
          ? { authorization: `Bearer ${this.apiKey}` }
          : {}),
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Sentiment provider returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Sentiment provider returned an empty response.");
    }

    return SentimentResultSchema.parse(
      JSON.parse(stripCodeFence(content)) as unknown,
    );
  }
}
