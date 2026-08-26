alter table public.live_chat_templates
add column if not exists scheduled_send_enabled boolean not null default false,
add column if not exists scheduled_send_at timestamptz null,
add column if not exists scheduled_repeat_enabled boolean not null default false,
add column if not exists scheduled_repeat_weekdays jsonb not null default '[]'::jsonb,
add column if not exists scheduled_next_run_at timestamptz null,
add column if not exists scheduled_last_sent_at timestamptz null,
add column if not exists scheduled_status text not null default 'pending',
add column if not exists scheduled_error_message text null;

notify pgrst, 'reload schema';
