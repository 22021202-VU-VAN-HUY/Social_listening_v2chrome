import { z } from "zod";

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
    DATABASE_URL: z
      .string()
      .url()
      .default("postgres://listening:listening@localhost:5432/listening"),
    WORKSPACE_ID: z
      .string()
      .uuid()
      .default("00000000-0000-4000-8000-000000000001"),
    DEVICE_ONLINE_SECONDS: z.coerce.number().int().min(15).max(600).default(60),
    LEASE_TTL_SECONDS: z.coerce.number().int().min(15).max(300).default(45),
    ADAPTER_VERSION: z.string().min(1).max(100).default("facebook-dom-v1"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000,http://127.0.0.1:3000"),
  })
  .passthrough();

export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl: string;
  workspaceId: string;
  deviceOnlineSeconds: number;
  leaseTtlSeconds: number;
  adapterVersion: string;
  corsOrigins: string[];
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = environmentSchema.parse(environment);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    workspaceId: parsed.WORKSPACE_ID,
    deviceOnlineSeconds: parsed.DEVICE_ONLINE_SECONDS,
    leaseTtlSeconds: parsed.LEASE_TTL_SECONDS,
    adapterVersion: parsed.ADAPTER_VERSION,
    corsOrigins: parsed.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim().replace(/\/+$/u, ""))
      .filter(Boolean),
  };
}
