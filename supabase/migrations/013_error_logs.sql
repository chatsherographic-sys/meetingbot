create table if not exists public.error_logs (
  id text primary key,
  session_id text null,
  source text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_error_logs_session_id on public.error_logs (session_id);
create index if not exists idx_error_logs_created_at on public.error_logs (created_at desc);

alter table public.error_logs enable row level security;

grant select, insert, update, delete on public.error_logs to service_role;

notify pgrst, 'reload schema';
