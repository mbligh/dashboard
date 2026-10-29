import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import worker, {eventFromPayload,mergeSnapshot} from "../src/index.mjs";

const repoUrl="https://github.com/mbligh/demo";
function run(id,status,conclusion=null,created="2026-10-27T10:00:00Z") {
  return {id,url:repoUrl+"/actions/runs/"+id,status,conclusion,created_at:created,
    updated_at:created,branch:"main",number:id,attempt:1};
}
const baseline={
  owner:"mbligh",generated_at:"2026-10-27T10:00:00Z",
  repositories:[{name:"demo",url:repoUrl,workflows:[{
    id:7,name:"CI",url:repoUrl+"/actions/workflows/build.yml",state:"active",
    run:run(1,"completed","failure"),last_completed:run(1,"completed","failure"),active_runs:[],
  }]}],
};
function event(r,workflow=7,name="CI",repo="demo") {
  return {repo,repo_url:"https://github.com/mbligh/"+repo,
    workflow_id:workflow,workflow_name:name,workflow_path:".github/workflows/build.yml",
    received_at:r.updated_at,run:r};
}

test("active run does not overwrite last completed result",() => {
  const active=run(2,"in_progress",null,"2026-10-28T11:00:00Z");
  const data=mergeSnapshot(baseline,[event(active)]);
  const wf=data.repositories[0].workflows[0];
  assert.equal(wf.last_completed.id,1);
  assert.equal(wf.last_completed.conclusion,"failure");
  assert.deepEqual(wf.active_runs.map(r=>r.id),[2]);
  assert.equal(wf.run.id,2);
});

test("out-of-order event does not revive completed run",() => {
  const time="2026-10-28T11:00:00Z";
  const active=run(2,"in_progress",null,time);
  const complete=run(2,"completed","success",time);
  const wf=mergeSnapshot(baseline,[event(complete),event(active)]).repositories[0].workflows[0];
  assert.equal(wf.last_completed.id,2);
  assert.equal(wf.last_completed.conclusion,"success");
  assert.deepEqual(wf.active_runs,[]);
});

test("concurrent active runs survive and newly discovered workflows appear",() => {
  const a=run(3,"queued",null,"2026-10-28T12:00:00Z");
  const b=run(4,"in_progress",null,"2026-10-28T13:00:00Z");
  const c=run(5,"in_progress",null,"2026-10-28T14:00:00Z");
  const data=mergeSnapshot(baseline,[event(a),event(b),event(c,50,"New CI","other")]);
  const wf=data.repositories.find(r=>r.name==="demo").workflows[0];
  assert.deepEqual(wf.active_runs.map(r=>r.id),[4,3]);
  assert.equal(wf.last_completed.id,1);
  const created=data.repositories.find(r=>r.name==="other").workflows[0];
  assert.equal(created.id,50);
  assert.equal(created.run.id,5);
  assert.equal(created.last_completed,null);
  assert.equal(created.url,"https://github.com/mbligh/other/actions/workflows/build.yml");
});

test("ignore private repositories and dashboard self-events",() => {
  const p={repository:{name:"demo",private:false,owner:{login:"mbligh"}},
    workflow_run:{id:123,workflow_id:3,html_url:repoUrl+"/actions/runs/123",status:"completed"}};
  assert.equal(eventFromPayload({...p,repository:{...p.repository,private:true}}),null);
  assert.equal(eventFromPayload({...p,repository:{...p.repository,name:"dashboard"}}),null);
  assert.equal(eventFromPayload({...p,repository:{...p.repository,owner:{login:"different"}}}),null);
  assert.equal(eventFromPayload(p).workflow_id,3);
});

test("webhook signatures are required before KV writes",async () => {
  const payload={action:"completed",repository:{name:"demo",private:false,owner:{login:"mbligh"}},
    workflow:{name:"CI",path:".github/workflows/build.yml"},
    workflow_run:{id:123,workflow_id:3,html_url:repoUrl+"/actions/runs/123",
      status:"completed",conclusion:"success",created_at:"2026-10-28T10:00:00Z"}};
  const body=JSON.stringify(payload);
  let writes=0;
  const env={GITHUB_WEBHOOK_SECRET:"secret",STATUS_EVENTS:{
    put:async(key,value,opt)=>{writes++; assert.match(key,/^event:/);assert.equal(value,"");
      assert.equal(opt.metadata.run.id,123);},
  }};
  const url="https://status.example/github-webhook";
  const denied=await worker.fetch(new Request(url,{method:"POST",body}),env);
  assert.equal(denied.status,401);
  assert.equal(writes,0);
  const mac=createHmac("sha256","secret").update(body).digest("hex");
  const accepted=await worker.fetch(new Request(url,{method:"POST",body,
    headers:{"X-Hub-Signature-256":"sha256="+mac,"X-GitHub-Event":"workflow_run"}}),env);
  assert.equal(accepted.status,202);
  assert.equal(writes,1);
});


test("a rerun attempt can be active while the previous attempt remains completed",() => {
  const old=run(6,"completed","success","2026-10-28T11:00:00Z");
  const current={...run(6,"in_progress",null,"2026-10-28T11:00:00Z"),attempt:2};
  const data=mergeSnapshot(baseline,[event(old),event(current)]);
  const workflow=data.repositories[0].workflows[0];
  assert.equal(workflow.last_completed.id,6);
  assert.equal(workflow.last_completed.attempt,1);
  assert.deepEqual(workflow.active_runs.map(r=>r.attempt),[2]);
});


test("public endpoints allow requests from custom-domain dashboard",async () => {
  const result=await worker.fetch(
    new Request("https://example.workers.dev/health", {
      headers:{"Origin":"https://dashboard.mbligh.org"}
    }),{});
  assert.equal(result.status,200);
  assert.equal(result.headers.get("Access-Control-Allow-Origin"),"*");
});
