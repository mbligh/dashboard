// GitHub App webhook -> Cloudflare KV -> dashboard JSON.
const BASE = "https://mbligh.github.io/dashboard/status.json";
const ORIGIN = "https://mbligh.github.io";
function response(data, status = 200) {
  return Response.json(data, {status, headers: {
    "Access-Control-Allow-Origin": ORIGIN, "Cache-Control": "no-store", "Vary": "Origin",
  }});
}
const timestamp = (r, completed = false) => Date.parse((completed && r.updated_at) || r.created_at || "") || 0;
function newest(runs, done = false) {
  return runs.reduce((best, r) => !best || timestamp(r, done) > timestamp(best, done) ||
    (timestamp(r, done) === timestamp(best, done) && r.id > best.id) ? r : best, null);
}
function prefer(a, b) {
  if (!a) return b;
  if (a.status === "completed" && b.status !== "completed") return a;
  if (b.status === "completed" && a.status !== "completed") return b;
  if ((a.attempt || 1) !== (b.attempt || 1)) return (a.attempt || 1) > (b.attempt || 1) ? a : b;
  return timestamp(b, true) >= timestamp(a, true) ? b : a;
}
function url(repo, path, id) {
  const m = /^\.github\/workflows\/([^/]+\.(yml|yaml))$/.exec(path || "");
  return repo + "/actions/workflows/" + (m ? encodeURIComponent(m[1]) : id);
}
export function eventFromPayload(p) {
  const repo = p.repository, run = p.workflow_run;
  if (!repo || !run || repo.private || repo.owner?.login?.toLowerCase() !== "mbligh" ||
      repo.name?.toLowerCase() === "dashboard" || !Number.isSafeInteger(run.workflow_id) ||
      !Number.isSafeInteger(run.id)) return null;
  return {
    repo: repo.name, repo_url: "https://github.com/mbligh/" + repo.name,
    workflow_id: run.workflow_id, workflow_name: p.workflow?.name || run.name || String(run.workflow_id),
    workflow_path: p.workflow?.path || run.path || null,
    received_at: new Date().toISOString(),
    run: {
      id: run.id, url: run.html_url, status: run.status, conclusion: run.conclusion || null,
      created_at: run.created_at || null, updated_at: run.updated_at || null,
      started_at: run.run_started_at || null, branch: run.head_branch || null,
      event: run.event || null, attempt: run.run_attempt || 1, number: run.run_number || null,
    },
  };
}
export function mergeSnapshot(base, events) {
  const out = structuredClone(base);
  const repositories = new Map(out.repositories.map(r => [r.name, r]));
  const touched = new Map();
  for (const e of events) {
    if (!e || !e.repo || !e.run || !Number.isSafeInteger(e.workflow_id)) continue;
    let repo = repositories.get(e.repo);
    if (!repo) {
      repo = {name:e.repo,url:e.repo_url,archived:false,workflows:[]};
      out.repositories.push(repo); repositories.set(repo.name,repo);
    }
    let wf = repo.workflows.find(w => w.id === e.workflow_id);
    if (!wf) {
      wf = {id:e.workflow_id,name:e.workflow_name,path:e.workflow_path,state:"active",
        url:url(repo.url,e.workflow_path,e.workflow_id),run:null,last_completed:null,active_runs:[]};
      repo.workflows.push(wf);
    }
    let runs = touched.get(wf);
    if (!runs) {
      runs = new Map();
      for (const r of [wf.run,wf.last_completed,...(wf.active_runs || [])].filter(Boolean)) {
        runs.set(r.id,prefer(runs.get(r.id),r));
      }
      touched.set(wf,runs);
    }
    runs.set(e.run.id,prefer(runs.get(e.run.id),e.run));
  }
  for (const [wf,runs] of touched) {
    const all = [...runs.values()];
    wf.run = newest(all);
    wf.last_completed = newest(all.filter(r => r.status === "completed"),true);
    wf.active_runs = all.filter(r => r.status !== "completed")
      .sort((a,b) => timestamp(b)-timestamp(a));
  }
  for (const repo of out.repositories) repo.workflows.sort((a,b) => a.name.localeCompare(b.name));
  out.repositories.sort((a,b) => a.name.localeCompare(b.name));
  out.base_generated_at = base.generated_at;
  out.last_event_at = events.reduce((x,e) => x > (e.received_at || "") ? x : (e.received_at || ""), "") || null;
  out.generated_at = new Date().toISOString();
  out.status_source = "webhook-kv";
  return out;
}
async function authorized(body, signature, secret) {
  if (!secret || !/^sha256=[0-9a-f]{64}$/i.test(signature || "")) return false;
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const bytes = Uint8Array.from(signature.slice(7).match(/../g).map(s => parseInt(s,16)));
  return crypto.subtle.verify("HMAC",key,bytes,body);
}
async function webhook(req,env) {
  if (!env.GITHUB_WEBHOOK_SECRET || !env.STATUS_EVENTS) return response({error:"Not configured"},503);
  const body = await req.arrayBuffer();
  if (!await authorized(body,req.headers.get("X-Hub-Signature-256"),env.GITHUB_WEBHOOK_SECRET))
    return response({error:"Invalid signature"},401);
  const kind = req.headers.get("X-GitHub-Event");
  if (kind === "ping") return response({ok:true,event:"ping"});
  if (kind !== "workflow_run") return response({ignored:true});
  const payload = JSON.parse(new TextDecoder().decode(body));
  if (!["requested","in_progress","completed"].includes(payload.action)) return response({ignored:true});
  const event = eventFromPayload(payload);
  if (!event) return response({ignored:true});
  if (new TextEncoder().encode(JSON.stringify(event)).length > 1024)
    return response({error:"Event metadata too long"},422);
  // One immutable key per DELIVERY, never a shared workflow key:
  // multiple concurrent runs cannot overwrite one another.
  await env.STATUS_EVENTS.put("event:"+crypto.randomUUID(),"",{
    expirationTtl:3*86400,metadata:event,
  });
  return response({ok:true},202);
}
async function getEvents(kv) {
  const events = [];
  let cursor;
  do {
    const page = await kv.list({prefix:"event:",limit:1000,...(cursor ? {cursor} : {})});
    for (const item of page.keys) if (item.metadata) events.push(item.metadata);
    if (page.list_complete) return events;
    cursor=page.cursor;
    if (!cursor || events.length >= 10000) throw Error("Event-list limit exceeded");
  } while (true);
}
async function status(env) {
  if (!env.STATUS_EVENTS) return response({error:"KV not bound"},503);
  const upstream=await fetch(BASE,{cf:{cacheTtl:300,cacheEverything:true}});
  if (!upstream.ok) return response({error:"Baseline unavailable"},503);
  const base=await upstream.json();
  if (!Array.isArray(base.repositories)) return response({error:"Invalid baseline"},503);
  return response(mergeSnapshot(base,await getEvents(env.STATUS_EVENTS)));
}
export default {
  async fetch(req,env) {
    const pathname=new URL(req.url).pathname;
    try {
      if (req.method === "GET" && pathname === "/status.json") return await status(env);
      if (req.method === "POST" && pathname === "/github-webhook") return await webhook(req,env);
      if (req.method === "GET" && pathname === "/health") return response({ok:true});
      return response({error:"Not found"},404);
    } catch (error) {
      console.error("Dashboard webhook worker:",error);
      return response({error:"Internal error"},500);
    }
  },
};
