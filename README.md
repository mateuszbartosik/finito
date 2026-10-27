# Spent

A week-first timesheet for YouTrack that runs on your own computer. Nothing gets installed in YouTrack: Spent talks to it with your personal token, the same way you would.

Version 0.1.0 · 27 Oct 2026

## What it does

- **Log time in one line.** `APP-1207 1h30 review copy` and Enter. Spent reads it back as chips before anything is saved.
- **A week you can type into.** Issues × days, inline editing, totals against your daily target, short days flagged.
- **A timer.** One at a time, from any row. Switching issues stops the old one into a draft. Forgot to stop it? Trim it to the end of your day.
- **Suggestions.** Comments, field changes, attachments and commits you made in YouTrack become suggested time for the issue-days that have none yet.
- **Draft, then submit.** Nothing reaches YouTrack until you submit. Submit checks first, writes each change, and retries a network failure without creating duplicates.

## Start

You need Node.js 18.17 or newer (`node -v`). Nothing else: no `npm install`.

- **Windows:** double-click `start.cmd`.
- **Anywhere:** `npm start` (or `node server.js --open`).

Spent opens <http://localhost:5178>. Keep its window open while you use it; Ctrl+C stops it.

## Connect YouTrack

1. In YouTrack, open your avatar → **Profile** → **Account Security**.
2. Under **Tokens**, choose **New token…**, name it "Spent", give it the **YouTrack** scope, and copy it.
3. In Spent, enter the address and paste the token.

## Try it without touching YouTrack

Double-click `demo.cmd` (or `npm run demo`). It opens <http://localhost:5179> against a fake YouTrack with sample data and starts fresh every time.

## Quick entry

| Type | Means |
|---|---|
| `APP-1207` | the issue (any letter case). No ID? Words from the issue's title work when exactly one issue matches. |
| `1h30` `1.5` `90m` `90` `1:30` `9:00-10:30` | the time. Whole numbers up to 12 are hours, bigger ones minutes. |
| `today` `yesterday` `mon` … `sun` `mon-fri` `2026-10-27` | the day (default: today). `mon-fri` makes one work item per day. |
| `#review` | the work type. A unique start is enough (`#rev`). Without it, your default for that project is used. |
| anything else | the note. |

Press `/` anywhere to jump to the quick entry.

## The grid

Click a cell and type. Enter saves, Tab moves a day, ↑ ↓ move a row, Esc cancels, `0` removes the time. **Details** (right) shows the work items in the selected cell: type, note, ±15 minutes, remove. **Add row** puts any issue in the week before you log on it; **Copy last week's rows** brings back last week's open issues.

Cells: solid = in YouTrack, dashed blue = draft, struck through = will be removed, red dot = the last submit failed (the reason is in Details).

## Settings

- Daily target, work days, timer rounding, the end of your day.
- **Default work type per project.** Some projects have no "Design" type, so pick what your usual work goes in as, once. Setting a default also fills drafts that don't have a type yet.

## Where your data lives

- `data/config.json`: the YouTrack address and your token, in plain text. **Settings → Change address or token** replaces them; deleting the file disconnects Spent. Keep the folder private, and revoke the token in YouTrack if this computer is ever lost.
- `data/state.json`: drafts, edits that aren't submitted yet, the running timer and your settings. Submitted time lives only in YouTrack.

## Safety

- Spent listens on 127.0.0.1 only. Its API refuses requests without its own header and checks the Host and Origin, so other web pages can't drive it.
- The token never reaches the browser.
- It writes only your own work items. A create that times out is looked up before it's retried, so it can't land twice.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Port 5178 is already in use" | Spent is probably already running: open <http://localhost:5178>. Or `set SPENT_PORT=5180` before starting. |
| "Couldn't reach …" | Check the address, and your VPN if YouTrack needs one. |
| "YouTrack turned the token down" | Make a new permanent token with the YouTrack scope. |
| No suggestions | They need YouTrack's activity API (2020+). The rail shows the error if a request failed. |
| Behind a proxy | Node doesn't use the system proxy. Set `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY` (Node 24+). |

## Development

- `npm test` runs the parser, suggestion and API tests against a fake YouTrack (`test/mock-youtrack.js`). No install needed.
- `server.js` starts `lib/app.js` (routes, storage, submit, timer, suggestions). `lib/youtrack.js` is the REST client. The UI is `public/app.js` (Preact + htm, vendored in `public/vendor/`, no build step).
