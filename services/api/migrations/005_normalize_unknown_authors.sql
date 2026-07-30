UPDATE posts
SET author_name = NULL,
    updated_at = now()
WHERE author_kind = 'unknown'
  AND author_name IS NOT NULL;

UPDATE comments
SET author_name = NULL,
    updated_at = now()
WHERE author_kind = 'unknown'
  AND author_name IS NOT NULL;

ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_check;
ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_author_shape_check;
ALTER TABLE posts
  ADD CONSTRAINT posts_author_shape_check CHECK (
    (author_kind = 'anonymous' AND is_anonymous = true AND author_name IS NULL)
    OR (author_kind = 'real' AND is_anonymous = false AND author_name IS NOT NULL)
    OR (author_kind = 'unknown' AND is_anonymous = false AND author_name IS NULL)
  );

ALTER TABLE comments
  DROP CONSTRAINT IF EXISTS comments_check;
ALTER TABLE comments
  DROP CONSTRAINT IF EXISTS comments_author_shape_check;
ALTER TABLE comments
  ADD CONSTRAINT comments_author_shape_check CHECK (
    (author_kind = 'anonymous' AND is_anonymous = true AND author_name IS NULL)
    OR (author_kind = 'real' AND is_anonymous = false AND author_name IS NOT NULL)
    OR (author_kind = 'unknown' AND is_anonymous = false AND author_name IS NULL)
  );
