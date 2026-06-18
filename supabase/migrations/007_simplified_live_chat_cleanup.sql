-- Destructive cleanup for simplified live-chat-only product.
-- Backup first if old trigger/transcript/webhook data is needed.

alter table public.live_chat_templates
add column if not exists round_robin_index integer not null default 0,
add column if not exists last_sent_bot_id text null,
add column if not exists last_sent_at timestamptz null;

drop table if exists public.trigger_rules cascade;
drop table if exists public.timer_trigger_rules cascade;
drop table if exists public.timer_triggers cascade;
drop table if exists public.transcript_logs cascade;
drop table if exists public.transcripts cascade;
drop table if exists public.webhook_logs cascade;
drop table if exists public.webhooks cascade;
drop table if exists public.matched_trigger_logs cascade;

notify pgrst, 'reload schema';
