alter table public.scheduled_bot_joins
add column if not exists random_name_enabled boolean not null default false;

notify pgrst, 'reload schema';
