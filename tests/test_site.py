"""Static integration checks for the dashboard's UI styling and favicon."""
import re
import unittest
from pathlib import Path
from xml.etree import ElementTree

SITE = Path(__file__).resolve().parents[1] / "site"


class SiteTest(unittest.TestCase):
    def test_all_statuses_have_full_row_backgrounds(self):
        script = (SITE / "app.js").read_text()
        css = (SITE / "style.css").read_text()
        self.assertIn('el("div", "workflow " + kind)', script)
        self.assertIn('el("div", "badge", statusLabel(wf))', script)
        self.assertIn('const run = completedRun(wf)', script)
        self.assertIn('const active = activeRuns(wf)', script)
        self.assertIn('"active-indicator"', script)
        self.assertIn('.status-cell {', css)
        self.assertIn('.active-indicator {', css)
        self.assertNotIn('el("span", "dot")', script)
        self.assertIn(".workflow { background: var(--row-bg); }", css)
        self.assertIn(".workflow:hover { background: var(--row-hover); }", css)
        for status in ("success", "failure", "warning", "neutral", "never"):
            self.assertRegex(css, r"\.workflow\." + status + r"\b")
        self.assertNotIn(".dot {", css)

    def test_favicon_is_linked_svg_with_three_colors(self):
        html = (SITE / "index.html").read_text()
        self.assertIn('rel="icon" type="image/svg+xml" href="./favicon.svg"', html)
        doc = ElementTree.parse(SITE / "favicon.svg").getroot()
        circles = doc.findall("{http://www.w3.org/2000/svg}circle")
        self.assertEqual(len(circles), 3)
        self.assertEqual([float(c.attrib["cy"]) for c in circles], [14, 32, 50])
        self.assertEqual([c.attrib["fill"] for c in circles],
                         ["#f44348", "#ffd337", "#33cf78"])


if __name__ == "__main__":
    unittest.main()
