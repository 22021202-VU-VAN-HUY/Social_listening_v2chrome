ALTER TABLE keyword_hits
  ADD COLUMN IF NOT EXISTS matched_keyword_value text;
ALTER TABLE keyword_hits
  ADD COLUMN IF NOT EXISTS matched_match_mode text;

UPDATE keyword_hits AS hit
SET matched_keyword_value = keyword.value,
    matched_match_mode = keyword.match_mode
FROM keywords AS keyword
WHERE keyword.id = hit.keyword_id
  AND (
    hit.matched_keyword_value IS NULL
    OR hit.matched_match_mode IS NULL
  );

ALTER TABLE keyword_hits
  ALTER COLUMN matched_keyword_value SET NOT NULL;
ALTER TABLE keyword_hits
  ALTER COLUMN matched_match_mode SET NOT NULL;

ALTER TABLE keyword_hits
  DROP CONSTRAINT IF EXISTS keyword_hits_matched_keyword_value_check;
ALTER TABLE keyword_hits
  ADD CONSTRAINT keyword_hits_matched_keyword_value_check
  CHECK (length(matched_keyword_value) BETWEEN 1 AND 200);

ALTER TABLE keyword_hits
  DROP CONSTRAINT IF EXISTS keyword_hits_matched_match_mode_check;
ALTER TABLE keyword_hits
  ADD CONSTRAINT keyword_hits_matched_match_mode_check
  CHECK (matched_match_mode IN ('whole_word', 'contains_phrase'));
