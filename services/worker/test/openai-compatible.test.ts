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
    conversationSegment: {
      order: string;
      items: Array<{ depth: number; relation: string; text: string }>;
    };
    topicAliases: string[];
    topicVariantExamples: string[];
    topicReferenceHints: { conversationSegment: string[] };
  };

  assert.match(systemPrompt, /targeted stance/u);
  assert.match(systemPrompt, /không sao chép sắc thái/u);
  assert.match(systemPrompt, /VinSmart Future\/VSF/u);
  assert.match(systemPrompt, /trải nghiệm công sở/u);
  assert.equal(userPrompt.textToClassify, input.text);
  assert.equal(userPrompt.conversationSegment.order, "ancestors_target_replies");
  assert.equal(
    userPrompt.conversationSegment.items.at(-1)?.text,
    input.conversationContext,
  );
  assert.equal(
    userPrompt.conversationSegment.items.at(-1)?.relation,
    "direct_parent",
  );
  assert.ok(userPrompt.topicAliases.includes("VSF"));
  assert.ok(userPrompt.topicVariantExamples.includes("vờ sờ phờ"));
  assert.ok(userPrompt.topicReferenceHints.conversationSegment.includes("VSF"));
});

test("a comment segment is evaluated in one batch request", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    entityId: "comment-1",
                    isRelevant: true,
                    label: "neutral",
                    confidence: 0.8,
                    reason: "Câu hỏi về môi trường làm việc.",
                    language: "vi",
                  },
                  {
                    entityId: "comment-2",
                    isRelevant: true,
                    label: "negative",
                    confidence: 0.9,
                    reason: "Reply chê chính sách công sở.",
                    language: "vi",
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const provider = new OpenAICompatibleSentimentProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-5.6-terra",
    });
    const results = await provider.analyzeBatch([
      { ...input, entityId: "comment-1", text: "Công sở ở đây thế nào?" },
      { ...input, entityId: "comment-2", text: "Chính sách chưa ổn." },
    ]);
    assert.equal(results.length, 2);
    assert.equal(results[1]?.label, "negative");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const messages = requestBody.messages as Array<{ content: string }>;
  const userPrompt = JSON.parse(messages[1]!.content) as {
    targets: Array<{ entityId: string }>;
  };
  assert.deepEqual(
    userPrompt.targets.map((target) => target.entityId),
    ["comment-1", "comment-2"],
  );
  assert.match(messages[0]!.content, /Đây là yêu cầu batch/u);
});
