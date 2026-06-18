create table if not exists public.live_chat_templates (
  id text primary key,
  session_id text not null,
  name text not null,
  message text not null,
  sender_mode text not null default 'selected_bots',
  bot_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_live_chat_templates_session_id
  on public.live_chat_templates (session_id);

create index if not exists idx_live_chat_templates_updated_at
  on public.live_chat_templates (updated_at desc);

alter table public.live_chat_templates enable row level security;

notify pgrst, 'reload schema';
