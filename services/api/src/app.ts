import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { ApiConfig } from "./config.js";
import type { Database } from "./db.js";
import { ApiError } from "./errors.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerExtensionRoutes } from "./routes/extension.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerKeywordRoutes } from "./routes/keywords.js";
import { registerListeningRoutes } from "./routes/listening.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSourceRoutes } from "./routes/sources.js";

export function buildApp(input: {
  config: ApiConfig;
  database: Database;
}): FastifyInstance {
  const app = Fastify({
    logger: input.config.nodeEnv !== "test",
    bodyLimit: 2 * 1_024 * 1_024,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
  });
  const context = { config: input.config, database: input.database };
  const allowedOrigins = new Set(input.config.corsOrigins);

  void app.register(cors, {
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Accept",
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-Extension-Version",
      "X-Request-Id",
    ],
    exposedHeaders: ["X-Request-Id"],
    origin(origin, callback) {
      const normalized = origin?.replace(/\/+$/u, "");
      const permitted =
        !normalized ||
        normalized.startsWith("chrome-extension://") ||
        allowedOrigins.has(normalized);
      callback(null, permitted);
    },
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await input.database.query("SELECT 1");
    return { status: "ok", database: "ok" };
  });

  registerSettingsRoutes(app, context);
  registerKeywordRoutes(app, context);
  registerSourceRoutes(app, context);
  registerJobRoutes(app, context);
  registerExtensionRoutes(app, context);
  registerListeningRoutes(app, context);
  registerDashboardRoutes(app, context);

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({
      error: { code: "ROUTE_NOT_FOUND", message: "Route not found" },
    }),
  );

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId: request.id,
        },
      });
    }
    const postgresCode = (error as { code?: string }).code;
    if (postgresCode === "23505") {
      return reply.code(409).send({
        error: {
          code: "UNIQUE_CONSTRAINT_VIOLATION",
          message: "The resource already exists",
          requestId: request.id,
        },
      });
    }
    const httpStatusCode = (error as { statusCode?: number }).statusCode;
    if (
      typeof httpStatusCode === "number" &&
      httpStatusCode >= 400 &&
      httpStatusCode < 500
    ) {
      const payloadTooLarge = httpStatusCode === 413;
      return reply.code(httpStatusCode).send({
        error: {
          code: payloadTooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST_BODY",
          message: payloadTooLarge
            ? "Request body exceeds the allowed size"
            : "Request body is invalid",
          requestId: request.id,
        },
      });
    }
    request.log.error({ error }, "Unhandled API error");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: request.id,
      },
    });
  });

  return app;
}
