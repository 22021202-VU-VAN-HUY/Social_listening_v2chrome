import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containsTopicReference,
  findTopicReferences,
} from "../src/sentiment/topic.js";

describe("VinSmart Future topic matching", () => {
  for (const value of [
    "VSF",
    "V.S.F",
    "V S F",
    "vi ét ép",
    "vê ét ép",
    "vờ sờ phờ",
    "VinSmart Future",
    "Vin Smat Future",
    "Vin Sờ Mát Phiu Chờ",
    "VinFuture",
    "Vin Future",
  ]) {
    it(`recognizes ${value}`, () => {
      assert.equal(containsTopicReference(value), true);
      assert.ok(findTopicReferences(value).length > 0);
    });
  }

  it("rejects ambiguous generic words", () => {
    assert.equal(containsTopicReference("future of work"), false);
    assert.equal(containsTopicReference("VinFast đang ra mắt xe mới"), false);
    assert.equal(containsTopicReference("VF đang tăng trưởng"), false);
  });
});
