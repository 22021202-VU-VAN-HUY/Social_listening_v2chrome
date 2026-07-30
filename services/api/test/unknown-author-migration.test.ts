import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fresh and upgrade migrations require unknown author names to be null", async () => {
  const [initial, upgrade] = await Promise.all([
    readFile(new URL("../migrations/001_initial.sql", import.meta.url), "utf8"),
    readFile(
      new URL("../migrations/005_normalize_unknown_authors.sql", import.meta.url),
      "utf8",
    ),
  ]);

  for (const migration of [initial, upgrade]) {
    assert.match(
      migration,
      /author_kind = 'unknown' AND is_anonymous = false AND author_name IS NULL/gu,
    );
  }
  assert.match(
    upgrade,
    /UPDATE posts[\s\S]+WHERE author_kind = 'unknown'[\s\S]+author_name IS NOT NULL/u,
  );
  assert.match(
    upgrade,
    /UPDATE comments[\s\S]+WHERE author_kind = 'unknown'[\s\S]+author_name IS NOT NULL/u,
  );
});

test("time-shape migration normalizes and constrains parsed versus unknown", async () => {
  const migration = await readFile(
    new URL(
      "../migrations/007_enforce_content_time_shape.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    migration,
    /time_parse_status = 'unknown'[\s\S]+published_at IS NOT NULL/gu,
  );
  assert.match(
    migration,
    /time_parse_status = 'parsed'[\s\S]+published_at IS NULL/gu,
  );
  assert.match(migration, /posts_time_shape_check/u);
  assert.match(migration, /comments_time_shape_check/u);
});
