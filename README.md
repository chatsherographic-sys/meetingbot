# Recall.ai Zoom Live Chat Sender MVP

This project is a Next.js MVP for running Zoom meeting bots and sending Zoom chat messages through Recall.ai.

The product direction is now simplified:

- create bots
- schedule bots to join later
- manage meeting sessions
- send Zoom chat through saved live chat templates

Transcript-trigger automation, ASR matching, and webhook-driven trigger pages are no longer part of the main product flow.

## Tech Stack

- Next.js App Router
- TypeScript
- local JSON or Supabase Postgres through a storage driver

## Main Features

- Meeting Sessions
- Recall bot creation and bot history
- bot status refresh
- stop one bot
- stop all active bots in the current session
- Scheduled Bot Joins
- Live Chat templates
- dry-run or real Recall `send_chat_message`

## Hidden / Disabled Legacy Features

These older pages are no longer part of the simplified live chat product:

- Triggers
- Timer Triggers
- Webhooks
- Transcripts
- Matched Triggers
- transcript/ASR diagnostics pages
- OpenAI alias suggestion UI

They are removed from navigation and disabled in the admin UI so they do not affect the normal workflow.

## Environment Variables

Create `.env.local` from `.env.example`.

```env
STORAGE_DRIVER=local
RECALL_API_KEY=your_recall_api_key
RECALL_REGION=us-west-2
RECALL_SEND_CHAT_ENABLED=false
PUBLIC_WEBHOOK_BASE_URL=http://localhost:3000
VERCEL_AUTOMATION_BYPASS_SECRET=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Notes:

- `STORAGE_DRIVER=local` uses `data/store.json`
- `STORAGE_DRIVER=supabase` uses Supabase Postgres through the server-side adapter
- `RECALL_API_KEY` stays server-side only
- `RECALL_REGION=us-west-2` matches your current setup
- `RECALL_SEND_CHAT_ENABLED=false` keeps chat sending in dry-run mode
- `PUBLIC_WEBHOOK_BASE_URL` should be the real app URL after deployment
- `VERCEL_AUTOMATION_BYPASS_SECRET` is optional and used only when Vercel Authentication is enabled
- `SUPABASE_SERVICE_ROLE_KEY` stays server-side only

## Pages

`/dashboard`

- simple summary for the current session
- active bots
- scheduled joins
- live chat templates
- live chat logs
- stop all active bots

`/sessions`

- create session
- edit session
- start session
- end session
- archive session
- delete session when safe

`/bots`

- create one bot or many bots for the current sidebar session
- read-only current session name, status, and Zoom URL
- bulk creation with custom names
- automatic listener/sender role assignment
- refresh bot status
- stop bot
- stop all active bots in the current session
- active bots tab
- bot history tab

`/scheduled-bots`

- create scheduled bot joins for the current sidebar session
- edit schedule
- enable / disable
- cancel
- delete
- auto-run due schedules while the page is open in local MVP

`/live-chat`

- create live chat templates
- edit live chat templates
- delete live chat templates
- send saved template messages through bots
- view live chat logs
- delete one live chat log
- clear all live chat logs for the current session

`/settings`

- Recall environment preview
- Supabase connection status
- current session summary
- bot history cleanup
- emergency stop all active bots across all sessions

## Meeting Sessions

The sidebar `Current Session` selector is the single source of truth.

Feature pages follow the current sidebar session:

- `/dashboard`
- `/bots`
- `/scheduled-bots`
- `/live-chat`

Session behavior:

- Zoom URL belongs to the session
- `/bots` creates bots using the current session Zoom URL automatically
- `/scheduled-bots` creates schedules under the current session
- if the current session has no Zoom URL, bot creation and scheduling are blocked
- if the current session is ended or archived, bot creation, scheduled joins, and live chat are blocked

## Bot Roles

Each session normally uses one listener bot.

Behavior:

- if a session has no active listener, the first newly created bot becomes `listener`
- extra bots become `sender`
- if a listener is already active in that session, new bots default to `sender`
- scheduled joins follow the same server-side rule at run time

This reduces duplicated transcription load when multiple bots join the same Zoom meeting.

## Live Chat Templates

Live Chat is now template-based.

Each template stores:

- template name
- message
- sender mode
- selected bot IDs when needed
- created time
- updated time

Sender modes:

- `selected_bots`
  - send only through the bots saved on the template
- `round_robin`
  - send through one eligible bot per click and rotate each time
  - if selected bot IDs exist, rotation uses only those active bots
  - if no selected bot IDs exist, rotation uses all active bots in the current session
- `all_bots`
  - send once through every active bot in the current session

Template send behavior:

- uses the saved template message
- uses the saved sender mode
- uses the saved selected bots when sender mode is `selected_bots`
- updates `roundRobinIndex`, `lastSentBotId`, and `lastSentAt` when sender mode is `round_robin`
- writes a live chat log with success or failure details

Live chat logs remain historical records and are not editable.

## Scheduled Bot Joins

Scheduled Bot Join lets bots auto-create and join later using the current session Zoom URL.

Behavior:

- schedules are saved under the current sidebar session
- schedules are blocked if the current session has no Zoom URL
- due schedules run sequentially
- schedule status moves through `pending`, `running`, `completed`, `failed`, or `cancelled`
- local MVP auto-runs due schedules only while `/scheduled-bots` stays open
- production should later use cron or a background worker

## Recall Send Chat Modes

### Dry-run mode

When `RECALL_SEND_CHAT_ENABLED=false`:

- the app does not call Recall `send_chat_message`
- live chat logs still show what would have been sent

### Real send mode

When `RECALL_SEND_CHAT_ENABLED=true`:

- the server calls Recall `send_chat_message`
- the Recall API key stays server-side only

## Webhook Notes

The app still keeps `/api/recall/webhook` available so existing Recall bot configs do not fail.

However, in the simplified live chat version:

- transcript webhooks are no longer used for trigger matching
- transcript-trigger automation is not part of the main app flow
- transcript, webhook, and matched-trigger pages are disabled in the UI

## Supabase Storage

Phase 1 storage driver support remains available.

Supported drivers:

- `local`
- `supabase`

Main storage files:

- [lib/storage/index.ts](/C:/Users/Danny/OneDrive/Documents/Recall%20Zoom%20Bot%20Control%20Panel/lib/storage/index.ts)
- [lib/storage/local-store.ts](/C:/Users/Danny/OneDrive/Documents/Recall%20Zoom%20Bot%20Control%20Panel/lib/storage/local-store.ts)
- [lib/storage/supabase-store.ts](/C:/Users/Danny/OneDrive/Documents/Recall%20Zoom%20Bot%20Control%20Panel/lib/storage/supabase-store.ts)

Initial schema:

- [supabase/migrations/001_initial_schema.sql](/C:/Users/Danny/OneDrive/Documents/Recall%20Zoom%20Bot%20Control%20Panel/supabase/migrations/001_initial_schema.sql)

Live chat template migration:

- [supabase/migrations/006_live_chat_templates.sql](/C:/Users/Danny/OneDrive/Documents/Recall%20Zoom%20Bot%20Control%20Panel/supabase/migrations/006_live_chat_templates.sql)
- [supabase/migrations/007_simplified_live_chat_cleanup.sql](/C:/Users/Danny/OneDrive/Documents/Recall%20Zoom%20Bot%20Control%20Panel/supabase/migrations/007_simplified_live_chat_cleanup.sql)

If you use Supabase, run these migrations before switching the driver.

## Local Setup

Install dependencies:

```powershell
npm.cmd install
```

Start the app:

```powershell
npm.cmd run dev
```

Open:

```text
http://localhost:3000/dashboard
```

## How To Test The New Live Chat Flow

1. Create a session on `/sessions`.
2. Add a Zoom URL to that session.
3. Switch the sidebar Current Session to that session.
4. Open `/bots` and create one or more bots.
5. Wait for the bot status to refresh.
6. Open `/live-chat`.
7. Create a template with:
   - template name
   - message
   - sender mode
   - selected bots if using `selected_bots`
   - optional selected bot pool if using `round_robin`
8. Click `Send` on the template.
9. Check the live chat logs on the same page.

Round robin test:

- create a template in `round_robin` mode
- select two or more active bots, or leave the bot list empty to use all active bots
- click `Send` multiple times
- confirm only one bot sends per click
- confirm the sender rotates and the template updates `Last sent bot` and `Last sent at`

Dry-run test:

- keep `RECALL_SEND_CHAT_ENABLED=false`
- send a template
- confirm the live chat log records `dry_run`

Real send test:

- set `RECALL_SEND_CHAT_ENABLED=true`
- restart the app
- send a template
- confirm Zoom chat is sent through the chosen bot or bots

## Migration Needed

If you use Supabase for this simplified live chat version, run:

1. [supabase/migrations/001_initial_schema.sql](/C:/Users/Danny/OneDrive/Documents/Recall%20Zoom%20Bot%20Control%20Panel/supabase/migrations/001_initial_schema.sql)
2. [supabase/migrations/006_live_chat_templates.sql](/C:/Users/Danny/OneDrive/Documents/Recall%20Zoom%20Bot%20Control%20Panel/supabase/migrations/006_live_chat_templates.sql)
3. [supabase/migrations/007_simplified_live_chat_cleanup.sql](/C:/Users/Danny/OneDrive/Documents/Recall%20Zoom%20Bot%20Control%20Panel/supabase/migrations/007_simplified_live_chat_cleanup.sql)

- `006` adds the `live_chat_templates` table
- `007` adds round-robin template fields and drops old trigger/transcript/webhook tables for the simplified product

## Notes

- bot creation and scheduled bot joins are still supported
- bot stop and status refresh are still supported
- live chat sending still respects dry-run vs real send mode
- OpenAI is not used anywhere in the simplified live chat flow
