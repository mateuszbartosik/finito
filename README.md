# Finito

A week-first timesheet for [YouTrack](https://www.jetbrains.com/youtrack/). Type your hours into a week, or log them in one line, and send them to YouTrack when the week looks right.

Finito runs on your own computer. Nothing gets installed in YouTrack: Finito talks to it with your personal token, the same way you would.

The name is casual Polish for "finished", which is what the week is once it's in YouTrack.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/finito-dark.png">
  <img src="docs/finito-light.png" alt="Finito: a week of time per issue with a meter in each day's header, a suggested entry drawn dashed, and a glass bar at the bottom holding a running timer.">
</picture>

## What it does

- **One line to log.** `APP-1207 1h30 review copy` in the bar at the bottom, Enter. Leave the time out and Enter starts a timer instead.
- **A week you can type into.** Click a cell, or focus it and type a number. Totals per day fill a small meter toward your daily target; short days turn amber.
- **Suggestions from your activity.** Your comments, field changes, attachments and commits in YouTrack, your meetings and your pull request reviews show up as dashed values: in the week for issues already there, and in a panel under it for the rest. Only a day with no time on that issue yet gets one. Click one to add it, use **Add all**, or dismiss the ones you don't need.
- **Nothing reaches YouTrack until you submit.** Submit appears when there's something to send. It checks first, writes each change, and retries a network failure without creating duplicates.
- **Undo** on every log, from the toast.

## Start

You need [Node.js](https://nodejs.org) 20 or newer (`node -v`). Nothing else: no `npm install`.

```sh
git clone https://github.com/mateuszbartosik/finito.git
cd finito
npm start
```

On Windows you can also double-click `start.cmd`. Finito opens <http://localhost:5178>. Keep its window open while you use it; Ctrl+C stops it.

## Connect YouTrack

1. In YouTrack, open your avatar → **Profile** → **Account Security**.
2. Under **Tokens**, choose **New token…**, name it "Finito", give it the **YouTrack** scope, and copy it.
3. In Finito, enter your YouTrack's address (for example `https://yourcompany.youtrack.cloud`) and paste the token.

## Calendar and GitHub (optional)

Both connect in **Settings → Suggestions from**. Their address and token stay on this computer.

**Calendar.** Paste your calendar's secret address in iCal format:

- Google Calendar: **Settings** → your calendar → **Integrate calendar** → **Secret address in iCal format**. If it's missing, your Workspace admin may have turned it off.
- Outlook: **Settings** → **Calendar** → **Shared calendars** → **Publish a calendar** → the ICS link.

A meeting counts when it's over, has someone besides you, and you didn't decline it. Time you block alone and events marked free count only when their title names an issue; all-day events never do. A meeting goes to the issue its title (or description) names. If it names none, it waits under **Not tied to an issue yet**: **Choose issue** sends it, and every meeting with the same title, to that issue from then on; × stops suggesting it. **Settings** lists these choices, and each can be forgotten.

**GitHub reviews.** Make a token in GitHub → **Settings** → **Developer settings** → **Personal access tokens**: a fine-grained one with read access to pull requests, or a classic one (no scope for public repositories, **repo** for private ones). Give it an expiry date: organizations can refuse tokens that never expire, or that last longer than they allow. If GitHub refuses the token anywhere, Finito says why, in Settings when you connect and under the week, and still counts the rest. Your reviews and comments on pull requests, other people's and your own, become suggestions for the issue the pull request names in its title, description or branch. One without an issue waits under **Not tied to an issue yet**, like a meeting.

**How long.** A meeting counts as scheduled. A review counts from your first to your last comment, rounded up to 15 minutes. Where meetings, reviews and YouTrack activity overlap on an issue, the time counts once. Time from meetings goes in as the project's Meeting or Communication type, and reviews of other people's pull requests as Review, when the project has those types.

## Try it without touching YouTrack

`npm run demo` (or double-click `demo.cmd`) opens <http://localhost:5179> against a fake YouTrack, calendar and GitHub with sample data. It starts fresh every time.

## The bar

| Type | Means |
|---|---|
| `APP-1207` | the issue (any letter case). No ID? Words from the issue's title work when exactly one issue matches. |
| `1h30` `1.5` `90m` `90` `1:30` `9:00-10:30` | the time. Whole numbers up to 12 are hours, bigger ones minutes. No time: Enter starts a timer. |
| `today` `yesterday` `mon` … `sun` `mon-fri` `2026-10-27` | the day (default: today). `mon-fri` makes one work item per day. |
| `#review` | the work type. A unique start is enough (`#rev`). Without it, your default for that project is used. |
| anything else | the note. |

Press `/` anywhere to jump to the bar. A running timer sits at the left end of the bar; click it to stop it at the end of your day, keep it all, or discard it.

## The week

- Click a cell, or focus it and type a number, to edit: time, −/+ 15 minutes, type, note. Enter saves, Tab goes to the next day, ↑ ↓ to the next row, Esc cancels. Arrow keys move between cells.
- A cell can hold more than one entry, say Research and Development on the same day: open it and choose **Add another entry**.
- Hover a row for ▶ (start a timer on it). **Add issue** puts any issue in the week before you log on it. An empty week offers last week's issues.
- Cells: plain = in YouTrack, blue with a dot = not sent yet, struck through = will be removed, red dot = the last send failed (the reason is in the cell's editor), dashed = a suggestion.
- Days off are hidden unless something happened on them.

## Settings

Daily target, work days, end of your day, timer rounding, light or dark theme, and a **default work type per project**. Some projects have no "Design" type, so pick what your usual work goes in as, once. Setting a default also fills drafts that don't have a type yet.

## Look

Controls float on a liquid glass layer over a quiet week. In Chrome and Edge the edges of the glass also bend what's behind them; other browsers get the frosted version. Finito follows your system's light or dark mode unless you pick one in Settings, and its Reduce transparency, Increase contrast and Reduce motion settings.

## Where your data lives

- `data/config.json`: the YouTrack address and your token, and, if you connected them, your calendar's secret address and your GitHub token, all in plain text. **Settings → Change** replaces the YouTrack ones and **Remove** clears the others; deleting the file disconnects Finito. Keep the folder private, and revoke the tokens (and reset the calendar's secret address) if this computer is ever lost.
- `data/state.json`: drafts, edits that aren't submitted yet, the running timer, your settings, and which issue each meeting or pull request goes to. Submitted time lives only in YouTrack.

Both are in `.gitignore`, so they stay out of commits.

## Safety

- Finito listens on 127.0.0.1 only. Its API refuses requests without its own header and checks the Host and Origin, so other web pages can't drive it.
- The tokens and the calendar's address never reach the browser, and Finito won't follow a redirect from https to http with the YouTrack token.
- It writes only your own work items. A create that times out is looked up before it's retried, so it can't land twice.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Port 5178 is already in use" | Finito is probably already running: open <http://localhost:5178>. Or set `FINITO_PORT=5180` before starting. |
| "Couldn't reach …" | Check the address, and your VPN if YouTrack needs one. |
| "YouTrack turned the token down" | Make a new permanent token with the YouTrack scope. |
| No suggestions | A day that already has time on an issue gets no suggestion for it. Suggestions need YouTrack's activity API (2020+); a note under the week shows the error if a request failed. |
| No meetings | Copy the calendar's secret address again; resetting it in your calendar breaks the old one. Only meetings that are over count. |
| "GitHub's hourly limit is used up" | GitHub limits requests per hour. Review suggestions come back within the hour. |
| "The … organization accepts only tokens that expire within … days" | Regenerate the token in GitHub with an expiry date inside that limit, then connect the new one in Settings. |
| Behind a proxy | Node doesn't use the system proxy. Set `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY` (Node 22.21 or newer). |

## Development

- `npm test` runs the parser, calendar, suggestion and API tests against a fake YouTrack (`test/mock-youtrack.js`) and a fake calendar and GitHub (`test/mock-sources.js`). No install needed. CI runs them on Node 20, 22 and 24, and on Windows.
- `server.js` starts `lib/app.js` (routes, storage, submit, timer, suggestions). `lib/youtrack.js` is the REST client, `lib/ics.js` reads calendars (recurring events and time zones included) and `lib/github.js` reads your reviews and comments.
- The UI is `public/app.js` (Preact + htm, vendored in `public/vendor/`, no build step). `public/glass.js` draws the refraction.

## License

[MIT](LICENSE). Finito includes [Preact](https://preactjs.com) (MIT), [htm](https://github.com/developit/htm) (Apache 2.0) and the [Geist](https://vercel.com/font) fonts (SIL Open Font License 1.1); their licenses sit next to them in `public/vendor/` and `public/fonts/`.

Finito is not affiliated with JetBrains. YouTrack is a trademark of JetBrains s.r.o.
