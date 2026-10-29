# Cloudflare setup for mbligh/dashboard

This service receives GitHub App workflow-run webhooks and serves a JSON overlay
for the existing public GitHub Pages dashboard. **Do not switch the browser to
Cloudflare until webhook delivery and the JSON endpoint have been verified.**

Only public \`mbligh\` repositories appear in the dashboard. The receiving Worker
ignores events from private repositories and from \`mbligh/dashboard\`.

## 1. Create a Worker and KV namespace

Use a Cloudflare account (Free is sufficient for light personal use) and a
machine with Node.js and \`npm\`. Clone the repository, then:

\`\`\`sh
git clone https://github.com/mbligh/dashboard.git
cd dashboard/worker
npx wrangler@latest login
npx wrangler@latest kv namespace create STATUS_EVENTS
\`\`\`

Copy the namespace ID that Wrangler prints into \`worker/wrangler.jsonc\`,
replacing \`REPLACE_WITH_KV_NAMESPACE_ID\`. Keep binding name
**\`STATUS_EVENTS\`**. The namespace ID is not a secret; commit this config so
future deployments use the same namespace:

\`\`\`sh
git add wrangler.jsonc
git commit -m "Configure dashboard KV namespace"
git push
\`\`\`

Then deploy:

\`\`\`sh
npx wrangler@latest deploy
\`\`\`

Wrangler prints a public URL similar to
\`https://mbligh-actions-status.YOUR-SUBDOMAIN.workers.dev\`.

Check \`https://mbligh-actions-status.YOUR-SUBDOMAIN.workers.dev/health\`;
it should return \`{"ok":true}\`.

## 2. Create the shared webhook secret

Generate a random secret locally:

\`\`\`sh
openssl rand -hex 32
\`\`\`

Keep it private. In \`dashboard/worker\` run:

\`\`\`sh
npx wrangler@latest secret put GITHUB_WEBHOOK_SECRET
\`\`\`

Paste the random value when prompted. It will also be entered into the GitHub
App's *Webhook secret* field. **Never commit it or share it in ChatGPT.**

## 3. Create and install the GitHub App

At https://github.com/settings/apps choose **New GitHub App**.

- Name: e.g. \`mbligh-actions-dashboard\` (must be globally unique).
- Homepage URL: \`https://mbligh.github.io/dashboard/\`.
- Webhook: Active.
- Webhook URL: \`https://mbligh-actions-status.YOUR-SUBDOMAIN.workers.dev/github-webhook\`.
- Webhook secret: the value from step 2.
- Repository permissions: **Actions → Read-only**. Metadata → Read-only
  is granted by GitHub automatically. No Contents write access needed.
- Subscribe to events: **Workflow run** (request, in progress, completion).
- Installation scope: \`Only on this account\` if available.

Save the App, then open its **Install App** tab and install it on **All
repositories** under \`mbligh\`. The Worker filters private repos before
writing any data. Newly created repositories will also be covered.

Check the App's **Advanced → Recent deliveries** (the label can vary).
GitHub's \`ping\` delivery should show HTTP 200, and a subsequent
\`workflow_run\` delivery should return 202.

No GitHub App private key is necessary: the Worker verifies
\`X-Hub-Signature-256\` with the shared secret. The App does not call the
GitHub API from the Worker.

## 4. Verify the status endpoint and activate the UI

Open \`https://mbligh-actions-status.YOUR-SUBDOMAIN.workers.dev/status.json\`.
It should return JSON with \`repositories\`, \`generated_at\`,
\`base_generated_at\`, and \`status_source: "webhook-kv"\`.

After checking a real workflow event has been received, edit
\`site/config.json\` in the repository to:

\`\`\`json
{
  "status_url": "https://mbligh-actions-status.YOUR-SUBDOMAIN.workers.dev/status.json"
}
\`\`\`

Commit the change. GitHub Actions republishes the Pages HTML; the browser now
reads the Worker JSON. If the Worker is down, revert \`status_url\` to
\`null\` and republish. The original Pages snapshot remains available.

## 5. Reduce collection frequency *after* proving events work

Initially the original \`.github/workflows/publish.yml\` schedule is deliberately
unchanged (every 15 minutes). It provides an inventory baseline and fallback.
Once live event delivery has been demonstrated, reduce that schedule to once
every few hours or once per day. That reconciles missed webhooks and workflows
that have never run. Do not remove the baseline job entirely.

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

\`\`\`sh
npx wrangler@latest tail
\`\`\`

Check the GitHub App's Recent deliveries, the Worker's HTTP response, and
\`/status.json\`. Do not expose the webhook secret or full signed payloads in
logs. Worker source is under \`worker/src/index.mjs\`; tests run with:

\`\`\`sh
node --test worker/test/*.test.mjs
\`\`\`

from the repository root.
