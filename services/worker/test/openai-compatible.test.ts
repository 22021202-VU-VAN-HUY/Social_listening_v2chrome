import assert from "node:assert/strict";
import test from "node:test";
import { OpenAICompatibleSentimentProvider } from "../src/sentiment/providers/openai-compatible.js";
import {
  buildSentimentSystemPrompt,
  buildSentimentUserPrompt,
} from "../src/sentiment/prompt.js";

const input = {
  entityType: "comment" as const,
  entityId: "comment-1",
  text: "Chương trình rất tốt.",
  postContext: "Bài viết về VinFuture.",
  conversationContext: "Một phản hồi trước đó về VSF.",
  topic: "VinSmart Future / VinFuture",
};

function successfulResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isRelevant: true,
              label: "positive",
              confidence: 0.9,
              reason: "Comment đánh giá tích cực.",
              language: "vi",
            }),
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

test("GPT-5.6 uses no reasoning and omits temperature", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return successfulResponse();
  };

  try {
    const provider = new OpenAICompatibleSentimentProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-5.6-terra",
    });
    await provider.analyze(input);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBody.reasoning_effort, "none");
  assert.equal("temperature" in requestBody, false);
});

test("older OpenAI-compatible models keep temperature zero", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return successfulResponse();
  };

  try {
    const provider = new OpenAICompatibleSentimentProvider({
      baseUrl: "https://provider.example/v1",
      apiKey: undefined,
      model: "legacy-sentiment-model",
    });
    await provider.analyze(input);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBody.temperature, 0);
  assert.equal("reasoning_effort" in requestBody, false);
});

test("Gemini compatibility uses low reasoning and keeps provider identity", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  let authorization = "";
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return successfulResponse();
  };

  const provider = new OpenAICompatibleSentimentProvider({
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: "gemini-test-key",
    model: "gemini-3.6-flash",
    name: "gemini",
  });

  try {
    await provider.analyze(input);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(provider.name, "gemini");
  assert.equal(
    requestUrl,
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  );
  assert.equal(requestBody.reasoning_effort, "low");
  assert.equal("temperature" in requestBody, false);
  assert.equal(authorization, "Bearer gemini-test-key");
});

test("prompt isolates target stance and includes the reply thread", () => {
  const systemPrompt = buildSentimentSystemPrompt();
  const userPrompt = JSON.parse(buildSentimentUserPrompt(input)) as {
    textToClassify: string;
    replyThread: string;
    topicAliases: string[];
  };

  assert.match(systemPrompt, /targeted stance/u);
  assert.match(systemPrompt, /không sao chép sắc thái/u);
  assert.match(systemPrompt, /VinSmart Future\/VSF/u);
  assert.equal(userPrompt.textToClassify, input.text);
  assert.equal(userPrompt.replyThread, input.conversationContext);
  assert.ok(userPrompt.topicAliases.includes("VSF"));
});
