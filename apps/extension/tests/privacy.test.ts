import { describe, expect, it } from "vitest";
import {
  assertPrivacySafePayload,
  makeSafeAuthor,
  sanitizeAuthorName
} from "../src/shared/privacy";

describe("privacy payload boundary", () => {
  it("rejects forbidden identity keys at any depth and naming style", () => {
    for (const key of [
      "profileUrl",
      "profile_url",
      "username",
      "handle",
      "userId",
      "platformUserId",
      "author_id"
    ]) {
      expect(() =>
        assertPrivacySafePayload({ post: { author: { [key]: "secret" } } })
      ).toThrow(/Privacy-forbidden key/u);
    }
  });

  it("allows only the approved nested author DTO", () => {
    const real = makeSafeAuthor("Nguyễn An", false);
    const anonymous = makeSafeAuthor("Anonymous participant", true);
    expect(real).toEqual({
      authorName: "Nguyễn An",
      isAnonymous: false,
      authorKind: "real"
    });
    expect(anonymous).toEqual({
      authorName: null,
      isAnonymous: true,
      authorKind: "anonymous"
    });
    expect(() => assertPrivacySafePayload({ author: real })).not.toThrow();
    expect(() => assertPrivacySafePayload({ author: anonymous })).not.toThrow();
  });

  it("drops URL-like, handle-only and numeric platform identity values", () => {
    expect(sanitizeAuthorName("https://facebook.com/alice")).toBeNull();
    expect(sanitizeAuthorName("@alice.handle")).toBeNull();
    expect(sanitizeAuthorName("100099887766")).toBeNull();
  });
});
