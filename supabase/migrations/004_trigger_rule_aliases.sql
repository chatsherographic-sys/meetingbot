alter table public.trigger_rules
add column if not exists aliases jsonb not null default '[]'::jsonb;

alter table public.trigger_rules
add column if not exists normalized_aliases jsonb not null default '[]'::jsonb;
