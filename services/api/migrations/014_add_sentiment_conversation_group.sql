ALTER TABLE sentiment_queue
  ADD COLUMN IF NOT EXISTS conversation_group_id uuid;

CREATE INDEX IF NOT EXISTS sentiment_queue_conversation_group_idx
  ON sentiment_queue (conversation_group_id, created_at);
