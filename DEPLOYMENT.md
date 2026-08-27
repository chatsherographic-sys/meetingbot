# Vercel Deployment Guide

This MVP supports both local JSON storage and Supabase through the storage
driver. For Vercel deployment, always use Supabase.

## Before Deploying

1. Push the latest code to GitHub.
2. Run a local production build check:

```powershell
npm.cmd run build
```

3. Create a Supabase project if needed.
4. Run the SQL migration:

```text
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_recall_bot_roles.sql
supabase/migrations/003_match_log_latency_diagnostics.sql
supabase/migrations/004_trigger_rule_aliases.sql
supabase/migrations/005_trigger_slot_alias_groups.sql
supabase/migrations/006_live_chat_templates.sql
supabase/migrations/007_simplified_live_chat_cleanup.sql
supabase/migrations/008_scheduled_bot_slots_and_live_chat_targets.sql
supabase/migrations/009_scheduled_bot_weekly_repeat.sql
supabase/migrations/010_scheduled_live_chat.sql
```

The migration keeps RLS enabled and adds the required `service_role` grants for
server-side storage access.

## Import Into Vercel

1. Open Vercel.
2. Import the GitHub repository as a new project.
3. Let Vercel detect Next.js automatically.
4. Add the required environment variables before the first production deploy.

## Required Vercel Environment Variables

```env
STORAGE_DRIVER=supabase
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
RECALL_API_KEY=
RECALL_REGION=us-west-2
RECALL_SEND_CHAT_ENABLED=false
PUBLIC_WEBHOOK_BASE_URL=https://your-vercel-domain.vercel.app
VERCEL_AUTOMATION_BYPASS_SECRET=
CRON_SECRET=use_a_random_secret_of_at_least_16_characters
OPENAI_API_KEY=
OPENAI_ALIAS_MODEL=gpt-5-nano
```

Important notes:

- Never use `STORAGE_DRIVER=local` on Vercel.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code.
- `NEXT_PUBLIC_SUPABASE_URL` is safe for the browser, but the service role key is not.
- `RECALL_API_KEY` must stay server-side only.
- `CRON_SECRET` must stay server-side only. Vercel sends it as a Bearer token when it invokes the scheduled-bot cron route.
- `OPENAI_API_KEY` is optional, must stay server-side only, and is used only for alias suggestions from `/triggers`.
- `OPENAI_ALIAS_MODEL` is optional and defaults to `gpt-5-nano`.
- Recommended production bot setup is one listener bot per meeting and extra sender-only bots only when needed.
- Listener bots include transcript config and webhook delivery.
- Sender bots join the meeting and can send chat, but they do not transcribe.
- After the first deployment, update `PUBLIC_WEBHOOK_BASE_URL` if the final Vercel URL changes.
- If Vercel Authentication stays enabled, set `VERCEL_AUTOMATION_BYPASS_SECRET` so Recall can reach the protected webhook endpoint.
- If the bypass secret changes, redeploy and create a new bot because existing bots keep the old webhook URL.
- Bot transcript language is currently locked to `Chinese (zh-CN)` for new manual and scheduled bot creation.
- OpenAI alias suggestion does not affect live Recall webhook performance because it is never used in `/api/recall/webhook`.

## Supabase Export And Verification

If you already have local JSON data that you want to move:

```powershell
npm run export-store-to-supabase
```

Then verify:

1. Set `STORAGE_DRIVER=supabase` locally.
2. Restart the dev server.
3. Open `/diagnostics`.
4. Confirm `Storage Health` is `ok`.
5. Create a meeting session or trigger rule and confirm the row appears in Supabase.

## Scheduled Bot Cron

`vercel.json` registers `GET /api/scheduled-bots/run-due` every minute. The route is protected by `CRON_SECRET`, which Vercel automatically sends in the `Authorization: Bearer` header for production cron invocations. Each run processes scheduled bot joins, due scheduled live chat templates, and due bot auto-leaves.

For local testing, set `CRON_SECRET` in `.env.local`, restart the dev server, then run:

```powershell
Invoke-RestMethod "http://localhost:3000/api/scheduled-bots/run-due?secret=$env:CRON_SECRET"
```

Vercel Cron runs only on production deployments. Vercel Hobby currently permits cron only once per day, which cannot meet meeting-time scheduling requirements; use Vercel Pro or another authenticated external scheduler for per-minute checks.

## After Deploy

Test these items in order:

1. Open `/diagnostics`.
2. Confirm:
   - `STORAGE_DRIVER` is `supabase`
   - `Storage Health` is `ok`
   - `PUBLIC_WEBHOOK_BASE_URL` shows the deployed Vercel URL
3. Create or open a meeting session.
4. Create a bot from `/bots`.
5. Confirm the created bot row appears in Supabase.
6. Confirm Recall webhook delivery reaches the Vercel URL.
7. Keep `RECALL_SEND_CHAT_ENABLED=false` at first and verify dry-run behavior before enabling real chat send.
