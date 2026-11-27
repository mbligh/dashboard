import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto, createHmac} from "node:crypto";
import worker, {validateExternal} from "../src/index.mjs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const secret = "test-secret";
const payload = () => ({version:1,group:"pvr",title:"PVR — Indexers",
  published_at:new Date().toISOString(),items:[{id:"bbc",name:"BBC",status:"success",
  failures:0,last_attempt:null,last_success:null,retry_not_before:null,reason:null}]});
const env = () => {
  const data = new Map(), writes = [];
  return {EXTERNAL_STATUS_SECRET_PVR:secret,data,writes,STATUS_EVENTS:{
    get:async key => data.has(key)?JSON.parse(data.get(key)):null,
    put:async (key,value) => {data.set(key,value);writes.push(key);},
    list:async () => ({keys:[],list_complete:true})
  }};
};
function post(p,key=secret,group="pvr") {
  const body=JSON.stringify(p);
  return new Request("https://example.test/external-status/"+group,{method:"POST",body,
    headers:{"X-Status-Signature":"sha256="+createHmac("sha256",key).update(body).digest("hex")}});
}
test("external publish authenticates, validates and stores one sanitized snapshot",async()=>{
  const e=env(), p=payload();p.items[0].raw_error="not public";
  assert.equal((await worker.fetch(post(p,"wrong"),e)).status,401);
  assert.equal((await worker.fetch(post(p),e)).status,202);
  assert.deepEqual(e.writes,["status:pvr"]);
  assert.equal(JSON.parse(e.data.get("status:pvr")).items[0].raw_error,undefined);
  assert.equal((await worker.fetch(post(p),e)).status,200);
  assert.equal(e.writes.length,1);
  assert.equal((await worker.fetch(post(p,secret,"other"),e)).status,404);
});
test("invalid and expired snapshots cannot replace current status",async()=>{
  const e=env(),p=payload();
  p.published_at="2000-01-01T00:00:00Z";
  assert.equal((await worker.fetch(post(p),e)).status,422);
  p.published_at=new Date().toISOString();p.items[0].reason="raw error /private/path";
  assert.equal((await worker.fetch(post(p),e)).status,422);
  assert.equal(e.writes.length,0);
  assert.throws(()=>validateExternal({...payload(),items:[]},"pvr"));
});
test("external status merges without changing GitHub baseline or listing extra keys",async()=>{
  const e=env(),p=payload();await worker.fetch(post(p),e);
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({repositories:[],generated_at:"2026-01-01T00:00:00Z"});
  try {
    const data=await (await worker.fetch(new Request("https://example.test/status.json"),e)).json();
    assert.equal(data.external_status[0].items[0].id,"bbc");
    assert.deepEqual(data.repositories,[]);
    e.STATUS_EVENTS.get=async()=>{throw Error("KV error")};
    const degraded=await (await worker.fetch(new Request("https://example.test/status.json"),e)).json();
    assert.equal(degraded.external_status[0].unavailable,"Snapshot unavailable");
    assert.deepEqual(degraded.repositories,[]);
  } finally {globalThis.fetch=oldFetch;}
});
