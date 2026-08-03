import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createSentimentProvider } from "../src/sentiment/provider-factory.js";

test("auto provider prefers OpenAI when all API keys exist", () => {
  const provider = createSentimentProvider(
    loadConfig({
      SENTIMENT_PROVIDER: "auto",
      OPENAI_API_KEY: "openai-test-key",
      GEMINI_API_KEY: "gemini-test-key",
      MIMO_API_KEY: "mimo-test-key",
    }),
  );

  assert.equal(provider.name, "openai");
  assert.equal(provider.model, "gpt-5.6-terra");
});

test("auto provider uses Gemini when the OpenAI key is empty", () => {
  const provider = createSentimentProvider(
    loadConfig({
      SENTIMENT_PROVIDER: "auto",
      OPENAI_API_KEY: "  ",
      SENTIMENT_API_KEY: "",
      GEMINI_API_KEY: "gemini-test-key",
      MIMO_API_KEY: "mimo-test-key",
    }),
  );

  assert.equal(provider.name, "gemini");
  assert.equal(provider.model, "gemini-3.6-flash");
});

test("auto provider uses MiMo when OpenAI and Gemini keys are empty", () => {
  const provider = createSentimentProvider(
    loadConfig({
      SENTIMENT_PROVIDER: "auto",
      OPENAI_API_KEY: "",
      SENTIMENT_API_KEY: "",
      GEMINI_API_KEY: "  ",
      MIMO_API_KEY: "mimo-test-key",
    }),
  );

  assert.equal(provider.name, "mimo");
  assert.equal(provider.model, "mimo-v2.5-pro");
});

test("auto provider requires a key when heuristic fallback is disabled", () => {
  const config = loadConfig({
    SENTIMENT_PROVIDER: "auto",
    ALLOW_HEURISTIC_FALLBACK: "false",
  });

  assert.throws(
    () => createSentimentProvider(config),
    /OPENAI_API_KEY, GEMINI_API_KEY, or MIMO_API_KEY/u,
  );
});
