import "dotenv/config";
import { z } from "zod";

const OptionalNonEmptyString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const ConfigSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://social:social@localhost:5432/social_listening"),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  SENTIMENT_PROVIDER: z
    .enum([
      "auto",
      "heuristic",
      "openai-compatible",
      "gemini",
      "mimo",
      "ollama",
    ])
    .default("auto"),
  SENTIMENT_MODEL: z.string().min(1).default("sentiment-development"),
  SENTIMENT_API_KEY: OptionalNonEmptyString,
  SENTIMENT_BASE_URL: z.string().url().default("http://localhost:11434"),
  OPENAI_API_KEY: OptionalNonEmptyString,
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-terra"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  GEMINI_API_KEY: OptionalNonEmptyString,
  GEMINI_MODEL: z.string().min(1).default("gemini-3.6-flash"),
  GEMINI_BASE_URL: z
    .string()
    .url()
    .default("https://generativelanguage.googleapis.com/v1beta/openai"),
  MIMO_API_KEY: OptionalNonEmptyString,
  MIMO_MODEL: z.string().min(1).default("mimo-v2.5-pro"),
  MIMO_BASE_URL: z.string().url().default("https://api.xiaomimimo.com/v1"),
  SENTIMENT_TOPIC: z.string().min(1).default("VinSmart Future"),
  SENTIMENT_CONFIDENCE_REVIEW_THRESHOLD: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.6),
  ALLOW_HEURISTIC_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): WorkerConfig {
  return ConfigSchema.parse(source);
}
