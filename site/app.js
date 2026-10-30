"use strict";

const byId = (id) => document.getElementById(id);
let snapshot = null;
let lastError = null;
let fallbackNotice = null;
let statusUrl = "./status.json";
const state = { query: "", filter: "all", showEmpty: false };

function el(tag, cls, value) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}
function append(parent, ...children) {
  children.forEach((child) => parent.appendChild(child));
  return parent;
}
function githubLink(url, label, cls) {
  const node = el("a", cls, label);
  // No untrusted HTML or non-GitHub URL is allowed in the document.
  if (typeof url === "string" && /^https:\/\/github\.com\/mbligh\/[a-zA-Z0-9_.-]+(?:\/|$)/.test(url)) {
    node.href = url;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
  }
  return node;
}
function completedRun(workflow) {
  if (Object.prototype.hasOwnProperty.call(workflow, "last_completed")) return workflow.last_completed;
  return workflow.run && workflow.run.status === "completed" ? workflow.run : null;
}
function activeRuns(workflow) {
  if (Array.isArray(workflow.active_runs)) return workflow.active_runs;
  return workflow.run && workflow.run.status !== "completed" ? [workflow.run] : [];
}
function category(workflow) {
  const run = completedRun(workflow);
  if (!run) return "never";
  const conclusion = run.conclusion;
  if (conclusion === "success") return "success";
  if (["failure", "timed_out", "action_required", "startup_failure"].includes(conclusion)) return "failure";
  if (conclusion === "cancelled") return "warning";
  return "neutral";
}
function statusLabel(workflow) {
  const run = completedRun(workflow);
  if (!run) return activeRuns(workflow).length ? "No completed run" : "Never run";
  return {success:"Success",failure:"Failed",timed_out:"Timed out",cancelled:"Cancelled",
    skipped:"Skipped",neutral:"Neutral",action_required:"Action required",
    startup_failure:"Startup failure",stale:"Stale"}[run.conclusion] || run.conclusion || "Completed";
}
function relativeTime(value) {
  if (!value) return "Unknown";
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - millis) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  if (seconds < 86400 * 30) return Math.floor(seconds / 86400) + "d ago";
  return Math.floor(seconds / (86400 * 30)) + "mo ago";
}
function countStats(data) {
  const stats = {repos: 0, workflows: 0, failure: 0, running: 0, success: 0};
  stats.repos = data.repositories.length;
  for (const repo of data.repositories) {
    for (const workflow of repo.workflows) {
      stats.workflows++;
      const cls = category(workflow);
      if (cls in stats) stats[cls]++;
      if (activeRuns(workflow).length) stats.running++;
    }
  }
  return stats;
}
function summary() {
  const container = byId("summary");
  container.replaceChildren();
  if (!snapshot) return;
  const stats = countStats(snapshot);
  for (const [key, label] of [["repos","Repositories"],["workflows","Workflows"],
      ["failure","Failing"],["running","Running / queued"],["success","Successful"]]) {
    append(container, append(el("div", "metric " + key),
      el("div", "value", stats[key]), el("div", "label", label)));
  }
}
function pill(label, cls) { return el("span", "pill " + cls, label); }
function matches(workflow) {
  const kind = category(workflow);
  if (state.filter === "attention" && !["failure", "warning"].includes(kind)) return false;
  if (state.filter === "running" && !activeRuns(workflow).length) return false;
  if (["success","never"].includes(state.filter) && state.filter !== kind) return false;
  return true;
}
function render() {
  summary();
  const container = byId("repos");
  const openness = {};
  container.querySelectorAll("details[data-repo]").forEach((node) => { openness[node.dataset.repo] = node.open; });
  container.replaceChildren();
  if (!snapshot) {
    container.appendChild(el("p", "placeholder", lastError || "Loading snapshot…"));
    return;
  }
  const query = state.query.trim().toLowerCase();
  let shown = 0;
  for (const repo of snapshot.repositories) {
    const repoMatch = repo.name.toLowerCase().includes(query);
    const visible = repo.workflows.filter((wf) =>
      matches(wf) && (repoMatch || wf.name.toLowerCase().includes(query)));
    if (!visible.length && !(state.showEmpty && !repo.workflows.length &&
      (repoMatch || !query) && state.filter === "all")) continue;
    if (!visible.length && repo.workflows.length) continue;
    const details = el("details", "repo");
    details.dataset.repo = repo.name;
    details.open = Object.prototype.hasOwnProperty.call(openness, repo.name) ? openness[repo.name] : true;
    const head = el("summary");
    const title = el("span", "repo-title");
    append(title, githubLink(repo.url, repo.name, "repo-link"));
    const graphLink = el("a", "graph-link", "Trigger graph");
    graphLink.href = "./repo.html?repo=" + encodeURIComponent(repo.name);
    graphLink.addEventListener("click", event => event.stopPropagation());
    const titleAndGraph = append(el("span", "repo-heading-content"), title, graphLink);
    const totals = el("span", "repo-totals");
    const failing = repo.workflows.filter((w) => category(w) === "failure").length;
    const running = repo.workflows.filter((w) => activeRuns(w).length).length;
    if (failing) totals.appendChild(pill(failing + " failing", "failure"));
    if (running) totals.appendChild(pill(running + " running", "running"));
    if (repo.archived) totals.appendChild(pill("Archived", "neutral"));
    totals.appendChild(pill(repo.workflows.length + " workflows", "neutral"));
    append(head, titleAndGraph, totals);
    details.appendChild(head);
    if (!repo.workflows.length) {
      details.appendChild(el("div", "empty", "No GitHub Actions workflows"));
    }
    for (const wf of visible) {
      const kind = category(wf);
      const row = el("div", "workflow " + kind);
      const name = el("div", "workflow-name");
      name.appendChild(githubLink(wf.url, wf.name));
      if (wf.state !== "active") {
        append(name, el("span", "dim", " · " + wf.state.replaceAll("_", " ")));
      }
      const badge = el("div", "badge", statusLabel(wf));
      const statusCell = append(el("div", "status-cell"), badge);
      const active = activeRuns(wf);
      if (active.length) {
        const activeRun = active[0];
        const verb = {in_progress:"Running", queued:"Queued", waiting:"Waiting",
          pending:"Pending", requested:"Requested"}[activeRun.status] || "Active";
        const activeLabel = active.length === 1
          ? verb + " #" + (activeRun.number || activeRun.id)
          : active.length + " active runs";
        const notice = githubLink(activeRun.url, activeLabel, "active-indicator");
        notice.title = active.length + " unfinished run(s); opens the most recent";
        statusCell.appendChild(notice);
      }
      const run = completedRun(wf);
      const branch = el("div", "meta branch", run ? (run.branch || "—") : "—");
      const event = el("div", "meta event", run ? (run.event || "—") : "—");
      const age = el("div", "meta age", run ? relativeTime(run.created_at) : "—");
      if (run && run.created_at) age.title = new Date(run.created_at).toLocaleString();
      const link = run ? githubLink(run.url, "#" + (run.number || run.id), "run-link") : el("span", "dim run-link", "—");
      append(row, name, statusCell, branch, age, link);
      // The event is accessible as a tooltip without consuming another column.
      if (run) badge.title = "Trigger: " + (run.event || "unknown") +
        (run.attempt > 1 ? "; attempt " + run.attempt : "");
      details.appendChild(row);
    }
    container.appendChild(details);
    shown++;
  }
  if (!shown) container.appendChild(el("p", "placeholder", "No workflows match the selected filters."));
}
function freshness() {
  const warning = byId("source-warning");
  const problem = fallbackNotice || lastError;
  warning.hidden = !problem;
  if (problem) {
    const checked = snapshot && snapshot.generated_at
      ? " Snapshot from " + new Date(snapshot.generated_at).toLocaleString() + "."
      : "";
    warning.textContent = "Live workflow status is unavailable. Displayed results may be outdated or incorrect." +
      checked + " Cause: " + problem;
  }
  if (!snapshot) {
    byId("freshness").textContent = lastError || "Loading snapshot…";
    byId("freshness").classList.toggle("error", !!lastError);
    return;
  }
  const age = (Date.now() - Date.parse(snapshot.generated_at)) / 60000;
  const node = byId("freshness");
  node.textContent = (snapshot.status_source === "webhook-kv" ? "Live · checked " : "Snapshot ") +
    relativeTime(snapshot.generated_at) +
    (lastError ? " · Refresh failed" : fallbackNotice ? " · Pages fallback" : "");
  node.title = "Generated " + new Date(snapshot.generated_at).toLocaleString() +
    (lastError ? "; " + lastError : fallbackNotice ? "; " + fallbackNotice : "");
  node.classList.toggle("stale", age > 45 || !!lastError || !!fallbackNotice);
  node.classList.toggle("error", !!lastError);
}
async function loadStatus(url) {
  const response = await fetch(url, {cache:"no-store"});
  if (!response.ok) throw new Error("HTTP " + response.status + " loading " + url);
  const data = await response.json();
  if (!Array.isArray(data.repositories) || !data.generated_at) throw new Error("Invalid snapshot from " + url);
  return data;
}
async function refresh() {
  const button = byId("refresh");
  button.disabled = true;
  try {
    let data;
    fallbackNotice = null;
    try {
      data = await loadStatus(statusUrl);
    } catch (error) {
      if (statusUrl === "./status.json") throw error;
      fallbackNotice = "Live Worker unavailable: " + error.message;
      data = await loadStatus("./status.json");
    }
    snapshot = data;
    lastError = null;
    render();
  } catch (error) {
    lastError = error.message;
    if (!snapshot) render();
  } finally {
    button.disabled = false;
    freshness();
  }
}
byId("search").addEventListener("input", (event) => { state.query = event.target.value; render(); });
byId("filter").addEventListener("change", (event) => { state.filter = event.target.value; render(); });
byId("empty").addEventListener("change", (event) => { state.showEmpty = event.target.checked; render(); });
byId("refresh").addEventListener("click", refresh);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 120000);
setInterval(freshness, 30000);
async function initializeStatusSource() {
  try {
    const response = await fetch("./config.json", {cache:"no-store"});
    if (response.ok) {
      const config = await response.json();
      if (typeof config.status_url === "string") {
        const target = new URL(config.status_url);
        if (target.protocol === "https:" && target.pathname === "/status.json" &&
            (target.hostname.endsWith(".workers.dev") || target.hostname === "dashboard.mbligh.org")) {
          statusUrl = target.href;
        }
      }
    }
  } catch (error) {
    console.warn("Using GitHub Pages snapshot:", error);
  }
  refresh();
}
initializeStatusSource();
