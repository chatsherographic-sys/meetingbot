alter table public.matched_trigger_logs
add column if not exists latency_diagnostics jsonb null;
