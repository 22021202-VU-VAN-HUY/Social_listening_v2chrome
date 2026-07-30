-- Posts remain stored as immutable context for comments, but they are not
-- sentiment-analysis entities. Remove pending legacy work before enforcing
-- that invariant at the database boundary.
DELETE FROM sentiment_queue
WHERE entity_type = 'post';

ALTER TABLE sentiment_queue
  DROP CONSTRAINT IF EXISTS sentiment_queue_entity_type_check;

ALTER TABLE sentiment_queue
  ADD CONSTRAINT sentiment_queue_entity_type_check
  CHECK (entity_type = 'comment');

-- Comment-only listening cannot be configured into a post-only crawl.
UPDATE platform_settings
SET crawl_comments = true,
    updated_at = now()
WHERE crawl_comments = false;

ALTER TABLE platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_crawl_comments_check;

ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_crawl_comments_check
  CHECK (crawl_comments = true);
