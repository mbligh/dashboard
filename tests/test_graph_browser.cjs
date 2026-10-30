"use strict";
// Execute the browser graph's actual connection builder with minimal DOM stubs.
// No npm dependencies or browser automation required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {test} = require("node:test");
const script = fs.readFileSync("site/repo.js", "utf8").replace(/\binitialize\(\);\s*$/, "");
const sandbox = {
  URLSearchParams, URL, console,
  location: {search: "?repo=mapping"},
  document: {getElementById: () => ({addEventListener() {}})},
};
vm.runInNewContext(script + "\n;globalThis.__connections=connections;", sandbox, {
  filename: "site/repo.js",
});
const connections = sandbox.__connections;

function workflow(id, name, triggers, filename) {
  return {
    id, name, path: ".github/workflows/" + filename,
    triggers, calls: [], dispatches: [],
  };
}
const mapping = {workflows: [
  workflow(1, "Extract NJ contour vectors",
    [{event:"push"}, {event:"workflow_dispatch"}], "extract-contours.yml"),
  workflow(2, "Build NJ contour PMTiles",
    [{event:"workflow_run",workflows:["Extract NJ contour vectors"],types:["completed"]},
     {event:"push"}], "contours.yml"),
  workflow(3, "Publish mapping pages",
    [{event:"workflow_run",
       workflows:["Build NJ contour PMTiles","Build surveillance PMTiles"],
       types:["completed"]},
     {event:"push"}, {event:"schedule",cron:["7,22,37,52 * * * *"]},
     {event:"repository_dispatch",types:["mapping-release-assets-updated"]},
     {event:"release"}, {event:"workflow_dispatch"}], "publish-pages.yml"),
  workflow(4, "Build surveillance PMTiles",[{event:"push"}], "surveillance.yml"),
]};

test("default shows only declared workflow-to-workflow arrows", () => {
  const graph = connections(mapping);
  assert.equal(graph.nodes.filter(x => x.kind==="event").length,0);
  assert.ok(graph.edges.every(x=>x.from.kind==="workflow" && x.to.kind==="workflow"));
  assert.deepEqual(
    Array.from(graph.edges, x=>x.from.label+" -> "+x.to.label).sort(),
    [
      "Build NJ contour PMTiles -> Publish mapping pages",
      "Build surveillance PMTiles -> Publish mapping pages",
      "Extract NJ contour vectors -> Build NJ contour PMTiles",
    ].sort()
  );
});

test("external event arrows appear only when explicitly enabled", () => {
  const graph = connections(mapping,true);
  const eventEdges = graph.edges.filter(x=>x.kind==="event");
  assert.ok(eventEdges.length >= 5);
  assert.ok(eventEdges.every(x=>x.from.kind==="event" && x.to.kind==="workflow"));
  assert.ok(eventEdges.some(x=>x.from.label==="Schedule" && x.to.label==="Publish mapping pages"));
  assert.ok(graph.edges.some(x=>x.kind==="chain" && x.from.label==="Extract NJ contour vectors"));
});
