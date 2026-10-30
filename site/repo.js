"use strict";

const NS = "http://www.w3.org/2000/svg";
const WORKER_CONFIG = "./config.json";
const LOCAL_STATUS = "./status.json";
const byId = id => document.getElementById(id);
const repoName = new URLSearchParams(location.search).get("repo");
const safeRepo = typeof repoName === "string" && /^[A-Za-z0-9_.-]+$/.test(repoName);
let statusUrl = LOCAL_STATUS;
let shownRepo = null;
let shownSnapshot = null;
let shownFallback = false;

function element(name, className, value) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}
function svg(name, attributes = {}, label) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attributes)) node.setAttribute(k, String(v));
  if (label != null) node.textContent = label;
  return node;
}
function slug(s) { return String(s || "").toLocaleLowerCase().trim(); }
function doneRun(wf) {
  if (Object.hasOwn(wf, "last_completed")) return wf.last_completed;
  return wf.run && wf.run.status === "completed" ? wf.run : null;
}
function category(wf) {
  const result = doneRun(wf);
  if (!result) return "never";
  if (result.conclusion === "success") return "success";
  if (["failure", "timed_out", "action_required", "startup_failure"].includes(result.conclusion))
    return "failure";
  return result.conclusion === "cancelled" ? "warning" : "neutral";
}
function reason(t) {
  const fragments = [];
  for (const k of ["types", "branches", "branches_ignore", "paths", "paths_ignore", "cron"]) {
    if (Array.isArray(t[k]) && t[k].length) fragments.push(k.replaceAll("_", "-") + ": " + t[k].join(", "));
  }
  return fragments.join("; ");
}
function eventName(type) {
  return ({
    push:"Push", pull_request:"Pull request", pull_request_target:"PR target",
    schedule:"Schedule", workflow_dispatch:"Manual dispatch",
    repository_dispatch:"Repository dispatch", workflow_call:"Reusable call",
    release:"Release", create:"Create", delete:"Delete", issues:"Issues",
    issue_comment:"Issue comment", workflow_run:"Workflow run",
    deployment:"Deployment", deployment_status:"Deployment status",
    workflow_job:"Workflow job", page_build:"Pages build", watch:"Star",
    workflow_dispatch_target:"Dispatch",
  })[type] || type.replaceAll("_", " ");
}
function fileName(path) {
  const m = /^\.github\/workflows\/([^/]+\.ya?ml)$/.exec(path || "");
  return m ? m[1] : null;
}
function connections(repo, includeExternalEvents = false) {
  const nodes = [], edges = [];
  const byWorkflow = new Map(), byName = new Map(), byFilename = new Map(), sources = new Map();
  const known = repo.workflows || [];
  for (const wf of known) {
    const node = {id:"wf:"+wf.id,label:wf.name,workflow:wf,kind:"workflow",rank:1};
    nodes.push(node);
    byWorkflow.set(wf.id,node);
    const name = slug(wf.name), filename = fileName(wf.path);
    if (!byName.has(name)) byName.set(name,[]);
    byName.get(name).push(node);
    if (filename) byFilename.set(filename,node);
  }
  const seen = new Set();
  function addEdge(from,to,kind,detail) {
    if (!from || !to) return;
    const key = [from.id,to.id,kind,detail].join("::");
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({from,to,kind,detail});
  }
  function eventNode(id,label) {
    const key = "ev:"+id;
    if (!sources.has(key)) {
      const node = {id:key,label,kind:"event",rank:0};
      sources.set(key,node);
      nodes.push(node);
    }
    return sources.get(key);
  }
  for (const wf of known) {
    const target = byWorkflow.get(wf.id);
    for (const trigger of wf.triggers || []) {
      const event = trigger.event;
      if (!event) continue;
      const detail = reason(trigger);
      if (event === "workflow_run") {
        for (const name of trigger.workflows || []) {
          const matches = byName.get(slug(name)) || [];
          if (matches.length === 1) {
            addEdge(matches[0],target,"chain",detail || "workflow_run");
          } else {
            addEdge(eventNode("workflow_run:"+name,"Workflow: "+name),
              target,"unresolved",detail || "Source workflow not uniquely matched");
          }
        }
      } else if (includeExternalEvents && event !== "workflow_call") {
        let label = eventName(event);
        let key = event;
        if (event === "repository_dispatch" && (trigger.types || []).length) {
          label += ": "+trigger.types.join(", ");
          key += ":"+(trigger.types || []).join(",");
        }
        addEdge(eventNode(key,label),target,"event",detail || eventName(event));
      }
    }
    for (const name of wf.calls || []) {
      const callee = byFilename.get(name);
      if (callee) addEdge(target,callee,"reuse","Reusable workflow: "+name);
    }
    for (const name of wf.dispatches || []) {
      const callee = byFilename.get(name);
      if (callee) addEdge(target,callee,"dispatch","gh workflow run "+name);
    }
  }
  for (const wf of known) {
    if (includeExternalEvents && (wf.triggers || []).some(t => t.event === "workflow_call")) {
      const node = byWorkflow.get(wf.id);
      if (!edges.some(e => e.to === node && e.kind === "reuse"))
        addEdge(eventNode("external_call","External reusable call"),node,"event","workflow_call");
    }
  }

  // Longest path in the acyclic portion of the workflow graph.
  // Cycles remain in the first column rather than forcing unbounded ranks.
  const workflowNodes = nodes.filter(n => n.kind === "workflow");
  const indegree = new Map(workflowNodes.map(n => [n.id,0]));
  const outgoing = new Map(workflowNodes.map(n => [n.id,[]]));
  for (const edge of edges) {
    if (edge.from.kind === "workflow" && edge.to.kind === "workflow") {
      outgoing.get(edge.from.id).push(edge.to);
      indegree.set(edge.to.id,indegree.get(edge.to.id)+1);
    }
  }
  const queue = workflowNodes.filter(n => indegree.get(n.id) === 0);
  let pointer = 0;
  while (pointer < queue.length) {
    const current = queue[pointer++];
    for (const next of outgoing.get(current.id)) {
      next.rank = Math.max(next.rank,current.rank+1);
      indegree.set(next.id,indegree.get(next.id)-1);
      if (indegree.get(next.id) === 0) queue.push(next);
    }
  }
  return {nodes,edges};
}
function displayLabel(value, length = 26) {
  const text = String(value);
  if (text.length <= length) return [text];
  const words = text.split(/\s+/), lines = [""];
  for (const word of words) {
    const last = lines.length-1;
    if ((lines[last]+" "+word).trim().length > length && lines[last] && lines.length < 2) {
      lines.push(word);
    } else {
      lines[last] += (lines[last] ? " " : "") + word;
    }
  }
  return lines.map(x => x.length > length ? x.slice(0,length-1)+"…" : x);
}
function buildSVG(data) {
  const {nodes,edges} = data;
  const columns = new Map();
  for (const node of nodes) {
    if (!columns.has(node.rank)) columns.set(node.rank,[]);
    columns.get(node.rank).push(node);
  }
  for (const group of columns.values()) group.sort((a,b)=>a.label.localeCompare(b.label));
  const maxRank = Math.max(1,...columns.keys());
  const cellW = 228, cellH = 64, gapX = 65, gapY = 32, padding = 40;
  const strideX = cellW+gapX, strideY = cellH+gapY;
  const biggest = Math.max(2,...[...columns.values()].map(c => c.length));
  const width = 2*padding+(maxRank+1)*cellW+maxRank*gapX;
  const height = 2*padding+biggest*cellH+(biggest-1)*gapY;
  for (const [rank,group] of columns) {
    const offsetY = padding+(height-2*padding-group.length*strideY+gapY)/2;
    group.forEach((n,i) => {
      n.x=padding+rank*strideX;
      n.y=offsetY+i*strideY;
    });
  }
  const graph = svg("svg",{viewBox:"0 0 "+width+" "+height,
    width,height,role:"img","aria-label":"Directed workflow trigger graph"});
  const title = svg("title",{},"GitHub Actions triggers for "+repoName);
  graph.appendChild(title);
  const defs = svg("defs");
  for (const [kind,color] of [
    ["event","#8291a3"],["chain","#54b89a"],
    ["reuse","#aa8ff0"],["dispatch","#e4b466"],["unresolved","#8490a2"]
  ]) {
    const marker=svg("marker",{id:"arrow-"+kind,markerWidth:10,markerHeight:10,
      refX:9,refY:5,orient:"auto",markerUnits:"userSpaceOnUse"});
    marker.appendChild(svg("path",{d:"M1 1 L9 5 L1 9",fill:"none",stroke:color,"stroke-width":1.8}));
    defs.appendChild(marker);
  }
  graph.appendChild(defs);
  for (const edge of edges) {
    const x1=edge.from.x+cellW, y1=edge.from.y+cellH/2;
    const x2=edge.to.x, y2=edge.to.y+cellH/2;
    let path;
    if (x2 > x1+20) {
      const delta=Math.max(30,Math.min(110,(x2-x1)*0.45));
      path="M"+x1+" "+y1+" C"+(x1+delta)+" "+y1+" "+(x2-delta)+" "+y2+" "+(x2-5)+" "+y2;
    } else {
      // A back-edge in a cycle. Route beneath both workflow nodes.
      const below=Math.max(edge.from.y,edge.to.y)+cellH+18;
      path="M"+x1+" "+y1+" C"+(x1+22)+" "+below+" "+(x2-22)+" "+below+" "+(x2-5)+" "+y2;
    }
    const line=svg("path",{d:path,class:"graph-edge "+edge.kind,
      "marker-end":"url(#arrow-"+edge.kind+")"});
    line.appendChild(svg("title",{},edge.from.label+" → "+edge.to.label+
      (edge.detail ? " · "+edge.detail : "")));
    graph.appendChild(line);
  }
  for (const n of nodes) {
    const group=svg("g",{class:"graph-node "+(n.kind === "event"?"source":category(n.workflow)),
      transform:"translate("+n.x+" "+n.y+")"});
    let container=group;
    if (n.workflow) {
      const link=svg("a",{href:n.workflow.url,"aria-label":"Open GitHub workflow: "+n.label});
      group.appendChild(link);
      container=link;
    }
    container.appendChild(svg("rect",{width:cellW,height:cellH,rx:9,ry:9}));
    const split=displayLabel(n.label,25);
    const txt=svg("text",{x:13,y:split.length===1?29:23,class:"graph-label"});
    for (let i=0;i<split.length;i++) txt.appendChild(svg("tspan",{x:13,dy:i===0?0:17},split[i]));
    container.appendChild(txt);
    if (n.workflow) {
      const last=doneRun(n.workflow);
      const active=(n.workflow.active_runs || []).length;
      let status = last ? (last.conclusion || "Completed") : "No completed run";
      if (active) status+=" · "+active+" active";
      container.appendChild(svg("text",{x:13,y:cellH-8,class:"graph-subtitle"},status));
    } else {
      container.appendChild(svg("text",{x:13,y:cellH-8,class:"graph-subtitle"},"Event source"));
    }
    group.appendChild(svg("title",{},n.label));
    graph.appendChild(group);
  }
  return graph;
}
function renderDetails(repo) {
  const parent=byId("graph-details");
  parent.replaceChildren();
  if (!repo.workflows.length) {
    parent.appendChild(element("p","placeholder","This repository has no GitHub Actions workflows."));
    return;
  }
  for (const wf of repo.workflows) {
    const detail=element("details","graph-detail");
    const header=element("summary");
    const link=element("a",null,wf.name);
    link.href=wf.url;
    link.target="_blank";
    link.rel="noopener noreferrer";
    header.appendChild(link);
    header.appendChild(element("span","graph-state",doneRun(wf)?.conclusion || "Never completed"));
    detail.appendChild(header);
    const list=element("ul");
    if (wf.analysis_error) list.appendChild(element("li","graph-unknown",
      "Source analysis unavailable: "+wf.analysis_error));
    if (!wf.analysis_error && !(wf.triggers || []).length && !(wf.calls || []).length && !(wf.dispatches || []).length)
      list.appendChild(element("li","graph-unknown","No declared triggers in the current snapshot."));
    for (const trigger of wf.triggers || []) {
      list.appendChild(element("li",null,eventName(trigger.event) +
        ((trigger.workflows || []).length ? ": "+trigger.workflows.join(", ") : "") +
        (reason(trigger) ? " — "+reason(trigger) : "")));
    }
    for (const call of wf.calls || []) list.appendChild(element("li",null,"Calls reusable workflow: "+call));
    for (const dispatch of wf.dispatches || [])
      list.appendChild(element("li",null,"Invokes via gh workflow run: "+dispatch));
    detail.appendChild(list);
    parent.appendChild(detail);
  }
}
function render(repo, snapshot, isFallback) {
  byId("repo-heading").textContent=repo.name+" · Workflow triggers";
  document.title=repo.name+" workflow triggers · mbligh";
  const analysisCount=repo.workflows.filter(w=>Array.isArray(w.triggers)).length;
  const includingExternal=byId("graph-external").checked;
  const data=connections(repo,includingExternal);
  const actualLinks=data.edges.filter(e=>e.from.kind==="workflow" && e.to.kind==="workflow").length;
  const externalNodes=data.nodes.filter(n=>n.kind==="event").length;
  byId("graph-summary").textContent=
    repo.workflows.length+" workflows · "+actualLinks+" workflow-to-workflow links"+
    (includingExternal ? " · "+externalNodes+" external event sources" : "")+
    " · "+analysisCount+" with trigger metadata";
  byId("graph-freshness").textContent=(isFallback?"Pages fallback · ":"Status checked · ")+
    new Date(snapshot.generated_at).toLocaleString();
  const warning=byId("graph-warning");
  warning.hidden=!isFallback;
  if (isFallback) warning.textContent="Live workflow status unavailable. Displayed results may be outdated or incorrect. Snapshot from " +
    new Date(snapshot.generated_at).toLocaleString() + ".";
  const area=byId("graph-area");
  area.replaceChildren();
  if (!repo.workflows.length) {
    area.appendChild(element("p","placeholder","No workflows to graph."));
  } else {
    area.appendChild(buildSVG(data));
    if (!data.edges.length) area.appendChild(element("p","placeholder",
      "No declared workflow-to-workflow connections. Expand the workflow details below for event triggers."));
  }
  renderDetails(repo);
}
async function load(url) {
  const res=await fetch(url,{cache:"no-store"});
  if (!res.ok) throw Error("HTTP "+res.status);
  const data=await res.json();
  if (!Array.isArray(data.repositories)) throw Error("Invalid workflow status data");
  return data;
}
async function refresh() {
  const area=byId("graph-area");
  if (!safeRepo) {
    area.replaceChildren(element("p","placeholder","Choose a repository from the main dashboard."));
    return;
  }
  const button=byId("graph-refresh");
  button.disabled=true;
  try {
    let data, fallback=false;
    try { data=await load(statusUrl); }
    catch (err) {
      if (statusUrl===LOCAL_STATUS) throw err;
      data=await load(LOCAL_STATUS);
      fallback=true;
    }
    const repo=data.repositories.find(r=>r.name===repoName);
    if (!repo) {
      area.replaceChildren(element("p","placeholder","Repository not found in public workflow snapshot."));
      byId("graph-freshness").textContent="Repository unavailable";
      byId("graph-details").replaceChildren();
    } else {
      shownRepo=repo;
      shownSnapshot=data;
      shownFallback=fallback;
      render(repo,data,fallback);
    }
  } catch (err) {
    const warning=byId("graph-warning");
    warning.hidden=false;
    warning.textContent="Live workflow status unavailable: "+err.message;
    area.replaceChildren(element("p","placeholder","Could not load graph: "+err.message));
    byId("graph-freshness").textContent="Data unavailable";
  } finally {
    button.disabled=false;
  }
}
async function initialize() {
  try {
    const res=await fetch(WORKER_CONFIG,{cache:"no-store"});
    if (res.ok) {
      const config=await res.json();
      if (typeof config.status_url==="string") {
        const url=new URL(config.status_url);
        if (url.protocol==="https:" && url.pathname==="/status.json" &&
          url.hostname.endsWith(".workers.dev")) statusUrl=url.href;
      }
    }
  } catch (err) {
    console.warn("Using baseline status",err);
  }
  await refresh();
}
byId("graph-refresh").addEventListener("click",refresh);
byId("graph-external").addEventListener("change",() => {
  if (shownRepo && shownSnapshot) render(shownRepo,shownSnapshot,shownFallback);
});
initialize();
