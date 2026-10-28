"""Offline tests for the public dashboard collector."""
import runpy
import unittest
from pathlib import Path

mod = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "collect"))


class FakeAPI:
    def __init__(self):
        self.calls = []

    def get(self, path, **params):
        self.calls.append((path, params))
        if path == "/users/mbligh/repos":
            return [
                {"name": "dashboard", "owner": {"login": "mbligh"}, "private": False,
                 "html_url": "https://github.com/mbligh/dashboard"},
                {"name": "private", "owner": {"login": "mbligh"}, "private": True,
                 "html_url": "https://github.com/mbligh/private"},
                {"name": "demo", "owner": {"login": "mbligh"}, "private": False,
                 "html_url": "https://github.com/mbligh/demo"},
            ]
        if path == "/repos/mbligh/demo/actions/workflows":
            return {"workflows": [
                {"id": 1, "name": "Build", "state": "active", "path": ".github/workflows/build.yml",
                 "html_url": "https://github.com/mbligh/demo/blob/main/.github/workflows/build.yml"},
                {"id": 2, "name": "Rare", "state": "disabled_manually", "html_url": "https://github.com/mbligh/demo/actions/workflows/rare.yml"},
                {"id": 3, "name": "Never", "state": "active", "html_url": "https://github.com/mbligh/demo/actions/workflows/never.yml"},
            ]}
        if path == "/repos/mbligh/demo/actions/runs":
            return {"workflow_runs": [
                {"workflow_id": 1, "id": 10, "html_url": "https://github.com/mbligh/demo/actions/runs/10",
                 "status": "completed", "conclusion": "failure", "created_at": "2026-01-02T00:00:00Z"},
                {"workflow_id": 1, "id": 9, "html_url": "https://github.com/mbligh/demo/actions/runs/9",
                 "status": "completed", "conclusion": "success", "created_at": "2026-01-01T00:00:00Z"},
            ]}
        if path == "/repos/mbligh/demo/actions/workflows/2/runs":
            return {"workflow_runs": [
                {"workflow_id": 2, "id": 3, "html_url": "https://github.com/mbligh/demo/actions/runs/3",
                 "status": "completed", "conclusion": "success", "created_at": "2025-01-01T00:00:00Z"}
            ]}
        if path == "/repos/mbligh/demo/actions/workflows/3/runs":
            return {"workflow_runs": []}
        raise AssertionError("Unexpected request: " + path)


class CollectTest(unittest.TestCase):
    def test_public_workflows_latest_and_fallback(self):
        api = FakeAPI()
        data = mod["collect"](api, "mbligh")
        self.assertEqual([r["name"] for r in data["repositories"]], ["demo"])
        workflows = data["repositories"][0]["workflows"]
        self.assertEqual([w["name"] for w in workflows], ["Build", "Never", "Rare"])
        self.assertEqual(workflows[0]["run"]["id"], 10)
        self.assertEqual(workflows[0]["url"], "https://github.com/mbligh/demo/actions/workflows/build.yml")
        self.assertEqual(workflows[1]["url"], "https://github.com/mbligh/demo/actions/workflows/3")
        self.assertEqual(workflows[2]["url"], "https://github.com/mbligh/demo/actions/workflows/2")
        self.assertIsNone(workflows[1]["run"])
        self.assertEqual(workflows[2]["run"]["id"], 3)
        self.assertEqual(workflows[2]["state"], "disabled_manually")
        self.assertEqual(len(api.calls), 5)

    def test_workflow_page_url(self):
        link = mod["workflow_page_url"]
        repo = "https://github.com/mbligh/mapping"
        self.assertEqual(
            link(repo, {"id": 123, "path": ".github/workflows/extract-contours.yml",
                        "html_url": repo + "/blob/main/.github/workflows/extract-contours.yml"}),
            repo + "/actions/workflows/extract-contours.yml")
        self.assertEqual(
            link(repo, {"id": 123, "path": ".github/workflows/other.yaml"}),
            repo + "/actions/workflows/other.yaml")
        self.assertEqual(link(repo, {"id": 123, "path": None}),
                         repo + "/actions/workflows/123")

    def test_empty_run(self):
        self.assertIsNone(mod["slim_run"](None))


if __name__ == "__main__":
    unittest.main()
