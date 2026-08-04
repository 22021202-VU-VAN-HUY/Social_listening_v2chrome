CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  retention_days integer NOT NULL DEFAULT 180 CHECK (retention_days BETWEEN 1 AND 3650),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS extension_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extension_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  extension_version text NOT NULL,
  runtime_status text NOT NULL DEFAULT 'online'
    CHECK (runtime_status IN ('online', 'running', 'needs_login', 'offline')),
  current_job_id uuid,
  last_seen_at timestamptz,
  paired_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, installation_id)
);

CREATE TABLE IF NOT EXISTS platform_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'tiktok', 'threads')),
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connected', 'error', 'disabled')),
  credential_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform)
);

CREATE TABLE IF NOT EXISTS platform_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'tiktok', 'threads')),
  lookback_preset text NOT NULL DEFAULT '7_days'
    CHECK (lookback_preset IN ('today', '3_days', '7_days', '30_days')),
  crawl_comments boolean NOT NULL DEFAULT true CHECK (crawl_comments = true),
  max_sources_per_job integer NOT NULL DEFAULT 50 CHECK (max_sources_per_job BETWEEN 1 AND 50),
  max_posts_per_source integer NOT NULL DEFAULT 300 CHECK (max_posts_per_source BETWEEN 1 AND 300),
  max_comments_per_post integer NOT NULL DEFAULT 500 CHECK (max_comments_per_post BETWEEN 1 AND 500),
  max_runtime_minutes integer NOT NULL DEFAULT 120 CHECK (max_runtime_minutes BETWEEN 1 AND 120),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, platform)
);

CREATE TABLE IF NOT EXISTS keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'tiktok', 'threads')),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 200),
  normalized_value text NOT NULL CHECK (length(normalized_value) BETWEEN 1 AND 200),
  match_mode text NOT NULL CHECK (match_mode IN ('whole_word', 'contains_phrase')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, normalized_value)
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'tiktok', 'threads')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 500),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 500),
  canonical_url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_discovered_at timestamptz,
  last_crawl_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, external_id),
  UNIQUE (workspace_id, platform, canonical_url)
);

CREATE TABLE IF NOT EXISTS source_selections (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  selected boolean NOT NULL DEFAULT false,
  selected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source_id)
);

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  extension_device_id uuid REFERENCES extension_devices(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (
    type IN (
      'discover_sources',
      'crawl_content',
      'analyze_sentiment',
      'rebuild_aggregates',
      'delete_expired_data'
    )
  ),
  platform text NOT NULL CHECK (platform IN ('facebook', 'tiktok', 'threads')),
  status text NOT NULL CHECK (
    status IN (
      'queued',
      'waiting_extension',
      'running',
      'processing_ai',
      'interrupted',
      'needs_login',
      'partial',
      'cancelled',
      'failed',
      'completed'
    )
  ),
  settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{"stage":"queued"}'::jsonb,
  cancel_requested boolean NOT NULL DEFAULT false,
  crawl_outcome text CHECK (crawl_outcome IN ('crawl_complete', 'partial')),
  error_code text,
  error_message text,
  event_sequence bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE extension_devices
  DROP CONSTRAINT IF EXISTS extension_devices_current_job_id_fkey;
ALTER TABLE extension_devices
  ADD CONSTRAINT extension_devices_current_job_id_fkey
  FOREIGN KEY (current_job_id) REFERENCES crawl_jobs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS crawl_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  source_id uuid REFERENCES sources(id) ON DELETE CASCADE,
  keyword_id uuid REFERENCES keywords(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'running', 'completed', 'skipped', 'failed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, source_id, keyword_id)
);

CREATE TABLE IF NOT EXISTS crawl_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  level text NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  type text NOT NULL CHECK (length(type) BETWEEN 1 AND 100),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, sequence)
);

CREATE TABLE IF NOT EXISTS crawler_slots (
  extension_device_id uuid NOT NULL REFERENCES extension_devices(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'tiktok', 'threads')),
  job_id uuid NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  lease_token_hash text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  lease_expires_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (extension_device_id, platform)
);

CREATE TABLE IF NOT EXISTS ingest_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('sources', 'content')),
  state text NOT NULL DEFAULT 'processing'
    CHECK (state IN ('processing', 'completed', 'failed')),
  received_count integer NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (job_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  first_seen_job_id uuid REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  last_seen_job_id uuid REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('facebook', 'tiktok', 'threads')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 500),
  canonical_url text NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 200000),
  published_at timestamptz,
  collected_at timestamptz NOT NULL,
  time_parse_status text NOT NULL CHECK (time_parse_status IN ('parsed', 'unknown')),
  author_name text CHECK (author_name IS NULL OR length(author_name) BETWEEN 1 AND 200),
  is_anonymous boolean NOT NULL DEFAULT false,
  author_kind text NOT NULL CHECK (author_kind IN ('real', 'anonymous', 'unknown')),
  anonymous_avatar_variant smallint CHECK (
    anonymous_avatar_variant IS NULL OR anonymous_avatar_variant BETWEEN 0 AND 7
  ),
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posts_author_shape_check CHECK (
    (author_kind = 'anonymous' AND is_anonymous = true AND author_name IS NULL)
    OR (author_kind = 'real' AND is_anonymous = false AND author_name IS NOT NULL AND anonymous_avatar_variant IS NULL)
    OR (author_kind = 'unknown' AND is_anonymous = false AND author_name IS NULL AND anonymous_avatar_variant IS NULL)
  ),
  CONSTRAINT posts_time_shape_check CHECK (
    (time_parse_status = 'parsed' AND published_at IS NOT NULL)
    OR (time_parse_status = 'unknown' AND published_at IS NULL)
  ),
  UNIQUE (workspace_id, platform, external_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  first_seen_job_id uuid REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  last_seen_job_id uuid REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('facebook', 'tiktok', 'threads')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 500),
  canonical_url text,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 200000),
  published_at timestamptz,
  collected_at timestamptz NOT NULL,
  time_parse_status text NOT NULL CHECK (time_parse_status IN ('parsed', 'unknown')),
  author_name text CHECK (author_name IS NULL OR length(author_name) BETWEEN 1 AND 200),
  is_anonymous boolean NOT NULL DEFAULT false,
  author_kind text NOT NULL CHECK (author_kind IN ('real', 'anonymous', 'unknown')),
  anonymous_avatar_variant smallint CHECK (
    anonymous_avatar_variant IS NULL OR anonymous_avatar_variant BETWEEN 0 AND 7
  ),
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_author_shape_check CHECK (
    (author_kind = 'anonymous' AND is_anonymous = true AND author_name IS NULL)
    OR (author_kind = 'real' AND is_anonymous = false AND author_name IS NOT NULL AND anonymous_avatar_variant IS NULL)
    OR (author_kind = 'unknown' AND is_anonymous = false AND author_name IS NULL AND anonymous_avatar_variant IS NULL)
  ),
  CONSTRAINT comments_time_shape_check CHECK (
    (time_parse_status = 'parsed' AND published_at IS NOT NULL)
    OR (time_parse_status = 'unknown' AND published_at IS NULL)
  ),
  UNIQUE (workspace_id, platform, external_id)
);

COMMENT ON COLUMN posts.author_name IS
  'Display name only. Never store a platform author ID, profile URL, username, or handle.';
COMMENT ON COLUMN comments.author_name IS
  'Display name only. Never store a platform author ID, profile URL, username, or handle.';

CREATE TABLE IF NOT EXISTS keyword_hits (
  keyword_id uuid NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('post', 'comment')),
  entity_id uuid NOT NULL,
  matched_keyword_value text NOT NULL
    CHECK (length(matched_keyword_value) BETWEEN 1 AND 200),
  matched_match_mode text NOT NULL
    CHECK (matched_match_mode IN ('whole_word', 'contains_phrase')),
  match_excerpt text NOT NULL CHECK (length(match_excerpt) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (keyword_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sentiment_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id uuid REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  entity_type text NOT NULL CHECK (entity_type = 'comment'),
  entity_id uuid NOT NULL,
  text text NOT NULL,
  post_context text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'retry_wait', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sentiment_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type = 'comment'),
  entity_id uuid NOT NULL,
  analysis_input_hash text NOT NULL,
  is_relevant boolean NOT NULL,
  label text NOT NULL CHECK (label IN ('positive', 'negative', 'neutral')),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reason text NOT NULL,
  language text NOT NULL DEFAULT 'vi',
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    entity_type,
    entity_id,
    analysis_input_hash,
    provider,
    model,
    prompt_version,
    schema_version
  )
);

CREATE OR REPLACE VIEW sentiment_results AS
SELECT *
FROM sentiment_analyses;

CREATE TABLE IF NOT EXISTS sentiment_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type = 'comment'),
  entity_id uuid NOT NULL,
  label text NOT NULL CHECK (label IN ('positive', 'negative', 'neutral')),
  reason text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'extension', 'system')),
  actor_id uuid,
  action text NOT NULL,
  safe_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extension_devices_workspace_seen_idx
  ON extension_devices (workspace_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS sources_workspace_platform_name_idx
  ON sources (workspace_id, platform, name);
CREATE INDEX IF NOT EXISTS crawl_jobs_workspace_status_created_idx
  ON crawl_jobs (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS crawl_events_job_sequence_idx
  ON crawl_events (job_id, sequence);
CREATE INDEX IF NOT EXISTS crawl_tasks_job_state_idx
  ON crawl_tasks (job_id, state);
CREATE INDEX IF NOT EXISTS posts_platform_published_idx
  ON posts (platform, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_workspace_collected_idx
  ON posts (workspace_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS comments_post_published_idx
  ON comments (post_id, published_at);
CREATE INDEX IF NOT EXISTS comments_workspace_collected_idx
  ON comments (workspace_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS keyword_hits_lookup_idx
  ON keyword_hits (keyword_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS sentiment_queue_claim_idx
  ON sentiment_queue (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS sentiment_analyses_label_analyzed_idx
  ON sentiment_analyses (label, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS sentiment_analyses_entity_idx
  ON sentiment_analyses (entity_type, entity_id, analyzed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_facebook_job_per_device_idx
  ON crawl_jobs (extension_device_id)
  WHERE platform = 'facebook'
    AND status IN ('queued', 'waiting_extension', 'running', 'processing_ai', 'interrupted');
