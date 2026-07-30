import type { WorkerConfig } from "../config.js";
import type { SentimentProvider } from "./schema.js";
import { HeuristicSentimentProvider } from "./providers/heuristic.js";
import { OllamaSentimentProvider } from "./providers/ollama.js";
import { OpenAICompatibleSentimentProvider } from "./providers/openai-compatible.js";

export function createSentimentProvider(
  config: WorkerConfig,
): SentimentProvider {
  switch (config.SENTIMENT_PROVIDER) {
    case "openai-compatible":
      return new OpenAICompatibleSentimentProvider({
        baseUrl: config.SENTIMENT_BASE_URL,
        apiKey: config.SENTIMENT_API_KEY,
        model: config.SENTIMENT_MODEL,
      });
    case "ollama":
      return new OllamaSentimentProvider({
        baseUrl: config.SENTIMENT_BASE_URL,
        model: config.SENTIMENT_MODEL,
      });
    case "heuristic":
      if (!config.ALLOW_HEURISTIC_FALLBACK) {
        throw new Error(
          "Heuristic sentiment is disabled. Configure an AI provider.",
        );
      }
      return new HeuristicSentimentProvider(config.SENTIMENT_MODEL);
  }
}
