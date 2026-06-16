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
```

Important notes:

- Never use `STORAGE_DRIVER=local` on Vercel.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code.
- `NEXT_PUBLIC_SUPABASE_URL` is safe for the browser, but the service role key is not.
- `RECALL_API_KEY` must stay server-side only.
- After the first deployment, update `PUBLIC_WEBHOOK_BASE_URL` if the final Vercel URL changes.
- If Vercel Authentication stays enabled, set `VERCEL_AUTOMATION_BYPASS_SECRET` so Recall can reach the protected webhook endpoint.
- If the bypass secret changes, redeploy and create a new bot because existing bots keep the old webhook URL.

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

## Production Notes For Scheduled Jobs

Current local MVP behavior:

- `/scheduled-bots` auto-runs due schedules every 10 seconds only while that page is open.
- `/timer-triggers` auto-runs due timers every 10 seconds only while that page is open.

This is okay for local MVP testing, but it is not a production scheduler.

For production later:

- use Vercel Cron or another background worker
- call the existing endpoints
  - `POST /api/scheduled-bots/run-due`
  - `POST /api/timer-triggers/run-due`

Do not add cron until you are ready to manage production scheduling deliberately.

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
