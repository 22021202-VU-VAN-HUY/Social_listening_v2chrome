DROP INDEX IF EXISTS one_active_threads_job_per_workspace_idx;

UPDATE platform_settings
SET enabled = true,
    updated_at = now()
WHERE platform = 'threads';

CREATE UNIQUE INDEX one_active_threads_job_per_workspace_idx
  ON crawl_jobs (workspace_id)
  WHERE platform = 'threads'
    AND status IN (
      'queued',
      'waiting_extension',
      'running',
      'interrupted',
      'needs_login'
    );
