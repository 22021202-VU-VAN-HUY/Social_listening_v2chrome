import assert from "node:assert/strict";
import test from "node:test";

import { calculateDateRangeWindow } from "../src/time-window.js";

test("custom date windows include complete local days across years", () => {
  const window = calculateDateRangeWindow(
    "2024-12-31",
    "2025-01-02",
    "Asia/Ho_Chi_Minh",
  );

  assert.equal(window.start.toISOString(), "2024-12-30T17:00:00.000Z");
  assert.equal(window.end.toISOString(), "2025-01-02T16:59:59.999Z");
});

test("custom date windows respect daylight-saving changes", () => {
  const window = calculateDateRangeWindow(
    "2026-03-08",
    "2026-03-08",
    "America/New_York",
  );

  assert.equal(window.start.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-03-09T03:59:59.999Z");
});
