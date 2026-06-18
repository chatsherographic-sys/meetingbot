alter table public.recall_bots
add column if not exists role text not null default 'listener';
