ALTER TABLE sentiment_queue
  ADD COLUMN IF NOT EXISTS conversation_context text;
