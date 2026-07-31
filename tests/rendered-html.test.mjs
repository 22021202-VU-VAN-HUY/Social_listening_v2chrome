import assert from "node:assert/strict";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);
const starterMarkers = [
  /codex-preview/i,
  /Starter Project/i,
  /Your site is taking shape/i,
  /Building your site/i,
  /Your first version will appear here/i,
  /SkeletonPreview/i,
];

async function render(pathname) {
  const workerUrl = new URL("dist/server/index.js", templateRoot);
  workerUrl.searchParams.set(
    "test",
    `${pathname}-${process.pid}-${Date.now()}-${Math.random()}`,
  );
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function assertProductPage(html) {
  for (const marker of starterMarkers) {
    assert.doesNotMatch(html, marker);
  }
  assert.match(html, /lang="vi"/i);
  assert.match(html, /Social Listening/);
}

test("server-renders the Vietnamese dashboard", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assertProductPage(html);
  assert.match(html, /<title>Tổng quan · Social Listening<\/title>/i);
  assert.match(html, /Đang dựng bức tranh thảo luận/i);
  assert.match(html, /Kết nối bình luận, phản hồi và AI sentiment/i);
});

test("server-renders Facebook collection settings", async () => {
  const response = await render("/settings");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assertProductPage(html);
  assert.match(html, /<title>Thiết lập · Social Listening<\/title>/i);
  assert.match(html, /Chọn đúng nguồn, nghe đúng tín hiệu/i);
  assert.match(html, /Facebook Extension/i);
  assert.match(html, /Group đã tham gia/i);
  assert.match(html, /Từ khóa theo dõi/i);
  assert.match(html, /Không lưu link hồ sơ/i);
});

test("server-renders the jobs progress route", async () => {
  const response = await render("/jobs");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assertProductPage(html);
  assert.match(html, /<title>Tiến trình · Social Listening<\/title>/i);
  assert.match(html, /Đang đọc hàng đợi job/i);
  assert.match(html, /Kết nối extension, crawler và bộ phân loại sentiment/i);
});
