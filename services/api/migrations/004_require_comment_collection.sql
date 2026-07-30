-- A crawl cannot be configured to collect zero comments in a comment-only
-- listening product.
UPDATE platform_settings
SET max_comments_per_post = 1,
    updated_at = now()
WHERE max_comments_per_post < 1;

ALTER TABLE platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_max_comments_per_post_check;

ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_max_comments_per_post_check
  CHECK (max_comments_per_post BETWEEN 1 AND 500);
