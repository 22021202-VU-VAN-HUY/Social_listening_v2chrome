import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://social:social@localhost:5432/social_listening"),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  SENTIMENT_PROVIDER: z
    .enum(["heuristic", "openai-compatible", "ollama"])
    .default("heuristic"),
  SENTIMENT_MODEL: z.string().min(1).default("sentiment-development"),
  SENTIMENT_API_KEY: z.string().optional(),
  SENTIMENT_BASE_URL: z.string().url().default("http://localhost:11434"),
  SENTIMENT_TOPIC: z.string().min(1).default("VinSmart Future / VinFuture"),
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
