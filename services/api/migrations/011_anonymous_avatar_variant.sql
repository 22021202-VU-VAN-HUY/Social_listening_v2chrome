-- A coarse, post-scoped color bucket lets the dashboard distinguish anonymous
-- participants without storing the Facebook alias, profile link, or author ID.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS anonymous_avatar_variant smallint;

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS anonymous_avatar_variant smallint;

ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_anonymous_avatar_variant_check;
ALTER TABLE posts
  ADD CONSTRAINT posts_anonymous_avatar_variant_check CHECK (
    anonymous_avatar_variant IS NULL
    OR (
      author_kind = 'anonymous'
      AND anonymous_avatar_variant BETWEEN 0 AND 7
    )
  );

ALTER TABLE comments
  DROP CONSTRAINT IF EXISTS comments_anonymous_avatar_variant_check;
ALTER TABLE comments
  ADD CONSTRAINT comments_anonymous_avatar_variant_check CHECK (
    anonymous_avatar_variant IS NULL
    OR (
      author_kind = 'anonymous'
      AND anonymous_avatar_variant BETWEEN 0 AND 7
    )
  );

COMMENT ON COLUMN posts.anonymous_avatar_variant IS
  'Post-scoped visual bucket 0..7. Not an author ID and not linkable across posts.';
COMMENT ON COLUMN comments.anonymous_avatar_variant IS
  'Post-scoped visual bucket 0..7. Not an author ID and not linkable across posts.';
