alter table public.scheduled_bot_joins
add column if not exists bot_slots jsonb not null default '[]'::jsonb;

alter table public.live_chat_templates
add column if not exists bot_targets jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
