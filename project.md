# mbligh/dashboard — project

## Requirements

- One public GitHub Pages dashboard for the latest run of every GitHub Actions workflow in each public \`mbligh\` repository.
- Auto-discover repositories and workflows. Include inactive and rarely run workflows, not just the most recent runs of each repo.
- Show success, failure, cancellation, running/queued and never-run states. Provide search, filters, time and direct GitHub workflow/run links.
- Workflow names must open GitHub Actions workflow history (`/actions/workflows/<filename>`), not the YAML source-code page; run-number links open individual runs.
- No client-side GitHub API requests, access tokens, database, or JavaScript build chain.
- Do not publish private repository names or workflow metadata.
- Keep GitHub REST API usage low; provide a path to webhook-driven updates.
- Keep code in this Git repository; deploy automatically on pushes and periodic refreshes.

## Design

- \`scripts/collect\`: Python standard-library collector using the public \`/users/mbligh/repos\` endpoint; exclude dashboard itself to avoid misreporting its self-update. One workflow list and one recent-runs query per repository; fallback GET for each workflow absent from the first 100 runs. All calls happen in GitHub Actions with an optional token; failures stop publication rather than displaying falsely successful or missing data.
- \`site/index.html\`, \`site/style.css\`, \`site/app.js\`: dependency-free responsive dashboard fetching only \`status.json\` from Pages. The browser reloads the file every two minutes only while visible, and on tab focus or manual refresh. An age indicator warns when the snapshot is stale (>45 minutes).
- \`.github/workflows/publish.yml\`: unit tests, collector, GitHub Pages artifact and deployment. Triggered on push, every 15 minutes (offset from the hour), manual dispatch and optional \`repository_dispatch: refresh-dashboard\`.
- No MongoDB Atlas: this is a read-only static snapshot, so a database would add moving parts without a useful benefit.

## Efficiency and future event ingestion

There is **no GitHub API polling by browsers**; the publisher makes ~2 requests per active public repo every 15 minutes plus fallback lookups for seldom-run workflows. GitHub's \`workflow_run\` webhooks offer genuinely event-driven collection via a GitHub App, but a public webhook receiver (e.g. Cloudflare Worker) and authenticated dispatch are necessary because Pages cannot receive inbound events. No receiver is configured in this version. An event trigger is provided for later integration.

## Security

The site is publicly accessible. The collector intentionally uses only publicly listed repositories and does not accept private-repository inclusion via a token. Never put credentials or sensitive API payloads into \`site/\`. Workflow metadata, branch names, and run links from public repositories are published, but no logs or secrets.

## Deployment

A repository administrator must select **Settings → Pages → Build and deployment → GitHub Actions** once. This cannot be set through ordinary code commits. The first push runs the publishing workflow; GitHub Pages deployment succeeds only after Pages is enabled and permitted.

## Limitations

- Snapshot freshness bounded by a roughly 15-minute schedule, plus GitHub Actions scheduling and deployment delay.
- GitHub Actions schedules may be delayed or skipped under heavy GitHub load.
- The dashboard repository's own publishing job is excluded because its final result is not knowable while generating its own snapshot.
- Repository workflow names and run results are public; private repositories are intentionally omitted.
- Workflow run API's most-recent ordering is used; falls back to querying rarely-run workflow individually.
- Static dashboard shows the latest run across all branches, not necessarily the most recent default-branch run.
- GitHub App/webhook receiver not yet configured; \`repository_dispatch\` support is only a hook for that integration.
