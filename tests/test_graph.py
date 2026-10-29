"""Workflow trigger graph extraction tests (no network)."""
import base64
import runpy
import unittest
from pathlib import Path

module = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "graph"))


class FakeAPI:
    def __init__(self, data):
        self.data = data
        self.calls = []

    def get(self, path, **params):
        self.calls.append(path)
        if path not in self.data:
            raise AssertionError("Unrecognized request " + path)
        return {"encoding": "base64", "content": base64.b64encode(
            self.data[path].encode("utf-8")).decode("ascii")}


class GraphTest(unittest.TestCase):
    def test_workflow_run_push_and_manual_conditions(self):
        content = """
name: Build contours
on:
  workflow_run:
    workflows: ['Extract NJ contour vectors']
    types: [completed]
    branches: [main]
  push:
    branches: [main]
    paths:
      - 'scripts/build_contours.py'
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo done
"""
        parsed = module["analyze_source"](content)
        triggers = {t["event"]: t for t in parsed["triggers"]}
        self.assertEqual(triggers["workflow_run"]["workflows"], ["Extract NJ contour vectors"])
        self.assertEqual(triggers["workflow_run"]["types"], ["completed"])
        self.assertEqual(triggers["workflow_run"]["branches"], ["main"])
        self.assertEqual(triggers["push"]["paths"], ["scripts/build_contours.py"])
        self.assertIn("workflow_dispatch", triggers)

    def test_reusable_and_explicit_cli_dispatch(self):
        content = """
on: [workflow_dispatch, push]
jobs:
  invoke:
    uses: ./.github/workflows/other.yaml
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch
        run: |
          gh workflow run publish.yml --ref main
          gh workflow run 'sync.yaml'
          echo 'gh workflow run $DYNAMIC.yml'
"""
        parsed = module["analyze_source"](content)
        self.assertEqual(parsed["calls"], ["other.yaml"])
        self.assertEqual(parsed["dispatches"], ["publish.yml", "sync.yaml"])
        self.assertEqual([t["event"] for t in parsed["triggers"]],
                         ["workflow_dispatch", "push"])

    def test_schedule_and_repository_dispatch(self):
        content = """
on:
  schedule:
    - cron: '17 6 1 * *'
  repository_dispatch:
    types: [mapping-release-assets-updated]
"""
        parsed = module["analyze_source"](content)
        self.assertEqual(parsed["triggers"][0]["cron"], ["17 6 1 * *"])
        self.assertEqual(parsed["triggers"][1]["types"], ["mapping-release-assets-updated"])

    def test_annotate_public_workflow_and_unavailable_dynamic(self):
        content = """on:
  workflow_run:
    workflows: [Build]
    types: [completed]
"""
        api = FakeAPI({
            "/repos/mbligh/demo/contents/.github/workflows/build.yml": content
        })
        data = {"owner": "mbligh", "repositories": [{
            "name": "demo", "workflows": [
                {"id": 1, "path": ".github/workflows/build.yml"},
                {"id": 2, "path": "dynamic/pages/pages-build-deployment"}
            ]}]}
        result = module["annotate"](data, api)
        a, b = result["repositories"][0]["workflows"]
        self.assertEqual(a["triggers"][0]["workflows"], ["Build"])
        self.assertNotIn("analysis_error", a)
        self.assertEqual(b["triggers"], [])
        self.assertIn("Not a repository YAML workflow", b["analysis_error"])
        self.assertEqual(len(api.calls), 1)


if __name__ == "__main__":
    unittest.main()
