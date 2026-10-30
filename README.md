# Actions dashboard

Dashboard showing the latest GitHub Actions run **per workflow** for all public repositories owned by [mbligh](https://github.com/mbligh).

**Site (after Pages is enabled):** https://mbligh.github.io/dashboard/

## Enable GitHub Pages (one-time)

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Run **Actions → Publish Actions Dashboard → Run workflow**, or push to \`main\`.
4. Open https://mbligh.github.io/dashboard/ after deployment succeeds.

Row color reflects the latest **completed** run only. Newer or concurrent running/queued runs appear as separate clickable blue notices without replacing the completed result. The running summary counts workflows with active runs separately from completed outcomes.

The site refreshes its static JSON snapshot every two minutes while the tab is visible; it **never queries the GitHub API from the browser**. The collection workflow refreshes the baseline snapshot daily, on changes to this repository, or manually. The live dashboard normally gets changes through GitHub App webhooks and Cloudflare KV.

The publisher discovers the owner's public repositories automatically (including newly created ones). For each repository, it lists the workflows and fetches the most recent 100 runs in one request. Any workflow not represented in those runs gets a one-run fallback lookup. This catches rarely executed workflows and disabled workflows; no per-workflow polling is done for the usual case.

### Credentials and privacy

No secret or extra account is required. The built-in \`GITHUB_TOKEN\` is used for public GitHub API reads. An optional repository secret, \`DASHBOARD_READ_TOKEN\`, can supply a dedicated fine-grained token with **Actions: read** permission if needed for rate limits.

**This is a public site.** The collector intentionally calls \`/users/mbligh/repos\`, excludes private repos even if authenticated, and does not include the dashboard's own publisher workflow. The currently executing publisher would otherwise always appear running and never display a completed current state in its own snapshot. No token is ever sent to the browser or included in the generated JSON.

### Event-driven updates

GitHub Pages has no server to receive webhook events. The workflow already accepts \`repository_dispatch\` event type \`refresh-dashboard\` for future integrations, but **no webhook receiver is deployed**.

For push-based updates, install a GitHub App subscribed to \`workflow_run\` events on the monitored repositories and run a small webhook receiver (for example, a Cloudflare Worker). The receiver should verify the webhook HMAC signature and send a GitHub \`repository_dispatch\` to this repository when a monitored run is requested/in progress/completed. That removes the need for a frequent scheduled collection, although each dispatch still starts a Pages deployment. Keep the schedule as a fallback or reduce it once the webhook integration is operating.

Do **not** expose any repository dispatch credential or webhook secret in the public Pages site. Configuring GitHub App webhooks and a receiving endpoint is a separate setup task.

### Run locally

\`\`\`sh
python3 -m unittest discover -s tests -v
python3 scripts/collect --owner mbligh --output site/status.json
python3 -m http.server --directory site 8000
\`\`\`

Visit http://localhost:8000/. Unauthenticated GitHub API requests have lower rate limits; supply \`GITHUB_TOKEN\` or \`DASHBOARD_READ_TOKEN\` in the environment when running locally if needed.

See [project.md](project.md) for the architecture, limitations, and operating notes.


## Optional live webhook backend

GitHub App `mbligh-dashboard` and a Cloudflare Worker + KV integration are active. The Worker endpoint is configured in `site/config.json` with automatic Pages fallback. An end-to-end test confirmed a new `calendar` workflow run appeared via KV before the baseline was regenerated. The Pages baseline now reconciles daily at 05:17 UTC, as well as on repository push/manual dispatch. No individual workflow YAML modifications are required. See [worker/README.md](worker/README.md) for setup and diagnostics.


## Repository trigger graphs

Each repository heading has a **Trigger graph** link, e.g.
[`mapping`](https://dashboard.mbligh.org/repo.html?repo=mapping).
These are dynamically rendered static subpages (`site/repo.html?repo=NAME`) and
work on both the GitHub Pages project URL and the custom domain.

The daily collector now fetches each public workflow's source YAML and
annotates the published snapshot with declared `on:` events, including
`workflow_run.workflows` relationships (directed arrows between workflows).
By default the graph **only draws workflow-to-workflow arrows**; shared external triggers (push, schedule, release, manual) are shown in the textual details and can be optionally enabled with the **Show external event triggers** checkbox. This avoids gray event-source arrows crossing unrelated workflow nodes and appearing to be dependencies.

The graph also distinguishes `jobs.<name>.uses: ./.github/workflows/...`
reusable-workflow calls (dashed purple) and literal `gh workflow run FILE`
dispatch commands (dashed amber). Push, schedule, release, manual,
repository_dispatch, etc. appear as external source nodes. Workflow names
link to their GitHub Actions pages, with a textual trigger breakdown underneath.

These graphs show **configured possible triggers**, not actual causal
connections between particular runs. Workflow-level conditions and filters
can suppress execution, and dispatches hidden in scripts, APIs, or dynamically
computed workflow filenames cannot always be inferred. Internal job
`needs:` edges are intentionally excluded. Unknown/unsupported workflow
source files are visibly marked, not silently represented as untriggered.

The metadata is refreshed on each baseline publication (daily, on dashboard
pushes, or manual refresh); status changes still arrive through the
GitHub App and Cloudflare KV without rebuilding Pages. The YAML analysis
uses Python PyYAML rather than adding JavaScript frontend dependencies.
