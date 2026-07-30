import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateChecksum,
  checksumsMatch,
  stableStringify,
} from "../src/idempotency.js";

test("stableStringify is independent of object key insertion order", () => {
  assert.equal(
    stableStringify({ z: 1, nested: { b: 2, a: 1 } }),
    stableStringify({ nested: { a: 1, b: 2 }, z: 1 }),
  );
});

test("checksum is stable and changes when payload content changes", () => {
  const first = calculateChecksum({ posts: [{ id: "1", body: "same" }] });
  const reordered = calculateChecksum({ posts: [{ body: "same", id: "1" }] });
  const changed = calculateChecksum({ posts: [{ id: "1", body: "changed" }] });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.equal(checksumsMatch(first, reordered), true);
  assert.equal(checksumsMatch(first, changed), false);
});

test("checksum matcher rejects malformed digests", () => {
  assert.equal(checksumsMatch("not-a-checksum", "not-a-checksum"), false);
});
