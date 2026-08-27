-- Automatic Recall bot leave scheduling for the simplified live-chat product.
-- The existing bot table is named recall_bots.
alter table public.recall_bots
add column if not exists leave_at timestamptz null,
add column if not exists left_at timestamptz null,
add column if not exists auto_leave_status text not null default 'pending',
add column if not exists auto_leave_error_message text null;

alter table public.scheduled_bot_joins
add column if not exists leave_time text null;

create index if not exists idx_recall_bots_leave_at
on public.recall_bots (leave_at)
where leave_at is not null;

notify pgrst, 'reload schema';
