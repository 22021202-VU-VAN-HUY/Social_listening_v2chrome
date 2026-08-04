CREATE UNIQUE INDEX IF NOT EXISTS one_active_threads_job_per_workspace_idx
  ON crawl_jobs (workspace_id)
  WHERE platform = 'threads'
    AND status IN ('queued', 'running', 'interrupted');
