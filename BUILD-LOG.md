# Build log

## 2026-11-11: Phase 1

### Built
- `wrangler.jsonc`: worker `health`, D1 `health-db` as `DB`, reused `OURA_KV` (92f36114…), crons `0 11 * * *` + `0 12 * * *`.
- `migrations/0001_init.sql`: days, food, lifts, bp, oura, cpap, scans, labs, meds, eye, rules_log, sync_log.
- `src/schema.js`: worker applies its own migrations on first request/cron and records them in wrangler's `d1_migrations` table.
- `src/oura.js`, `src/myair.js`: Oura OAuth refresh and myAir login carried over from the old connector (little-queen-2e28).
- `src/sync.js`: Oura + myAir ingest. Upsert by date, so re-runs overwrite and never duplicate.
- `src/mcp.js`: MCP server at `/mcp`, bearer auth on `MCP_TOKEN`. Tools: log_food, log_lift, log_bp, log_weight, log_day, get_day, get_week, get_trends, get_labs, get_lifts, sync_now, delete_entry, import_tracker (only while `IMPORT_ENABLED=1`).
- One-time import of the Fuel Log tracker (17 day docs) and the lab baseline.

### Decisions
- **Cron at 6:00 CT.** Cron is UTC only. Two triggers fire (11:00 and 12:00 UTC); the handler runs only the one where Chicago reads 6 a.m. So it's right in both CST and CDT with no edits.
- **Self-applied migrations.** Workers Builds runs `wrangler deploy` only. Rather than depend on the build token having D1 rights, the worker brings the schema up itself. Every statement is `IF NOT EXISTS`. `npm run migrate:remote` still works and will skip what's applied.
- **MCP SDK v1, stateless Streamable HTTP**, not the `agents` package. `agents` 0.33 is mid-migration to MCP SDK v2 (new 2026-07-28 spec); its stateless path needs the v2 server packages, and I couldn't confirm claude.ai's connector client speaks that spec version. v1 `McpServer` + `WebStandardStreamableHTTPServerTransport` (no sessions, JSON responses) runs on Workers with no Durable Objects and works with any MCP client. Revisit when v2 is confirmed with claude.ai.
- **CPAP dating.** myAir dates a night by when it starts. Oura dates by the morning you wake. Stored as each source does. `get_day(D)` returns `cpap_last_night` = cpap row for D-1. `get_week`/`get_trends` put CPAP on the morning it ended, so it lines up with Oura.
- **Oura nulls never overwrite.** Upsert uses COALESCE, because Oura fills a day in over the morning.
- **/auth is off** (`OURA_AUTH_ENABLED=0`). The old worker let anyone hit /auth and link a different Oura account over the saved tokens. Re-link only if tokens die: set it to 1, visit /auth, set back to 0. State param is now checked.
- **ntfy** used only for "sync failed" pushes, no numbers. Morning push is phase 2.
- **Schema additions beyond the spec:** `source`/`src_key` on food, lifts, bp (import idempotency); `note` on lifts/bp; `date` on bp; oura gets efficiency, awake_min, resp_rate, temp_dev, active_cal; cpap gets myair_score; labs get value_text and note; meds get kind and prescriber; `sync_log` table.
- **delete_entry** tool added (fix a mistaken log by id). Not in the spec list.

### Tracker import mapping
- `items[]` → food rows, meal `unspecified` (the tracker didn't record which meal). n/c/p/est kept as is.
- Preset meals checked on → food rows using the tracker's own preset numbers, tagged "(tracker preset)". The 0-cal "Other restaurant" preset is skipped; its food is already in items.
- `cans` → one food row per day (130 cal, 30 g each, the tracker's numbers) + `days.cans`.
- `wt` → days.weight. `note` → days.note. "20 min sauna" in the 11/6 note → sauna_min 20.
- Oura/CPAP snapshots the tracker showed → `days.raw`. The tables themselves are filled from the APIs (authoritative).
- Lifts were only in notes (11/9, 11/10, 11/11) → 27 lift rows, source `fuellog-note`. "Next time" plans stay in the note.
- BP am/pm, xc/xp, water and sauce toggles were empty/off on every day; nothing to import.
- Verified locally: per-day calories and protein match the tracker's own `totals()` formula for all 17 days.
- Lab units are filled only where the baseline doc gave them. Dates given only as a month (Apr 2026 ER labs, PSA) were matched to the known draw date; noted per row.

### Live test results (2026-11-11, 22:10 CT, through the claude.ai connector)
- Deploy live at https://health.m2thompson.workers.dev. `/` returns ok; `/mcp` with a wrong token returns 401.
- sync_now from 2026-10-01: Oura 42 days, CPAP 42 nights, no errors. Re-run for 3 days: 3 rows each; HRV series still 42 rows (no duplicates).
- Import: days 17, food 97, lifts 27, labs 87, meds 10. Per-day calories and protein match the tracker's own formula on all 17 days (31,525 cal / 2,640 g).
- Cross-check: tracker's Oura/CPAP snapshots for 10/30 and 11/5 match the API rows exactly, which confirms the CPAP night-before attribution.
- log_food -> get_day -> delete_entry round trip: pass.
- get_labs (hematocrit, 4 results), get_lifts (bench 11/9, 5 sets), get_week, get_trends: pass.
- Fixed during deploy: Cloudflare's GitHub link was disconnected (Michael reconnected it). The first deploy wiped plain-text dashboard variables; they're now secrets and `keep_vars: true` is set.
- import_tracker tool removed from the code after the import (with `keep_vars` the dashboard copy of IMPORT_ENABLED would have kept it on). `src/importer.js` stays in the repo for reference; remove the leftover IMPORT_ENABLED variable in the dashboard any time.

## 2026-11-11: Phase 1.1, web page

### Built
- `/app`: one-page phone web app (Today / Lift / Week). Today: calorie and protein bars, last night's Oura + CPAP, Sync button, quick-add templates (the old tracker's presets), add food, food list with delete, weight, BP, water, wine, sauna, note. Lift: exercise picker from history, last session's sets + that day's note, log a set, rest timer, today's sets with delete. Week: averages, daily table, 28-day weight chart.
- `/api/*`: JSON endpoints the page uses. Same database and same write helpers as the MCP tools (moved into `data.js`).
- `src/access.js`: verifies the Cloudflare Access JWT (RS256 against the team's certs, aud, issuer, expiry). `/app` and `/api` refuse everything without it, even if the Access app is deleted by mistake. Tested locally: valid token passes; wrong aud, wrong issuer, expired and forged signature all fail.

### Decisions
- Access must cover only `/app` and `/api`, not the whole hostname, or the Claude connector (`/mcp`) breaks.
- Delete is two taps (no browser confirm dialog).
- Protein cans get a +/- counter on Today (`/api/cans`); minus shrinks an old "xN" row instead of deleting it. Per-can sodium 95 mg taken from the existing Genius Gourmet entry (380 mg / 4).
- Live check 11/11 22:30: page loads behind Access, no-login requests redirect to the Access login, connector unaffected.
- Targets on the page (1,900 cal, 230 g) come from the build spec's targets section.

### Next
- Retire little-queen-2e28 so the two workers don't both refresh Oura tokens (Oura rotates refresh tokens; whichever refreshes second can break). Rotate old APP_TOKEN.
- Phase 2: researched rules, morning push, Sunday review.
