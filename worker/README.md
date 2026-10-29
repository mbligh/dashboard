# Cloudflare setup for mbligh/dashboard

This service receives GitHub App workflow-run webhooks and serves a JSON overlay
for the existing public GitHub Pages dashboard. **Do not switch the browser to
Cloudflare until webhook delivery and the JSON endpoint have been verified.**

Only public `mbligh` repositories appear in the dashboard. The receiving Worker
ignores events from private repositories and from `mbligh/dashboard`.

## 1. Create a Worker and KV namespace (no npm required)

The **Cloudflare dashboard is the recommended deployment method**, especially
on Debian 13: Debian supplies Node.js 20 but newer Wrangler CLI releases
require Node.js 22 or later. The Worker runs on Cloudflare, so there is no
need to install Node.js or Wrangler locally.

1. Open https://dash.cloudflare.com/ and visit **Workers & Pages → KV**.
2. Create a KV namespace named `dashboard-status` if one does not exist.
3. Visit **Workers & Pages → Create → Worker**, choose a simple Hello World
   starter and create the Worker named `mbligh-actions-status`.
4. Open the Worker's **Edit Code** editor. Replace the starter code with the
   entire contents of [src/index.mjs](src/index.mjs) and select **Deploy**.
5. Open the Worker's **Bindings → Add binding → KV namespace**.
   Set the binding name to **`STATUS_EVENTS`** and select
   the `dashboard-status` KV namespace. Save/deploy the binding.
6. Open your assigned `workers.dev` URL with `/health` appended.
   It should return `{"ok":true}`.

A Cloudflare-owned `workers.dev` URL is sufficient. No custom domain,
GitHub repository modification or command-line tools are necessary.

`worker/wrangler.jsonc` remains available for optional automated deployment;
its namespace ID placeholder is **only for Wrangler** and does not have to
be edited when using the browser interface.

## 2. Create the shared webhook secret

Generate a random shared secret locally:

```sh
openssl rand -hex 32
```

In the Cloudflare dashboard open the Worker, then **Settings → Variables and
Secrets → Add**. Enter `GITHUB_WEBHOOK_SECRET` as the name, choose
**Secret** (not plaintext), paste the generated secret, and deploy the setting.

Enter the **same** secret in the GitHub App's *Webhook secret* field in step 3.
Never commit the value, put it in a URL, or paste it into a chat.

## 3. Create and install the GitHub App

At https://github.com/settings/apps choose **New GitHub App**.

- Name: e.g. `mbligh-actions-dashboard` (must be globally unique).
- Homepage URL: `https://mbligh.github.io/dashboard/`.
- Webhook: Active.
- Webhook URL: `https://mbligh-actions-status.YOUR-SUBDOMAIN.workers.dev/github-webhook`.
- Webhook secret: the value from step 2.
- Repository permissions: **Actions → Read-only**. Metadata → Read-only
  is granted by GitHub automatically. No Contents write access needed.
- Subscribe to events: **Workflow run** (request, in progress, completion).
- Installation scope: `Only on this account` if available.

Save the App, then open its **Install App** tab and install it on **All
repositories** under `mbligh`. The Worker filters private repos before
writing any data. Newly created repositories will also be covered.

Check the App's **Advanced → Recent deliveries** (the label can vary).
GitHub's `ping` delivery should show HTTP 200, and a subsequent
`workflow_run` delivery should return 202.

No GitHub App private key is necessary: the Worker verifies
`X-Hub-Signature-256` with the shared secret. The App does not call the
GitHub API from the Worker.

## 4. Verify the status endpoint and activate the UI

Open `https://mbligh-actions-status.YOUR-SUBDOMAIN.workers.dev/status.json`.
It should return JSON with `repositories`, `generated_at`,
`base_generated_at`, and `status_source: "webhook-kv"`.

The public Worker URL has been configured in `site/config.json` as
`https://mbligh-actions-status.mbligh.workers.dev/status.json`.
The dashboard attempts to load it first, then automatically falls back to
the original Pages JSON if the Worker is unreachable or returns invalid data.
The header displays **Pages fallback** when the live endpoint is unavailable.

GitHub webhook reception is not verified merely by successful Pages deployment:
use GitHub App Recent Deliveries to confirm `workflow_run` events return 202.

## Custom GitHub Pages domain

For `dashboard.mbligh.org`, configure
[GitHub repository Pages settings](https://github.com/mbligh/dashboard/settings/pages)
→ **Custom domain** as `dashboard.mbligh.org`.
The DNS CNAME for `dashboard` should point to `mbligh.github.io`
(no path suffix); after GitHub provisions its TLS certificate, turn on
**Enforce HTTPS**. Pages is deployed through GitHub Actions, so no CNAME file
is needed in this repository.

The public Worker status endpoint must allow browser access from the
custom domain (CORS). The source in `src/index.mjs` permits all origins
(`Access-Control-Allow-Origin: *`) because the status API is unauthenticated,
public JSON. This does **not** bypass HMAC validation on the webhook POST.
**If the Worker was manually installed via Cloudflare's Edit Code UI, deploy
the latest `src/index.mjs` there as well; GitHub source commits do not
automatically update the Worker.**

The Worker baseline still reads GitHub's original Pages URL, which GitHub
redirects to the configured custom domain.

## 5. Reduce collection frequency *after* proving events work

The `.github/workflows/publish.yml` schedule provides a daily inventory
baseline and fallback (also runs on dashboard repo pushes or manual dispatch).
Live event delivery has been confirmed: calendar's Hunter paces run #21
appeared in the Worker status response before the Pages baseline changed.
The schedule has been reduced to once daily at 05:17 UTC. This reconciles
missed webhooks and discovers workflows that have never run.

## Status semantics

- Main row color: latest **completed** run (success/failure/etc.).
- Separate blue label: one or more queued/running runs, even when a completed
  run exists.
- The Worker stores one immutable KV entry per webhook delivery. This avoids
  lost updates when workflows run concurrently and tolerates out-of-order
  GitHub events (a completed run is never reopened by an older active event).
- KV entries expire after 72 hours. The Pages baseline is reconciled regularly
  and the Worker merges recent events over it.
- New repositories and workflows are added when a run event arrives; the
  baseline scan also discovers workflows that have never run.

## Free-tier considerations

Cloudflare KV Free currently allows 1,000 writes/day and **1,000 list
operations/day**. The dashboard uses one or more list operations for a status
read, rather than a separate KV read for every workflow. One visible browser tab
polling every two minutes generates at most roughly 720 list requests/day,
plus page opens/focus changes. Several open tabs or lots of visitors could exceed
the free allowance; the endpoint can be cached or browser polling reduced if
necessary. KV's eventual consistency also means events may take up to a minute
to become visible globally.

At this scale, there is no reason to introduce a MongoDB database, separate
GitHub repository webhook configuration, or repository write permissions.

## Diagnostics

Use **Workers & Pages → your Worker → Observability / Logs** in the
Cloudflare dashboard to inspect requests and failures. Wrangler is
not required.

Check the GitHub App's Recent deliveries, the Worker's HTTP response, and
`/status.json`. Do not expose the webhook secret or full signed payloads in
logs. Worker source is under `worker/src/index.mjs`; tests run in
the GitHub Actions publication workflow. Local Node.js is not required.

