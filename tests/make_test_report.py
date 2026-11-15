"""Builds tests/test-report.md from tests/results.json (written by tests/run_tests.js)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
r = json.loads((ROOT / "results.json").read_text())
REQUIRED = [
    ("Dashboard loads correctly", "T01"), ("Charts render correctly", "T02"), ("KPI calculations match the underlying data", "T01"),
    ("Filters work correctly", "T03"), ("Charts update when filters are applied", "T03"), ("Tables reflect selected filters", "T03"),
    ("Additional data can be uploaded", "T05 T09"), ("Invalid data is handled correctly", "T04 T05"), ("Duplicate records are handled appropriately", "T07"),
    ("Successful uploads update all dependent metrics", "T05 T08"), ("Local persistence works", "T06"), ("Reset functionality works", "T13"),
    ("Analysis report downloads successfully", "T12"), ("Downloaded report reflects current data", "T12"), ("Dataset export downloads successfully", "T11"),
    ("Exported data matches the analysed dataset", "T11"), ("Mobile and desktop layouts work", "T14"), ("GitHub Pages deployment paths are valid", "T15"),
]
by = {}
for x in r["results"]:
    by.setdefault(x["test"][:3], []).append(x)
lines = ["# Test report", "",
         f"Automated run: {r['run'][:19].replace('T', ' ')} UTC in {r['browser']}. Result: **{r['passed']} of {r['passed'] + r['failed']} checks passed**, {r['failed']} failed.",
         "", "Every check below was executed by `tests/run_tests.js` against the running dashboard; nothing here is marked as passed without being run.",
         "Expected values never come from the dashboard itself: they come from `scripts/prepare_data.py` (pandas and SciPy, saved in "
         "`data/processed/reference_values.json` and `er_visits_analysis.csv`) or are counted directly from the data files by the test script.", "",
         "## Acceptance checklist", "", "| Requirement | Tests | Checks | Status |", "|---|---|---:|---|"]
for name, tests in REQUIRED:
    xs = [c for t in tests.split() for c in by.get(t, [])]
    ok = all(c["pass"] for c in xs) and xs
    lines.append(f"| {name} | {tests} | {len(xs)} | {'Passed' if ok else 'FAILED'} |")
lines += ["", "**Not tested:** an actual publish to GitHub Pages. No repository was pushed from this environment. The checks in T15 confirm the "
          "conditions GitHub Pages needs: every asset path is relative, every referenced file exists, no server code or external request is used, "
          "and the page works when opened directly from disk. Browsers other than Chromium (Firefox, Safari) and screen-reader software were not tested.", "",
          "## All checks", ""]
for t in sorted(by):
    lines += [f"### {by[t][0]['test']}", "", "| Check | Result | Detail |", "|---|---|---|"]
    for c in by[t]:
        d = c["detail"].replace("|", "/").replace("\n", " ")[:140]
        lines.append(f"| {c['check']} | {'Pass' if c['pass'] else 'FAIL'} | {d} |")
    lines.append("")
lines += ["## Test data", "", "The upload test files in `tests/data/` (created by `tests/make_test_files.py`) contain fictional visits with invented IDs "
          "(TEST-, MERGE-, ALIAS-, DUP-, REPL-, SAFE-, JSON-, XLSX-) and a fictional name column, plus two rows copied from the de-identified base data "
          "(pseudonymous keys only) to test duplicate detection and merging. They are test fixtures, not patient data.", "",
          "## How to re-run", "", "```bash", "python -m http.server 8765 &", "python scripts/prepare_data.py   # needs data/raw/Hospital_ER_Data.csv",
          "python tests/make_test_files.py", "node tests/run_tests.js", "python tests/make_test_report.py", "```", ""]
(ROOT / "test-report.md").write_text("\n".join(lines), encoding="utf-8")
print("wrote tests/test-report.md")
