import assert from "node:assert/strict";
import test from "node:test";
import type { Database } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function createApp() {
  const config = loadConfig({ NODE_ENV: "test" });
  const database = {
    query: async () => {
      throw new Error("Invalid request bodies must not query PostgreSQL.");
    },
  } as unknown as Database;
  return buildApp({ config, database });
}

test("malformed JSON is reported as a safe 400 response", async () => {
  const app = createApp();
  const response = await app.inject({
    method: "PUT",
    url: "/api/v1/settings/facebook",
    headers: { "content-type": "application/json" },
    payload: '{"platform":',
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json().error, {
    code: "INVALID_REQUEST_BODY",
    message: "Request body is invalid",
    requestId: response.headers["x-request-id"],
  });
  await app.close();
});
