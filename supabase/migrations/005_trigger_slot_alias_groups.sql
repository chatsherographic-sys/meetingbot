alter table public.trigger_rules
add column if not exists slot_alias_groups jsonb not null default '[]'::jsonb;

alter table public.matched_trigger_logs
add column if not exists match_type text not null default 'exact_trigger';

notify pgrst, 'reload schema';
