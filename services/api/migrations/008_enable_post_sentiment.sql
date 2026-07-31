-- Posts and comments are both first-class listening entities. They remain
-- pending until the user manually requests AI analysis.
ALTER TABLE sentiment_queue
  DROP CONSTRAINT IF EXISTS sentiment_queue_entity_type_check;

ALTER TABLE sentiment_queue
  ADD CONSTRAINT sentiment_queue_entity_type_check
  CHECK (entity_type IN ('post', 'comment'));

ALTER TABLE sentiment_analyses
  DROP CONSTRAINT IF EXISTS sentiment_analyses_entity_type_check;

ALTER TABLE sentiment_analyses
  ADD CONSTRAINT sentiment_analyses_entity_type_check
  CHECK (entity_type IN ('post', 'comment'));

ALTER TABLE sentiment_overrides
  DROP CONSTRAINT IF EXISTS sentiment_overrides_entity_type_check;

ALTER TABLE sentiment_overrides
  ADD CONSTRAINT sentiment_overrides_entity_type_check
  CHECK (entity_type IN ('post', 'comment'));
