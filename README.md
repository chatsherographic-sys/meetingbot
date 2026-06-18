# Recall.ai Zoom Bot Control Panel MVP

This project is a local Next.js MVP for:

- grouping activity by meeting session
- creating Recall Zoom bots
- receiving transcript webhooks
- matching word and phrase triggers
- sending Zoom chat replies in dry-run or real mode
- running timer-based chat triggers after bots join a meeting
- reviewing bot, transcript, matched-trigger, timer-trigger, and webhook debug logs
- switching between low-storage production logging and full debug logging

OpenAI and AI classification were removed to avoid token cost. The app now uses word triggers and timer triggers only.

## Tech Stack

- Next.js App Router
- TypeScript
- local JSON or Supabase Postgres via the storage driver

## Current Scope

Included:

- Meeting Sessions
- Recall bot creation from `/bots`
- listener and sender bot roles for multi-bot meetings
- scheduled bot joins from `/scheduled-bots`
- scheduled bot joins are idempotent and create only one batch after completion
- bot status auto-refresh and stop actions
- `joinedAt` tracking when bots first enter in-call status
- word trigger CRUD
- timer trigger CRUD
- trigger cooldown
- response delay
- max trigger count with auto-disable
- sender modes: `round_robin_bots`, `specific_bots`, and `all_bots`
- timer trigger logs
- webhook debug logs
- transcript logs
- matched trigger logs
- `production_minimal` storage mode by default
- `debug` storage mode for troubleshooting
- dry-run and real `send_chat_message`
- multi-page admin dashboard

Not included:

- login
- multi-tenant CRM features
- production queue/background worker

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

- `STORAGE_DRIVER=local` keeps using `data/store.json`.
- `STORAGE_DRIVER=supabase` uses Supabase Postgres through the server-side storage adapter.
- `RECALL_REGION=us-west-2` matches your current setup.
- `RECALL_API_KEY` is server-side only and is never exposed to the frontend.
- `RECALL_SEND_CHAT_ENABLED=false` keeps the app in dry-run mode.
- `PUBLIC_WEBHOOK_BASE_URL` is used for the webhook preview and bot creation payload.
- `VERCEL_AUTOMATION_BYPASS_SECRET` is optional and appends the Vercel protection bypass query parameter for Recall webhook delivery.
- `NEXT_PUBLIC_SUPABASE_URL` is required only for the Supabase storage driver.
- `SUPABASE_SERVICE_ROLE_KEY` is server-side only and is required only for the Supabase storage driver.
- local storage writes are serialized through a process-level queue
- `data/store.json` writes are atomic via `data/store.json.tmp` then replace
- the previous valid store is backed up to `data/store.backup.json`
- Restart the dev server every time `.env.local` changes.

## Storage Driver

Phase 1 adds a Supabase-supported storage adapter without changing the UI or API routes.

Supported drivers:

- `local`
  - uses `data/store.json`
  - current default
- `supabase`
  - uses Supabase Postgres through the server-side adapter
  - frontend still talks only to the existing Next.js API routes
  - supported for Phase 1 verification and migration work

Files added for the adapter layer:

- `lib/storage/index.ts`
- `lib/storage/local-store.ts`
- `lib/storage/supabase-store.ts`
- `lib/storage/types.ts`

Supabase migration file:

- `supabase/migrations/001_initial_schema.sql`

Export script:

- `npm run export-store-to-supabase`
  - reads `data/store.json`
  - upserts records into Supabase
  - preserves IDs and timestamps
  - creates `Default Session` if needed
  - skips duplicates safely through upsert behavior
  - prints a count summary

Health check API:

- `GET /api/health/storage`
  - returns `storageDriver`
  - returns `ok`
  - returns current timestamp
  - confirms the configured driver can read storage
  - never returns secret environment variable values

Vercel note:

- use `STORAGE_DRIVER=supabase` on Vercel
- do not deploy with `STORAGE_DRIVER=local`

## Pages

`/` redirects to `/dashboard`.

### `/dashboard`

- summary cards
- current session name
- latest 5 webhook debug logs
- latest 5 transcript logs
- latest 5 matched trigger logs

### `/sessions`

- create session
- edit session name, Zoom URL, and notes
- Zoom URL is the source of truth for bot creation
- Zoom URL editing is blocked while that session has active bots
- start session
- end session
- archive session
- delete session when it has no active bots
- current session selector support
- ending a session stops active bots in that session and cancels pending schedules
- ended or archived sessions cannot create bots, run timers, run schedules, or send live chat

### `/bots`

- create one bot or many bots
- manual single-bot creation creates one listener bot
- manual bot creation checks whether the current session already has an active listener
- bulk bot creation creates the first bot as `listener` and the rest as `sender`
- custom bot names for bulk creation
- scoped to current session
- transcript language is locked to `Chinese (zh-CN)` for new bots
- uses the global sidebar `Current Session`
- current session name, status, and Zoom URL shown read-only
- bot creation is disabled if the current session has no Zoom URL
- bot creation is disabled if the current session is not active
- bot creation shows preflight errors when Recall environment variables are missing
- bot creation warns when `PUBLIC_WEBHOOK_BASE_URL` points to localhost
- Active Bots tab
- Bot History tab
- automatic bot status refresh every 10 seconds while the page stays open and active, created, or joining bots exist
- refresh one bot status
- stop one active bot
- delete one history bot record
- clear all history bot records while keeping active bots
- check transcript for each active bot
- check bot details for each active bot
- expand saved create-bot payload for each bot
- search bot ID
- search bot name
- search meeting URL
- filter status
- manual bot creation remains available here

### `/scheduled-bots`

- create scheduled bot joins
- scheduled multi-bot joins create the first bot as `listener` and the rest as `sender`
- scheduled runs check at run time whether the session already has an active listener
- edit scheduled bot joins
- enable or disable schedules
- cancel schedules
- delete schedules
- uses the global sidebar `Current Session`
- current session name, status, and Zoom URL shown read-only
- scheduled date and time
- number of bots and bot names
- transcript language is locked to `Chinese (zh-CN)` for new schedules
- show created bot IDs after a run
- show schedule errors when failed
- automatic due-schedule checks every 10 seconds while the page is open
- last auto-run time and summary
- local MVP note that production should use cron/background worker
- schedule execution is blocked for ended or archived sessions
- schedule creation and execution show clear preflight failures when required Recall config is missing

### `/diagnostics`

- storage driver
- storage health
- storage last checked time
- storage error when failed
- warning when `STORAGE_DRIVER=local` is used in production or on Vercel
- warning when `PUBLIC_WEBHOOK_BASE_URL` points to localhost
- warning when `RECALL_SEND_CHAT_ENABLED=true`
- whether `VERCEL_AUTOMATION_BYPASS_SECRET` is configured
- `PUBLIC_WEBHOOK_BASE_URL`
- full webhook URL
- `RECALL_REGION`
- `RECALL_SEND_CHAT_ENABLED`
- whether Recall API key is configured
- last 10 webhook debug logs
- last 10 transcript logs
- last 10 `transcript.failed` or `transcript.done` events

### `/triggers`

- create trigger rule
- edit trigger rule
- enable or disable trigger rule
- delete trigger rule
- delete all trigger rules for the current session
- search trigger phrase
- search reply message
- filter enabled or disabled
- scoped to current session
- configure sender mode
- configure cooldown
- configure response delay
- configure max trigger count

### `/timer-triggers`

- create timer trigger
- edit timer trigger
- enable or disable timer trigger
- delete timer trigger
- delete all timer trigger rules for the current session
- timer sender modes: `round_robin_bots`, `specific_bots`, `all_bots`
- automatic timer auto-run every 10 seconds while the page stays open
- show last auto-run time
- show last auto-run summary
- show trigger count and max trigger count
- show `lastTriggeredAt`
- show timer trigger logs
- delete one timer trigger log
- clear all timer trigger logs
- timer delay is calculated from the earliest active bot `joinedAt`
- overdue timers run on the next auto-run check
- scoped to current session

### `/live-chat`

- manual real-time Zoom chat sending from the CRM
- message textarea
- sender modes: `round_robin_bots`, `specific_bots`, `all_bots`
- active bot selector for `specific_bots`
- latest live chat logs
- delete one live chat log
- clear all live chat logs
- uses only active bots from the current session

### `/webhooks`

- webhook debug logs
- page size: `25`, `50`, `100`
- search bot ID
- search extracted transcript
- filter event
- filter status
- expand raw payload JSON
- clear all webhook debug logs
- filtered to current session when the bot is known

### `/transcripts`

- transcript logs
- page size: `25`, `50`, `100`
- search transcript text
- search bot ID
- delete one transcript log
- clear all transcript logs
- scoped to current session

### `/matched-triggers`

- matched trigger logs
- page size: `25`, `50`, `100`
- search trigger phrase
- search reply message
- search bot ID
- filter status
- delete one matched trigger log
- clear all matched trigger logs
- scoped to current session

### `/settings`

Configuration and storage controls:

- `RECALL_REGION`
- `RECALL_SEND_CHAT_ENABLED`
- `PUBLIC_WEBHOOK_BASE_URL`
- full webhook URL preview
- whether Recall API key is configured
- `Storage / Logging Mode`
- clear bot history
- clear transcript logs
- clear webhook debug logs
- clear matched trigger logs
- clear timer trigger logs
- emergency stop all active bots across all sessions

The API key value is never shown.

## Storage / Logging Mode

The app stores `Storage / Logging Mode` through the currently selected storage driver.

### `production_minimal`

Recommended for future Free Supabase or live use.

Behavior:

- webhook events are still received and transcript text is still extracted in memory
- word trigger matching still works normally
- dry-run and real Zoom chat sending still work normally
- webhook debug logs are not saved during normal processing
- transcript logs are not saved during normal processing
- raw webhook payload JSON is not saved
- matched trigger logs are saved only when a trigger actually matches
- timer trigger logs are saved only when a timer executes or fails
- `skipped_not_due` timer cycles are not written every 10 seconds
- if something fails, an error log is still saved
- trigger execution still happens immediately when `/api/recall/webhook` receives the transcript event

### `debug`

Use this only for troubleshooting.

Behavior:

- webhook debug logs are saved
- transcript logs are saved
- raw webhook payload JSON is saved
- current detailed local debugging behavior stays enabled

If something breaks, switch to `debug`, reproduce the issue, inspect the logs, then switch back to `production_minimal`.

Manual verification:

- In `production_minimal`, normal `/webhooks` and `/transcripts` entries are suppressed, but transcript extraction and trigger matching still run.
- A real matched trigger should still create a `/matched-triggers` log and increment trigger usage.
- In `debug`, `/webhooks`, `/transcripts`, and `/matched-triggers` should all save as usual.

## Meeting Sessions

Meeting Sessions group these records by meeting instead of keeping everything global:

- Recall bots
- word trigger rules
- timer trigger rules
- matched trigger logs
- timer trigger logs
- live chat logs
- webhook debug logs when saved
- transcript logs when saved

The sidebar `Current Session` selector controls what these pages show:

- `/dashboard`
- `/bots`
- `/triggers`
- `/timer-triggers`
- `/live-chat`
- `/matched-triggers`
- `/transcripts`
- `/webhooks`
- `/scheduled-bots`

The sidebar `Current Session` selector is the single source of truth for session selection. Feature pages do not show their own session chooser.

Session rules:

- Zoom URL belongs to the Meeting Session record
- `/bots` creates bots under the current sidebar session and always uses that session's Zoom URL
- to create bots for another meeting session, switch the sidebar `Current Session` first
- bot creation is blocked when the current session has no Zoom URL
- only `active` sessions are allowed to create bots, run schedules, run timers, and send live chat
- ended or archived sessions show `This session is ended/archived.`
- scheduled bot joins are created under the current sidebar session
- scheduled bot joins use that session's Zoom URL
- scheduled bot joins are blocked when the current sidebar session has no Zoom URL
- session Zoom URL cannot be changed while that session still has active bots
- timer triggers only use active bots from the same session
- Live Chat only uses active bots from the current session
- `Stop All Active Bots` only stops bots from the current session
- webhook processing finds the session from the saved Recall bot ID
- if a webhook bot ID is unknown, it falls back to `Default Session`

Backward compatibility:

- old records without `sessionId` are assigned to `Default Session`
- the app creates `Default Session` automatically if needed

## Trigger Normalization And Duplicate Prevention

Trigger rules use the same normalization for duplicate prevention and transcript matching.

Normalization:

- lowercases text
- removes spaces
- removes punctuation and symbols
- converts common Chinese numerals:
  - `零 -> 0`
  - `一 -> 1`
  - `二 -> 2`
  - `三 -> 3`
  - `四 -> 4`
  - `五 -> 5`
  - `六 -> 6`
  - `七 -> 7`
  - `八 -> 8`
  - `九 -> 9`

Examples that normalize to the same value:

- `测试123`
- `测试 1 2 3`
- `测试一二三`

Enabled trigger rules cannot duplicate another enabled rule after normalization.

If old duplicate rules already exist in `data/store.json`, the app still loads them so you can disable or delete them manually.

During webhook matching, only the first enabled matching rule is allowed to trigger. This prevents duplicate Zoom chat sends from old duplicate rules that still exist in storage.

## Trigger Sender Modes

The UI exposes three sender modes:

- `round_robin_bots`
- `specific_bots`
- `all_bots`

Old saved rules with `senderMode=triggering_bot` are still supported for backward compatibility. They are treated safely as `round_robin_bots` when loaded.

### `round_robin_bots`

This is the default for new rules.

Behavior:

- you do not manually select bots
- the rule automatically uses all currently Active Bots
- exactly one active bot sends per accepted trigger
- the chosen sender rotates using `nextSenderIndex`
- if a bot becomes inactive, round-robin skips it
- if a new active bot appears, it joins the active sender pool automatically
- if no active bots exist, the trigger logs `no_active_sender_bot`
- cooldown and dedupe skips do not advance the round-robin index
- one accepted trigger execution advances the index once only

### `specific_bots`

Behavior:

- you manually select one or more active bots
- saving with no assigned bots is allowed
- all selected bots send for an accepted trigger
- only Active Bots are selectable
- if an older rule references a missing or inactive bot, the UI shows a warning

If no bots are assigned yet, the rule can still be saved and shows a warning. It will not send until bots are assigned.

### `all_bots`

Behavior:

- all current Active Bots send the same reply once each
- no manual bot selector is shown
- if no active bots exist, the trigger logs `no_active_sender_bot`

## Response Delay And Max Trigger Count

Each trigger rule supports:

- `responseDelaySeconds`
- `triggerCount`
- `maxTriggerCount`
- `lastTriggeredAt`

Rules:

- `Response Delay Seconds` range is `0` to `300`
- the current local MVP waits inside webhook processing before finishing the send
- production should move delayed sends into a background job or queue
- `Max Trigger Count` empty or `0` means unlimited
- every accepted non-dedupe trigger increments `triggerCount`
- dedupe-skipped triggers do not increment `triggerCount`
- when `triggerCount` reaches `maxTriggerCount`, the rule auto-disables after that trigger finishes

## Send Chat Behavior

### Dry-run mode

When `RECALL_SEND_CHAT_ENABLED=false`:

- the app does not call Recall send chat
- matched trigger logs show `dry_run`
- the action log says the app would send the reply

### Real send mode

When `RECALL_SEND_CHAT_ENABLED=true`:

- the server calls Recall `send_chat_message`
- the Recall API key stays server-side
- matched trigger logs show `sent`, `failed`, or `no_active_sender_bot`

Real send only works when the webhook payload contains a real Recall bot ID from an active meeting bot.

## Internal Dedupe And Duplicate-send Protection

The app keeps internal protection to prevent double sends.

Protection rules:

- cooldown blocks repeated accepted triggers inside the rule cooldown window
- webhook dedupe blocks repeated matches for the same rule and same normalized transcript in a short window
- each accepted trigger gets a unique `triggerExecutionId`
- sender bot IDs are deduped before sending
- one accepted trigger execution can send only once per unique sender bot
- `transcript.data` and `transcript.partial_data` should not both cause the same accepted execution to send twice
- repeated identical `transcript.partial_data` payloads from the same bot are lightly suppressed before full trigger processing to reduce overload

Internal duplicate-skip outcomes are kept for protection, but they are not shown as a normal user-facing status filter.

## Recall Bot Creation

The `/bots` page lets you create a Recall bot with:

- bot name or bot name prefix
- number of bots
- transcript language

Bot creation rules:

- `/bots` always sends the current sidebar `sessionId`
- the backend looks up `session.zoomUrl` and uses it as `meeting_url`
- the backend does not trust a frontend `meeting_url`
- transcript language is fixed to `zh-CN` even if the browser submits a different value
- single-bot creation creates one `listener` bot
- if the current session has no active listener bot, the first successfully created new bot becomes `listener`
- if the current session already has an active listener bot, new bots default to `sender`
- bulk creation uses at most one listener for the session and makes the rest `sender`
- sender bots still join the meeting and can send chat, but they do not include transcript config or realtime transcript endpoints
- if the current session has no Zoom URL, bot creation is rejected
- if the current session is not `active`, bot creation is rejected
- if Recall environment variables are missing, bot creation is rejected before sending the Recall API request
- if `PUBLIC_WEBHOOK_BASE_URL` points to localhost, the UI warns that real Recall webhooks cannot reach it
- bulk bot creation uses the same current session Zoom URL for every created bot

Manual bot creation in `/bots` stays available even when scheduled bot joins are enabled.

## Scheduled Bot Join

The `/scheduled-bots` page lets you schedule bots to auto-create and join later.

Each schedule includes:

- scheduled date and time
- bot count
- bot names
- transcript language
- enabled state

Rules:

- new schedules always use the current sidebar session
- the schedule uses its saved `sessionId` and that session's Zoom URL when it runs
- new scheduled joins are locked to `zh-CN` transcription
- scheduled multi-bot creation uses the first bot as `listener` and the rest as `sender`
- at run time, if the session already has an active listener, all scheduled bots are created as `sender`
- if the session has no active listener at run time, the first successfully created scheduled bot becomes `listener`
- schedule creation is blocked if no current session is selected
- schedule creation is blocked if the current sidebar session has no Zoom URL
- schedule creation is blocked if the current sidebar session is ended or archived
- schedule execution immediately marks the job as `running` before bot creation begins
- completed schedules do not run again
- if auto-run fires twice, the second run skips schedules already marked `running` or `completed`
- due schedules create Recall bots sequentially, not in parallel
- created bot records are saved locally under the schedule's session
- created bot IDs are saved back onto the schedule after it runs
- missing Recall config such as `RECALL_API_KEY`, `RECALL_REGION`, or `PUBLIC_WEBHOOK_BASE_URL` is reported as a clear preflight failure
- local MVP auto-runs only while `/scheduled-bots` is open
- production should use cron/background worker for reliable background execution
- existing older schedules keep their saved `sessionId` for backward compatibility
- if an older schedule belongs to another session, switch to that session from the navigation bar before editing it

It also shows a read-only webhook preview:

```text
${PUBLIC_WEBHOOK_BASE_URL}/api/recall/webhook
```

The server sends the Recall create-bot request to:

```text
https://${RECALL_REGION}.recall.ai/api/v1/bot/
```

The request body includes:

- `meeting_url`
- `bot_name`
- join chat message
- Deepgram streaming transcript config
- webhook realtime endpoint for `transcript.data`

If `VERCEL_AUTOMATION_BYPASS_SECRET` is configured:

- the real webhook URL sent to Recall includes `?x-vercel-protection-bypass=<secret>`
- the saved payload shown in the app masks that value as `***masked***`
- the secret is never shown in the UI or stored in visible bot payload history
- if the bypass secret changes, redeploy and create a new bot because existing bots keep their old webhook URL

### Bulk creation

Rules:

- default bot count is `1`
- minimum bot count is `1`
- maximum bot count is `20`
- creation runs sequentially, not in parallel

When `Number of Bots = 1`:

- the form shows one `Bot Name` field

When `Number of Bots > 1`:

- the form shows `Bot Name Prefix`
- the form shows one editable bot-name input per bot
- default names are auto-filled from the prefix

Example with prefix `ChatsHero AI Assistant` and count `3`:

- `ChatsHero AI Assistant 1`
- `ChatsHero AI Assistant 2`
- `ChatsHero AI Assistant 3`

You can edit each name before creating.

If some creations fail:

- successful bot records are still saved locally
- failed attempts are returned with per-bot errors
- the `/bots` page shows both successes and failures

## Bot Management

Saved bot records include:

- Recall bot ID
- meeting URL
- bot name
- transcript language
- webhook URL
- status
- created time
- joined time when the bot first reaches an in-call status
- last status checked time
- last error message when relevant
- saved create-bot request payload
- raw Recall API response

Bot actions on `/bots`:

- automatic bot status refresh every 10 seconds while `/bots` stays open and active, created, or joining bots exist
- `Stop Bot`
- `Refresh Status`
- `Check Transcript`
- `Check Bot Details`

### Bot transcript diagnostics

`Check Transcript` calls:

```text
GET https://${RECALL_REGION}.recall.ai/api/v1/bot/${botId}/transcript/
```

The result shows:

- whether transcript content was found
- transcript item count
- latest transcript text when available
- error message if the Recall API call fails

### Bot details diagnostics

`Check Bot Details` calls:

```text
GET https://${RECALL_REGION}.recall.ai/api/v1/bot/${botId}/
```

The result shows:

- bot status
- recording status when available
- transcript config when available
- realtime endpoint config when available
- expandable raw Recall response

### Create-bot payload debug

Each saved bot record also keeps the exact create-bot request payload sent to Recall so you can inspect:

- `meeting_url`
- `bot_name`
- `recording_config`
- realtime endpoint settings
- the webhook URL used during bot creation

When `Refresh Status` or `Refresh All Statuses` sees a bot enter one of these in-call statuses for the first time, the local record sets `joinedAt` if it is still empty:

- `in_call_not_recording`
- `in_call_recording`
- `recording_permission_allowed`
- `recording_permission_denied`

### Active Bots vs Bot History

The `/bots` page separates records into:

- `Active Bots`
- `Bot History`

Active detection uses the shared `isBotActiveStatus` helper. If a status is missing or unclear, the bot is treated as history unless it looks active.

UI behavior:

- only active bots show `Stop Bot`
- history bots still show `Refresh Status`
- history bots can be deleted one by one from `/bots`
- `/bots` can clear all history bot records without removing active bots
- raw status text is always shown
- `joinedAt` is shown when available

### Automatic status refresh

While `/bots` is open:

- saved bot records are checked against Recall every 10 seconds when active, created, or joining bots exist
- refreshes continue sequentially through the backend refresh-all route
- overlapping refresh requests are blocked
- `joinedAt` is still populated automatically the first time a bot reaches an in-call status

### Stopping bots

Active bots are stopped with the Recall `leave_call` endpoint:

- `POST https://${RECALL_REGION}.recall.ai/api/v1/bot/{botId}/leave_call/`
- this is for bots that are already in or joining a live call
- scheduled bots before joining are a different state and may reject `leave_call`
- already ended bots may return errors such as `cannot_command_completed_bot`
- bots that never started may return `cannot_command_unstarted_bot`
- `Stop All Active Bots` only stops active bots in the current selected session
- `/settings` includes `Emergency Stop All Active Bots` for stopping active bots across every session

The `/bots` page stores the latest stop diagnostics on each bot record:

- endpoint used
- HTTP status
- Recall response body
- stop attempt timestamp

Stopping a bot does not delete historical transcript, matched-trigger, timer-trigger, or webhook logs.

## Timer Triggers

Timer triggers are separate from transcript word triggers.

They use:

- the earliest `joinedAt` from current Active Bots as the meeting start reference
- a delay in minutes after join
- one or more sender bots depending on timer sender mode

That means a timer is based on:

- `X` minutes after the earliest active bot joined the meeting
- not `X` minutes after you created or edited the timer trigger

If the scheduled time has already passed, the timer runs on the next auto-run check.

Current timer trigger fields:

- `name`
- `enabled`
- `delayMinutesAfterJoin`
- `message`
- `senderMode`
- `senderBotIds`
- `nextSenderIndex`
- `responseDelaySeconds`
- `maxTriggerCount`
- `triggerCount`
- `lastTriggeredAt`
- `createdAt`
- `updatedAt`

Timer trigger sender modes:

- `round_robin_bots`
  - uses all current Active Bots
  - only one bot sends
  - rotates sender using `nextSenderIndex`
- `specific_bots`
  - uses manually selected bots
  - can be saved with no assigned bots yet
  - when no bots are assigned yet, the timer stays waiting and does not spam logs
  - once bots are assigned but inactive, it can log `no_active_sender_bot`
- `all_bots`
  - all current Active Bots send the same message once each
  - if no active bots exist, logs `no_active_sender_bot`

### Automatic local timer execution

Local MVP timers do not run from a true background worker.

Instead:

- `/timer-triggers` automatically calls `/api/timer-triggers/run-due` every 10 seconds while that page is open
- overlapping auto-run requests are blocked
- the page shows the last auto-run time and summary
- `specific_bots` timers with no assigned bots stay in a waiting state and do not create repeated timer logs every cycle
- overdue enabled timer triggers run on the next auto-run check
- if you assign bots later to an already overdue `specific_bots` timer, it can run on the next auto-run check

The backend route still exists for internal use, but the manual `Run Due Timers Now` button has been removed from the UI.

Production should move this into cron or a background worker.

In `production_minimal`, timer logs are only written when a timer actually executes or fails.

### Timer trigger log statuses

Timer trigger logs can show:

- `dry_run`
- `sent`
- `failed`
- `no_active_sender_bot`
- `skipped_not_due`
- `skipped_limit_reached`

## Live Chat

The `/live-chat` page lets you type a manual message and send Zoom chat in real time from the CRM.

Live Chat sender modes:

- `round_robin_bots`
  - one active bot sends at a time
  - the sender rotates after each accepted live send
- `specific_bots`
  - selected active bots send
  - sending is blocked until at least one active bot is selected
- `all_bots`
  - all active bots send the same message once each

Live Chat respects `RECALL_SEND_CHAT_ENABLED`:

- `false` = dry-run log only
- `true` = real Recall `send_chat_message`

Live Chat is blocked when the current session is not `active`.

## Webhook Behavior And Debugging

The webhook route accepts and logs:

- `transcript.data`
- `transcript.partial_data`
- `transcript.failed`
- `transcript.done`
- unknown events

For every webhook request, the app stores:

- event name
- raw payload JSON
- received timestamp
- bot ID when available
- processed, ignored, failed, or unknown status
- extracted transcript text when available
- error message when available

When `Storage / Logging Mode` is `production_minimal`, these normal webhook and transcript debug records are intentionally suppressed to save storage. Switch to `debug` when you need full troubleshooting data again.

Trigger execution is event-driven:

- `/api/recall/webhook` processes transcript events as soon as the webhook is received
- page refresh timing only affects when you see updated logs in the UI
- UI polling delay is not the same thing as trigger execution delay

Trigger matching only runs for:

- `transcript.data`
- `transcript.partial_data`

Transcript matching safety:

- listener bots are the only bots that should transcribe and trigger rules
- if a sender-only bot somehow emits transcript events, the app ignores them for trigger matching

Transcript extraction supports:

- `data.data.words`
- `data.data.transcript`
- `data.data.text`
- `data.transcript`
- `data.text`

Debugging guide:

- if `/webhooks` is empty, Recall is not reaching the app
- if `/webhooks` shows `transcript.failed`, the transcription provider likely failed
- if transcript logs exist but matched-trigger logs do not, check normalization and trigger phrases
- if `Check Transcript` returns empty, Recall is not producing transcript for that bot yet
- if `Check Transcript` has transcript but `/webhooks` is empty, the webhook delivery URL or realtime endpoint config is wrong
- if `/webhooks` has transcript events but `/transcripts` is empty, the local extraction or transcript-processing path is wrong
- if `production_minimal` is enabled, normal webhook and transcript logs are intentionally suppressed
- if the saved create-bot payload shows a localhost webhook URL, Recall cannot deliver real internet webhook events to this app
- if `data/store.json` is corrupted and no valid backup exists, webhook requests now return a clear `500` JSON error instead of a raw crash
- matched trigger latency fields help show whether delay is coming from transcript arrival, trigger matching, storage, or Zoom `send_chat_message`

Deepgram note:

- when using `deepgram_streaming`, the Deepgram API key must be configured inside the Recall dashboard for your Recall region
- it is not stored in this app's `.env.local`
- if Deepgram is missing in Recall, the bot may join Zoom but transcription can still fail

## Refresh Intervals

The app does not reduce every page to 1 second polling because that can create unnecessary load on Vercel, Supabase, and the browser without improving actual trigger speed.

Current UI refresh behavior:

- `/webhooks`, `/transcripts`, and `/matched-triggers` refresh about every 3 seconds while the page is visible
- `/bots` status refresh stays about every 10 seconds while the page is visible
- `/scheduled-bots` due-check stays about every 10 seconds while the page is visible
- `/timer-triggers` due-check stays about every 5 seconds while the page is visible
- hidden browser tabs skip these polling cycles

Recommended production pattern:

- keep trigger execution event-driven from the webhook
- use 1 listener bot plus sender-only bots to reduce duplicate transcript load
- use latency logs to identify whether delay is coming from Recall transcription, webhook handling, storage, or Zoom send chat

## Preflight Checks

Before manual bot creation and scheduled bot execution, the app checks:

- `RECALL_API_KEY`
- `RECALL_REGION`
- `PUBLIC_WEBHOOK_BASE_URL`
- session Zoom URL
- session status is `active`

If `PUBLIC_WEBHOOK_BASE_URL` contains `localhost`, `127.0.0.1`, or `::1`, the UI shows a warning that real Recall webhooks cannot reach the app from the internet.

## Localhost Limitation

Recall cannot reach:

```text
http://localhost:3000/api/recall/webhook
```

for real internet-delivered meeting webhooks.

That means:

- local manual webhook tests work
- bot creation can still work
- a bot can still join Zoom
- real transcript webhooks need a public HTTPS URL

For live meeting webhook testing, use a temporary public HTTPS tunnel such as Cloudflare Tunnel. After deployment, set `PUBLIC_WEBHOOK_BASE_URL` to the production domain.

## Logs

Logs are historical records and are not editable.

Supported log actions:

- delete one timer trigger log
- clear all timer trigger logs
- delete one transcript log
- clear all transcript logs
- delete one matched trigger log
- clear all matched trigger logs
- clear all webhook debug logs
- clear bot history while keeping active bots

Newest logs are shown first.

## API Routes

- `POST /api/recall/create-bot`
- `GET /api/scheduled-bots`
- `POST /api/scheduled-bots`
- `PATCH /api/scheduled-bots/:id`
- `DELETE /api/scheduled-bots/:id`
- `POST /api/scheduled-bots/run-due`
- `GET /api/recall/bots`
- `POST /api/recall/bots/refresh-all`
- `DELETE /api/recall/bots/history`
- `DELETE /api/recall/bots/:id`
- `GET /api/recall/bots/:id/status`
- `GET /api/recall/bots/:id/details`
- `GET /api/recall/bots/:id/transcript`
- `POST /api/recall/bots/:id/stop`
- `POST /api/recall/webhook`
- `POST /api/trigger-rules`
- `GET /api/trigger-rules`
- `PATCH /api/trigger-rules/:id`
- `DELETE /api/trigger-rules/:id`
- `POST /api/timer-triggers`
- `GET /api/timer-triggers`
- `PATCH /api/timer-triggers/:id`
- `DELETE /api/timer-triggers/:id`
- `POST /api/timer-triggers/run-due`
- `POST /api/live-chat/send`
- `GET /api/logs`
- `GET /api/logs/live-chat`
- `DELETE /api/logs/live-chat`
- `DELETE /api/logs/live-chat/:id`
- `GET /api/logs/timer-trigger`
- `DELETE /api/logs/timer-trigger`
- `DELETE /api/logs/timer-trigger/:id`
- `GET /api/logs/webhook-debug`
- `DELETE /api/logs/webhook-debug`
- `GET /api/logs/transcript`
- `DELETE /api/logs/transcript`
- `DELETE /api/logs/transcript/:id`
- `GET /api/logs/matched-trigger`
- `DELETE /api/logs/matched-trigger`
- `DELETE /api/logs/matched-trigger/:id`
- `GET /api/settings`
- `PATCH /api/settings`

## Store Recovery Troubleshooting

If you see a `JSON.parse` error from `lib/store.ts` such as:

```text
SyntaxError: Expected double-quoted property name in JSON
```

do this:

1. Stop `npm.cmd run dev`.
2. Stop your Cloudflare tunnel.
3. Run:

```powershell
npm run repair-store
```

4. If repair fails, run:

```powershell
npm run reset-store
```

5. Restart:

```powershell
npm.cmd run dev
```

What the scripts do:

- `npm run repair-store`
  - validates `data/store.json`
  - if invalid, tries to restore `data/store.backup.json`
  - if both are invalid, prints manual recovery instructions and keeps your files
- `npm run reset-store`
  - backs up the current `data/store.json` to `data/store.corrupted.TIMESTAMP.json`
  - creates a fresh empty valid store
  - warns that local bots, triggers, timer triggers, and logs were reset

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

## Supabase Test Checklist

1. Run `supabase/migrations/001_initial_schema.sql`.
2. Run `supabase/migrations/002_recall_bot_roles.sql` if your Supabase project was created before bot roles were added.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
4. Set `STORAGE_DRIVER=supabase`.
5. Restart `npm.cmd run dev`.
6. Open `/diagnostics` and confirm `Storage Health` is `ok`.
7. Create a meeting session and confirm the row appears in Supabase.

## Vercel Deployment Checklist

1. Run `npm.cmd run build`.
2. Push the repo to GitHub.
3. Import the project into Vercel.
4. Set these production environment variables:

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

5. Run `supabase/migrations/001_initial_schema.sql` on the target Supabase project.
6. Restart or redeploy after any Vercel environment variable change.
7. Open `/diagnostics` after deploy and confirm:
   - `STORAGE_DRIVER` is `supabase`
   - `Storage Health` is `ok`
   - `PUBLIC_WEBHOOK_BASE_URL` shows the deployed Vercel URL

Deployment notes:

- never use `STORAGE_DRIVER=local` on Vercel
- never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code
- `PUBLIC_WEBHOOK_BASE_URL` must be the real deployed HTTPS domain
- start with `RECALL_SEND_CHAT_ENABLED=false` and test dry-run mode first
- if Vercel Authentication stays enabled, set `VERCEL_AUTOMATION_BYPASS_SECRET` so Recall can still reach `/api/recall/webhook`

## Manual Local Webhook Test

1. Create a trigger rule on `/triggers`.
2. Send the sample payload below to `/api/recall/webhook`.
3. Check `/webhooks`, `/transcripts`, and `/matched-triggers`.

```powershell
$body = @'
{
  "event": "transcript.data",
  "data": {
    "bot": {
      "id": "fake-bot-id"
    },
    "data": {
      "words": [
        { "text": "测试" },
        { "text": "一" },
        { "text": "二" },
        { "text": "三" }
      ]
    }
  }
}
'@

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/api/recall/webhook" `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

## Timer Trigger Testing

1. Create a timer trigger before creating any bots.
   - Open `/timer-triggers`.
   - Create a trigger in `specific_bots` mode with no bots assigned.
   - Confirm it saves successfully and shows the warning that the timer will not run until at least one bot is assigned.

2. Create an active bot.
   - Open `/bots`.
   - Create a bot for a real meeting.
   - Leave `/bots` open and confirm status updates automatically without using a Refresh All button.
   - Confirm `joinedAt` appears automatically once the bot first reaches an in-call status.

3. Assign bots later.
   - Return to `/timer-triggers`.
   - Edit the timer trigger.
   - Assign one or more active bots if using `specific_bots`.
   - Save and confirm the warning disappears.

4. Confirm timer auto-run.
   - Keep `/timer-triggers` open.
   - Wait until at least one minute has passed after the earliest active bot `joinedAt`.
   - Confirm the Last auto-run panel updates and the timer executes automatically without clicking a run button.

5. Confirm dry-run behavior.
   - Keep `RECALL_SEND_CHAT_ENABLED=false`.
   - Check Timer Trigger Logs.
   - Confirm the newest log shows `dry_run`, `sent`, `failed`, or `no_active_sender_bot` based on the sender mode and bot availability.

6. Confirm timer sender modes.
   - `specific_bots`: selected bots send, and duplicate selected bot IDs are only used once.
   - `round_robin_bots`: one active bot sends at a time and rotates on the next execution.
   - `all_bots`: all active bots send the same message once each.

## Notes

- OpenAI and AI classification have been removed from this MVP to avoid token cost.
- The app now uses word triggers and timer triggers only.
- Historical `data/store.json` files that still contain old AI keys are tolerated; the app ignores those legacy fields.
- Local JSON storage is still used in this MVP, but writes are now queued, atomic, and backed up for recovery.
- Recommended production meeting setup is one listener bot per meeting and extra sender-only bots only when needed. This reduces duplicate transcripts, storage load, Supabase queries, cost, and Zoom chat delay.
