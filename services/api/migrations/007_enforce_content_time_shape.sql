UPDATE posts
SET time_parse_status = 'parsed',
    updated_at = now()
WHERE time_parse_status = 'unknown'
  AND published_at IS NOT NULL;

UPDATE posts
SET time_parse_status = 'unknown',
    updated_at = now()
WHERE time_parse_status = 'parsed'
  AND published_at IS NULL;

UPDATE comments
SET time_parse_status = 'parsed',
    updated_at = now()
WHERE time_parse_status = 'unknown'
  AND published_at IS NOT NULL;

UPDATE comments
SET time_parse_status = 'unknown',
    updated_at = now()
WHERE time_parse_status = 'parsed'
  AND published_at IS NULL;

ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_time_shape_check;
ALTER TABLE posts
  ADD CONSTRAINT posts_time_shape_check CHECK (
    (time_parse_status = 'parsed' AND published_at IS NOT NULL)
    OR (time_parse_status = 'unknown' AND published_at IS NULL)
  );

ALTER TABLE comments
  DROP CONSTRAINT IF EXISTS comments_time_shape_check;
ALTER TABLE comments
  ADD CONSTRAINT comments_time_shape_check CHECK (
    (time_parse_status = 'parsed' AND published_at IS NOT NULL)
    OR (time_parse_status = 'unknown' AND published_at IS NULL)
  );
