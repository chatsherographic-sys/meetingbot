create table if not exists public.settings (
  id text primary key,
  storage_logging_mode text not null default 'production_minimal',
  live_chat_round_robin_index integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_sessions (
  id text primary key,
  name text not null,
  zoom_url text not null default '',
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  started_at timestamptz null,
  ended_at timestamptz null,
  notes text not null default ''
);

create table if not exists public.recall_bots (
  id text primary key,
  session_id text not null,
  recall_bot_id text not null,
  meeting_url text not null,
  bot_name text not null,
  role text not null default 'listener',
  transcript_language text not null,
  webhook_url text not null,
  status text not null,
  created_at timestamptz not null,
  joined_at timestamptz null,
  last_status_checked_at timestamptz null,
  last_error_message text null,
  last_stop_attempt jsonb null,
  create_request_payload jsonb not null default '{}'::jsonb,
  raw_recall_response jsonb not null default '{}'::jsonb
);

alter table public.recall_bots
add column if not exists role text not null default 'listener';

create table if not exists public.scheduled_bot_joins (
  id text primary key,
  session_id text not null,
  name text not null,
  enabled boolean not null default true,
  scheduled_at timestamptz not null,
  bot_count integer not null,
  bot_names jsonb not null default '[]'::jsonb,
  transcript_language text not null,
  status text not null,
  created_bot_ids jsonb not null default '[]'::jsonb,
  last_run_at timestamptz null,
  error_message text null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.trigger_rules (
  id text primary key,
  session_id text not null,
  trigger_phrase text not null,
  normalized_trigger text not null,
  aliases jsonb not null default '[]'::jsonb,
  normalized_aliases jsonb not null default '[]'::jsonb,
  slot_alias_groups jsonb not null default '[]'::jsonb,
  reply_message text not null,
  cooldown_seconds integer not null default 0,
  response_delay_seconds integer not null default 0,
  sender_mode text not null,
  sender_bot_ids jsonb not null default '[]'::jsonb,
  next_sender_index integer not null default 0,
  trigger_count integer not null default 0,
  max_trigger_count integer null,
  enabled boolean not null default true,
  last_matched_at timestamptz null,
  last_triggered_at timestamptz null,
  created_at timestamptz not null
);

create table if not exists public.timer_triggers (
  id text primary key,
  session_id text not null,
  name text not null,
  enabled boolean not null default true,
  delay_minutes_after_join integer not null,
  message text not null,
  sender_mode text not null,
  sender_bot_ids jsonb not null default '[]'::jsonb,
  next_sender_index integer not null default 0,
  response_delay_seconds integer not null default 0,
  max_trigger_count integer null,
  trigger_count integer not null default 0,
  last_triggered_at timestamptz null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.matched_trigger_logs (
  id text primary key,
  session_id text not null,
  bot_id text null,
  trigger_execution_id text null,
  source_event text not null,
  source_webhook_bot_id text null,
  match_type text not null default 'exact_trigger',
  rule_id text not null,
  trigger_phrase text not null,
  reply_message text not null,
  transcript_text text not null,
  normalized_transcript_text text not null,
  created_at timestamptz not null,
  status text not null,
  sender_mode text not null,
  sender_bot_ids_used jsonb not null default '[]'::jsonb,
  original_sender_bot_ids jsonb not null default '[]'::jsonb,
  deduped_sender_bot_ids jsonb not null default '[]'::jsonb,
  chosen_round_robin_bot_id text null,
  chosen_round_robin_bot_name text null,
  previous_round_robin_index integer null,
  next_round_robin_index integer null,
  response_delay_seconds integer not null default 0,
  trigger_count_after integer null,
  max_trigger_count integer null,
  auto_disabled_after_trigger boolean not null default false,
  send_attempt_count integer not null default 0,
  actual_send_count integer not null default 0,
  warning_messages jsonb not null default '[]'::jsonb,
  sender_results jsonb not null default '[]'::jsonb,
  latency_diagnostics jsonb null,
  error_message text null,
  action text not null
);

create table if not exists public.timer_trigger_logs (
  id text primary key,
  session_id text not null,
  timer_trigger_id text not null,
  timer_trigger_name text not null,
  scheduled_for timestamptz not null,
  executed_at timestamptz not null,
  message text not null,
  sender_mode text not null,
  sender_bot_id_used text null,
  sender_bot_ids_used jsonb not null default '[]'::jsonb,
  status text not null,
  error_message text null
);

create table if not exists public.live_chat_logs (
  id text primary key,
  session_id text not null,
  message text not null,
  sender_mode text not null,
  sender_bot_ids_used jsonb not null default '[]'::jsonb,
  sender_results jsonb not null default '[]'::jsonb,
  status text not null,
  created_at timestamptz not null,
  error_message text null
);

create table if not exists public.webhook_debug_logs (
  id text primary key,
  session_id text not null,
  event_name text not null,
  raw_payload jsonb null,
  received_at timestamptz not null,
  bot_id text null,
  status text not null,
  extracted_transcript_text text null,
  error_message text null
);

create table if not exists public.transcript_logs (
  id text primary key,
  session_id text not null,
  bot_id text null,
  transcript_text text not null,
  normalized_transcript_text text not null,
  matched_rule_ids jsonb not null default '[]'::jsonb,
  source_event text not null,
  created_at timestamptz not null
);

create index if not exists idx_recall_bots_session_id on public.recall_bots (session_id);
create index if not exists idx_recall_bots_status on public.recall_bots (status);
create index if not exists idx_recall_bots_recall_bot_id on public.recall_bots (recall_bot_id);
create index if not exists idx_recall_bots_created_at on public.recall_bots (created_at desc);

create index if not exists idx_meeting_sessions_status on public.meeting_sessions (status);
create index if not exists idx_scheduled_bot_joins_session_id on public.scheduled_bot_joins (session_id);
create index if not exists idx_scheduled_bot_joins_status on public.scheduled_bot_joins (status);
create index if not exists idx_scheduled_bot_joins_scheduled_at on public.scheduled_bot_joins (scheduled_at);
create index if not exists idx_trigger_rules_session_id on public.trigger_rules (session_id);
create index if not exists idx_trigger_rules_enabled on public.trigger_rules (enabled);
create index if not exists idx_timer_triggers_session_id on public.timer_triggers (session_id);
create index if not exists idx_timer_triggers_enabled on public.timer_triggers (enabled);

create index if not exists idx_matched_trigger_logs_session_id on public.matched_trigger_logs (session_id);
create index if not exists idx_matched_trigger_logs_created_at on public.matched_trigger_logs (created_at desc);
create index if not exists idx_matched_trigger_logs_status on public.matched_trigger_logs (status);

create index if not exists idx_timer_trigger_logs_session_id on public.timer_trigger_logs (session_id);
create index if not exists idx_timer_trigger_logs_executed_at on public.timer_trigger_logs (executed_at desc);
create index if not exists idx_timer_trigger_logs_status on public.timer_trigger_logs (status);

create index if not exists idx_live_chat_logs_session_id on public.live_chat_logs (session_id);
create index if not exists idx_live_chat_logs_created_at on public.live_chat_logs (created_at desc);
create index if not exists idx_live_chat_logs_status on public.live_chat_logs (status);

create index if not exists idx_webhook_debug_logs_session_id on public.webhook_debug_logs (session_id);
create index if not exists idx_webhook_debug_logs_received_at on public.webhook_debug_logs (received_at desc);
create index if not exists idx_webhook_debug_logs_status on public.webhook_debug_logs (status);
create index if not exists idx_webhook_debug_logs_bot_id on public.webhook_debug_logs (bot_id);

create index if not exists idx_transcript_logs_session_id on public.transcript_logs (session_id);
create index if not exists idx_transcript_logs_created_at on public.transcript_logs (created_at desc);
create index if not exists idx_transcript_logs_bot_id on public.transcript_logs (bot_id);

alter table public.settings enable row level security;
alter table public.meeting_sessions enable row level security;
alter table public.recall_bots enable row level security;
alter table public.scheduled_bot_joins enable row level security;
alter table public.trigger_rules enable row level security;
alter table public.timer_triggers enable row level security;
alter table public.matched_trigger_logs enable row level security;
alter table public.timer_trigger_logs enable row level security;
alter table public.live_chat_logs enable row level security;
alter table public.webhook_debug_logs enable row level security;
alter table public.transcript_logs enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
grant usage, select on sequences to service_role;
