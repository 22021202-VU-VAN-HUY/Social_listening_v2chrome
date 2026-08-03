import type { WorkerConfig } from "../config.js";
import type { SentimentProvider } from "./schema.js";
import { HeuristicSentimentProvider } from "./providers/heuristic.js";
import { OllamaSentimentProvider } from "./providers/ollama.js";
import { OpenAICompatibleSentimentProvider } from "./providers/openai-compatible.js";

export function createSentimentProvider(
  config: WorkerConfig,
): SentimentProvider {
  const openAiKey = config.OPENAI_API_KEY ?? config.SENTIMENT_API_KEY;
  const createOpenAiProvider = () =>
    new OpenAICompatibleSentimentProvider({
      baseUrl: config.OPENAI_BASE_URL,
      apiKey: openAiKey,
      model: config.OPENAI_MODEL,
      name: "openai",
    });
  const createGeminiProvider = () =>
    new OpenAICompatibleSentimentProvider({
      baseUrl: config.GEMINI_BASE_URL,
      apiKey: config.GEMINI_API_KEY,
      model: config.GEMINI_MODEL,
      name: "gemini",
    });
  const createMimoProvider = () =>
    new OpenAICompatibleSentimentProvider({
      baseUrl: config.MIMO_BASE_URL,
      apiKey: config.MIMO_API_KEY,
      model: config.MIMO_MODEL,
      name: "mimo",
    });

  switch (config.SENTIMENT_PROVIDER) {
    case "auto":
      if (openAiKey) return createOpenAiProvider();
      if (config.GEMINI_API_KEY) return createGeminiProvider();
      if (config.MIMO_API_KEY) return createMimoProvider();
      if (config.ALLOW_HEURISTIC_FALLBACK) {
        return new HeuristicSentimentProvider(config.SENTIMENT_MODEL);
      }
      throw new Error(
        "No AI API key is configured. Set OPENAI_API_KEY, GEMINI_API_KEY, or MIMO_API_KEY.",
      );
    case "openai-compatible":
      if (!openAiKey && config.GEMINI_API_KEY) {
        return createGeminiProvider();
      }
      if (!openAiKey && config.MIMO_API_KEY) {
        return createMimoProvider();
      }
      return new OpenAICompatibleSentimentProvider({
        baseUrl: config.SENTIMENT_BASE_URL,
        apiKey: openAiKey,
        model: config.SENTIMENT_MODEL,
      });
    case "gemini":
      if (!config.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is required for the Gemini provider.");
      }
      return createGeminiProvider();
    case "mimo":
      if (!config.MIMO_API_KEY) {
        throw new Error("MIMO_API_KEY is required for the MiMo provider.");
      }
      return createMimoProvider();
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
