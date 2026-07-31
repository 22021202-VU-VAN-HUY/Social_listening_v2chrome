-- Preserve the order in which Facebook rendered each comment/reply. This is
-- presentation metadata only and contains no profile identifier.
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS observed_order integer;

ALTER TABLE comments
  DROP CONSTRAINT IF EXISTS comments_observed_order_check;

ALTER TABLE comments
  ADD CONSTRAINT comments_observed_order_check
  CHECK (observed_order IS NULL OR observed_order >= 0);
