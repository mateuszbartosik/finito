# Tracker interface (sketch)

Goal: Finito talks to "a tracker", not to YouTrack. YouTrack becomes the first adapter, Jira the second. The week, the bar, drafts, submit, GitHub and calendar suggestions stay as they are.

## 1. Shapes the app sees

Every adapter returns these. No `idReadable`, `shortName`, `duration.minutes` or millisecond dates past the adapter.

```js
/** @typedef {{ key: string, name: string, dbId: string }} Project      // key: "APP"
/** @typedef {{ key: string, dbId: string, title: string, resolved: boolean,
 *              project: Project|null, url: string }} Issue              // key: "APP-1207"
/** @typedef {{ id: string, name: string }} WorkType
/** @typedef {{ id: string, issue: Issue, date: string,                  // "2026-11-03", local day
 *              minutes: number, type: WorkType|null, note: string }} WorkItem
/** @typedef {{ at: number, issueKey: string,
 *              kind: 'comment'|'field'|'attachment'|'created'|'commit'|'state',
 *              label: string, url: string }} Activity
```

## 2. The interface

```js
class Tracker {
  static id = 'youtrack';            // stored in config
  static label = 'YouTrack';         // used in every message: "Connect YouTrack first."
  static issueKey = /\b[A-Z][A-Z0-9_]+-\d+\b/i;

  // Fields the connect form shows. YouTrack: url + token. Jira Cloud: url + email + token.
  static credentials = [{ name: 'url' }, { name: 'token', secret: true }];

  // Replaces probeYouTrack(). Throws TrackerError with a human message.
  static async connect(creds) {}     // -> { base, user: { id, login, name } }

  capabilities = {
    workTypes: true,                 // Jira: false
    activity: true,                  // Jira: false in v1
  };

  me() {}                            // -> user
  getIssue(key) {}                   // -> Issue (404 -> TrackerError status 404)
  searchIssues(text, limit) {}       // free text, adapter builds its own query
  myOpenIssues(limit) {}             // replaces the 3 hardcoded "for: me #Unresolved ..." queries
  projectKeys() {}                   // -> Set<string>, tells APP-12 apart from UTF-8

  workItems(fromDate, toDate) {}     // mine, inclusive, local days
  issueWorkItems(issue) {}           // used by findLanded() to avoid duplicates on retry
  createWorkItem(issue, { date, minutes, type, note }) {}
  updateWorkItem(issue, id, patch) {}
  deleteWorkItem(issue, id) {}

  workTypes(project) {}              // -> { enabled, types: WorkType[] }; [] if unsupported
  activities(fromMs, toMs) {}        // -> Activity[]; [] if unsupported
}

class TrackerError extends Error { status; transient; }   // today's YouTrackError, renamed
```

`app.js` gets one `tracker()` instead of `client()` and only calls these methods.

## 3. Where YouTrack leaks today

| Leak | Where | Fix |
|---|---|---|
| Raw fields (`idReadable`, `shortName`, `duration.minutes`, `item.date`) | ~28 places in `app.js`, 4 in `suggest.js` | Use the shapes above. `slimIssue()` and `ytEntry()` move into the adapter. |
| YouTrack query language | `/api/issues/search`, `/api/issues/mine`, empty-week fallback | `myOpenIssues()` / `searchIssues()` |
| "Day is midnight UTC" | `D.dateFromWorkItemMs`, `D.utcMidnightMs` | Adapter converts. App only sees `"YYYY-MM-DD"`. |
| Activity field strings and the try-richer-first variants | `/api/suggestions` route, `TARGET_FIELDS` | Whole block moves to `YouTrack.activities()`. Route just calls it. |
| `issueOf()` reading `target.idReadable` | `suggest.js` | Takes `Activity` with `issueKey`. |
| "YouTrack" in messages | ~10 error strings | `${Tracker.label}` |
| Config `youtrackUrl`, `token` | `config`, settings UI | `{ tracker: 'youtrack', creds: {...} }`, read the old keys once and migrate. |
| `ytId` on entries | drafts, edits, deletions | Rename to `itemId`. Cosmetic, can wait. |

`typeDefaults` keyed by project short name works as-is with `project.key`.

## 4. Jira adapter notes

| Method | Jira Cloud (REST v3) |
|---|---|
| `connect` | `GET /rest/api/3/myself`, Basic auth `email:apiToken`. Data Center uses a PAT as Bearer, so it's a second credentials variant. |
| `getIssue` | `GET /rest/api/3/issue/{key}?fields=summary,resolution,project` |
| `searchIssues` / `myOpenIssues` | `POST /rest/api/3/search/jql`. Mine: `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`. Text: `text ~ "..."` |
| `workItems` | **Hardest part.** No "my worklogs this week" endpoint. JQL `worklogAuthor = currentUser() AND worklogDate >= from AND worklogDate <= to`, then `GET /issue/{key}/worklog` per issue, filter by author and `started`. N+1 calls, so cache per week. |
| `create` / `update` / `delete` | `POST`, `PUT`, `DELETE /rest/api/3/issue/{key}/worklog[/{id}]`. Body: `started` (datetime with offset, use 09:00 local), `timeSpentSeconds`, `comment` in ADF (wrap the note in one paragraph node). |
| `workTypes` | None natively (Tempo adds its own). `capabilities.workTypes = false`. |
| `activities` | v1: none. GitHub and calendar suggestions still work, which is the part that matters. Later: comments + changelog via `expand=changelog`. |
| `projectKeys` | `GET /rest/api/3/project/search` |
| Issue key pattern | Same as YouTrack, so meeting and PR matching ports for free. |

## 5. UI when `workTypes` is false

- Hide the type field in the cell editor and the type defaults in Settings.
- `#review` in the bar: hint "Jira has no work types" instead of an error.
- Meeting and Review hints from suggestions: put them at the start of the note ("Meeting: Sprint planning") so the information isn't lost.

## 6. Order of work

1. Normalize inside `youtrack.js`: return the shapes above, move `slimIssue`, `ytEntry` and date conversion in. Update `app.js` and `suggest.js` call sites. No behavior change; `api.test.js` against `mock-youtrack.js` is the safety net.
2. Move queries and the activity block into the adapter. Rename `YouTrackError` to `TrackerError`.
3. Config migration plus `credentials`-driven connect form.
4. Capability flags in the UI.
5. `jira.js` plus `test/mock-jira.js`, and a Jira flavour of `npm run demo`.

Rough size: steps 1 to 4 touch maybe 80 to 100 lines of `app.js` and grow `youtrack.js` to ~250. The Jira adapter is ~250 to 300 lines plus its mock. A few focused evenings, with the week-items N+1 being the only real unknown.
