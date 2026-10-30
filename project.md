# mbligh/dashboard — project

## Requirements

- One public GitHub Pages dashboard for the latest run of every GitHub Actions workflow in each public \`mbligh\` repository.
- Auto-discover repositories and workflows. Include inactive and rarely run workflows, not just the most recent runs of each repo.
- Show success, failure, cancellation, running/queued and never-run states. Provide search, filters, time and direct GitHub workflow/run links.
- Use full-width status backgrounds based only on the last COMPLETED run (green success, red failure, yellow other/never completed). Show unfinished runs separately as clickable blue notices, supporting concurrent runs. No status dots.
- Use a red/amber/green traffic-signal SVG favicon.
- Workflow names must open GitHub Actions workflow history (`/actions/workflows/<filename>`), not the YAML source-code page; run-number links open individual runs.
- No client-side GitHub API requests, access tokens, database, or JavaScript build chain.
- Do not publish private repository names or workflow metadata.
- Keep GitHub REST API usage low; provide a path to webhook-driven updates.
- Keep code in this Git repository; deploy automatically on pushes and periodic refreshes.

## Design

- \`scripts/collect\`: Python standard-library collector using the public \`/users/mbligh/repos\` endpoint; exclude dashboard itself to avoid misreporting its self-update. One workflow list and one recent-runs query per repository; fallback GET for each workflow absent from the first 100 runs. All calls happen in GitHub Actions with an optional token; failures stop publication rather than displaying falsely successful or missing data.
- \`site/index.html\`, \`site/style.css\`, \`site/app.js\`: dependency-free responsive dashboard fetching only \`status.json\` from Pages. The browser reloads the file every two minutes only while visible, and on tab focus or manual refresh. An age indicator warns when the snapshot is stale (>45 minutes).
- \`.github/workflows/publish.yml\`: unit tests, collector, GitHub Pages artifact and deployment. Triggered on push, daily at 05:17 UTC, manual dispatch and optional \`repository_dispatch: refresh-dashboard\`.
- No MongoDB Atlas: this is a read-only static snapshot, so a database would add moving parts without a useful benefit.

## Efficiency and future event ingestion

The JSON includes the original latest `run` field plus `last_completed` and `active_runs`. The UI uses only `last_completed` for row color; active-run notices cannot replace the previous result. A webhook backend must retain this schema and reconcile concurrent/out-of-order events.

There is **no GitHub API polling by browsers**; the publisher makes ~2 requests per active public repo once daily plus fallback lookups for seldom-run workflows. GitHub's \`workflow_run\` webhooks offer genuinely event-driven collection via a GitHub App, but a public webhook receiver (e.g. Cloudflare Worker) and authenticated dispatch are necessary because Pages cannot receive inbound events. No receiver is configured in this version. An event trigger is provided for later integration.

## Security

The site is publicly accessible. The collector intentionally uses only publicly listed repositories and does not accept private-repository inclusion via a token. Never put credentials or sensitive API payloads into \`site/\`. Workflow metadata, branch names, and run links from public repositories are published, but no logs or secrets.

## Deployment

A repository administrator must select **Settings → Pages → Build and deployment → GitHub Actions** once. This cannot be set through ordinary code commits. The first push runs the publishing workflow; GitHub Pages deployment succeeds only after Pages is enabled and permitted.

## Limitations

- Snapshot freshness bounded by a daily fallback schedule, plus GitHub Actions scheduling and deployment delay.
- GitHub Actions schedules may be delayed or skipped under heavy GitHub load.
- The dashboard repository's own publishing job is excluded because its final result is not knowable while generating its own snapshot.
- Repository workflow names and run results are public; private repositories are intentionally omitted.
- Workflow run API's most-recent ordering is used; falls back to querying rarely-run workflow individually.
- Static dashboard shows the latest run across all branches, not necessarily the most recent default-branch run.
- GitHub App and Cloudflare Worker + KV are operational. `repository_dispatch` remains an optional compatibility hook.


## Event-driven Cloudflare KV backend (2026-10-29)

Implemented in `worker/src/index.mjs` with `worker/wrangler.jsonc`; see `worker/README.md` for setup. GitHub App's `workflow_run` webhook goes to a Cloudflare Worker, verified using HMAC-SHA256. Each delivery becomes an immutable 72-hour KV entry with compact event metadata (one key per delivery). GET `/status.json` combines the GitHub Pages baseline snapshot with recent KV events, maintaining last-completed and independent active-run state even with out-of-order events. New public workflows/repositories are discovered from events; a scheduled baseline catches never-run and missed events. The UI reads `site/config.json` to choose Worker status URL once configured, otherwise safely defaults to the existing Pages snapshot. Cloudflare deployment and GitHub App creation require one-time user setup. No app private key or DB credentials required. End-to-end webhook delivery was verified using calendar's Hunter paces run #21 on 2026-10-29. The collector schedule was reduced to daily at 05:17 UTC. Free KV list quota 1,000 per day, so browser refresh stays at two minutes initially.


## Per-repository workflow trigger graphs

`site/repo.html?repo=NAME` and `site/repo.js` render native SVG
trigger graphs for public repositories. Each row on the main dashboard
links to its graph. `scripts/graph` fetches repository workflow YAML
from the default branch during baseline publication and extracts `on:`
trigger types, `workflow_run.workflows` cross-workflow chains, local reusable
workflow `jobs.<id>.uses` calls, and literal `gh workflow run FILE` commands.
The data is stored in each workflow's `triggers`, `calls`,
`dispatches` fields in `site/status.json`.

The default graph shows workflow-to-workflow connections only, with a checkbox to opt into external event-source arrows. External events remain visible in workflow details by default; their shared arrows can cross unrelated workflows, so they are not drawn until explicitly requested.

Different arrows distinguish external event triggers, workflow_run
chains, reusable calls, and CLI dispatches. These are static,
declarative possible trigger relationships, not proof of causality.
Internal job-level `needs:` is out of scope. Dynamic dispatches, actions
hidden in nested scripts or other repositories, and events conditional
on scripts are not inferred. Missing/unparseable sources receive
`analysis_error` so the graph can explicitly flag incomplete data.
PyYAML BaseLoader avoids the YAML 1.1 boolean treatment of the key `on`.
The graph refreshes with the daily baseline, while run statuses remain live.


## Live status failure diagnosis (2026-10-30)

The `dashboard.mbligh.org` custom domain uses a different browser Origin from
`mbligh.github.io`. On 2026-10-30 the manually deployed Worker still returned
`Access-Control-Allow-Origin: https://mbligh.github.io` even though the
repository source had already been changed to wildcard CORS. GitHub Actions
diagnostics confirmed that the live Worker did receive Trail2 smoke test run
#52 as `failure` at 11:45 UTC. Browsers on the custom domain rejected the
Worker response and fell back to an older green GitHub Pages baseline.

The site now displays an explicit warning on the dashboard and repository
graphs whenever live status fails, including the snapshot timestamp. The
Worker merge also updates workflow names when a newer webhook arrives (important
for the renamed Trail2 production smoke test workflow). Both the CORS fix and
name update require **manual redeployment of `worker/src/index.mjs` through
Cloudflare's Edit Code interface** because this Worker is not GitHub-deployed.
The webhook secret and KV binding remain unchanged.
