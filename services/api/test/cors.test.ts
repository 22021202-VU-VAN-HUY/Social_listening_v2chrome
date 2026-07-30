import assert from "node:assert/strict";
import test from "node:test";
import type { Database } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function createApp() {
  const config = loadConfig({
    NODE_ENV: "test",
    CORS_ORIGINS: "http://localhost:3000,https://dashboard.example.test",
  });
  const database = {
    query: async () => {
      throw new Error("CORS preflight must not query PostgreSQL.");
    },
  } as unknown as Database;
  return buildApp({ config, database });
}

test("allows configured web origins", async () => {
  const app = createApp();
  const response = await app.inject({
    method: "OPTIONS",
    url: "/api/v1/settings/facebook",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "GET",
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "http://localhost:3000",
  );
  await app.close();
});

test("allows the paired Chrome extension but not an arbitrary website", async () => {
  const app = createApp();
  const extensionResponse = await app.inject({
    method: "OPTIONS",
    url: "/api/v1/extension/heartbeat",
    headers: {
      origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      "access-control-request-method": "POST",
    },
  });
  const rejectedResponse = await app.inject({
    method: "OPTIONS",
    url: "/api/v1/settings/facebook",
    headers: {
      origin: "https://untrusted.example",
      "access-control-request-method": "GET",
    },
  });

  assert.equal(
    extensionResponse.headers["access-control-allow-origin"],
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
  );
  assert.equal(
    rejectedResponse.headers["access-control-allow-origin"],
    undefined,
  );
  await app.close();
});
