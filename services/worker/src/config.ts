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
  WORKSPACE_ID: z
    .string()
    .uuid()
    .default("00000000-0000-4000-8000-000000000001"),
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
  THREADS_ACCESS_TOKEN: OptionalNonEmptyString,
  THREADS_GRAPH_BASE_URL: z
    .string()
    .url()
    .default("https://graph.threads.net"),
  THREADS_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/u)
    .default("v1.0"),
  THREADS_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  THREADS_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  THREADS_MAX_PAGES_PER_TASK: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
  THREADS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  THREADS_MAX_REQUESTS_PER_JOB: z.coerce
    .number()
    .int()
    .min(0)
    .max(2_200)
    .default(0),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): WorkerConfig {
  return ConfigSchema.parse(source);
}
