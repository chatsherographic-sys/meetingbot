-- Weekly recurrence support for Scheduled Bot Joins.
alter table public.scheduled_bot_joins
add column if not exists repeat_enabled boolean not null default false,
add column if not exists repeat_weekdays jsonb not null default '[]'::jsonb,
add column if not exists next_run_at timestamptz null,
add column if not exists last_run_at timestamptz null;

notify pgrst, 'reload schema';
