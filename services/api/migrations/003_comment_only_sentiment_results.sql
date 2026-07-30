-- Enforce comment-only analysis at every durable database boundary. Posts
-- remain available exclusively as parent context for comments and replies.
DELETE FROM sentiment_overrides
WHERE entity_type = 'post';

DELETE FROM sentiment_analyses
WHERE entity_type = 'post';

ALTER TABLE sentiment_analyses
  DROP CONSTRAINT IF EXISTS sentiment_analyses_entity_type_check;

ALTER TABLE sentiment_analyses
  ADD CONSTRAINT sentiment_analyses_entity_type_check
  CHECK (entity_type = 'comment');

ALTER TABLE sentiment_overrides
  DROP CONSTRAINT IF EXISTS sentiment_overrides_entity_type_check;

ALTER TABLE sentiment_overrides
  ADD CONSTRAINT sentiment_overrides_entity_type_check
  CHECK (entity_type = 'comment');
