"""Creates the upload test files in tests/data/. Every visit in these files is fictional (IDs such as TEST-0001) and
exists only to exercise the upload pipeline. The two rows copied from the base data use its pseudonymous keys only."""
import datetime as dt
import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "data"
OUT.mkdir(parents=True, exist_ok=True)
H = ["Patient Id", "Patient Admission Date", "Patient Gender", "Patient Age", "Patient Race", "Department Referral",
     "Patient Admission Flag", "Patient Satisfaction Score", "Patient Waittime", "Patients CM"]
NAMES = ["Patient First Inital", "Patient Last Name"]
base = (ROOT / "data" / "er_visits_deidentified.csv").read_text(encoding="utf-8").splitlines()
existing = base[1].split(",")                                          # exact copy -> duplicate test
blank_score = next(l.split(",") for l in base[1:] if l.split(",")[7] == "")   # existing visit without a score -> merge test


def visits(prefix, n, month="11", year="2024", start=1):
    rows = []
    for i in range(start, start + n):
        day = 13 + (i % 15)                                            # days 13-27: only valid when read day-first
        rows.append([f"{prefix}-{i:04d}", f"{day:02d}-{month}-{year} {(i * 7) % 24:02d}:{(i * 11) % 60:02d}", "F" if i % 2 else "M", 5 + (i * 7) % 70,
                     "White" if i % 3 else "Asian", ["None", "General Practice", "Orthopedics", "Cardiology"][i % 4], "TRUE" if i % 2 else "FALSE",
                     (i % 11) if i % 3 == 0 else "", 12 + (i * 5) % 48, 0])
    return rows


def csv(name, header, rows):
    (OUT / name).write_text("\n".join([",".join(header)] + [",".join(str(v) for v in r) for r in rows]) + "\n", encoding="utf-8")


# 1 append: 10 new visits (with fictional name columns that must be dropped) + 1 exact duplicate + 1 invalid row
csv("01_append_valid_with_duplicate_and_invalid.csv", NAMES + H,
    [["T", "Testperson"] + r for r in visits("TEST", 10)] + [["", ""] + existing] + [["T", "Invalid", "TEST-9999", "31-02-2024 10:00", "F", 40, "White", "None", "maybe", "", "abc", 0]])
# 2 missing required column (no wait time)
csv("02_missing_required_column.csv", [h for h in H if h != "Patient Waittime"], [r[:8] + r[9:] for r in visits("TEST", 2)])
# 3 merge: a late satisfaction score (9) for an existing visit + 1 new visit
upd = blank_score.copy(); upd[7] = "9"
csv("03_merge_update_and_insert.csv", H, [upd] + visits("MERGE", 1))
# 4 alternative column names, ISO dates, Male/Female and Yes/No
csv("04_alias_headers.csv", ["Visit ID", "Arrival Date Time", "Sex", "Age", "Wait Time", "Admitted", "Referral", "Satisfaction"],
    [["ALIAS-1", "2024-11-02 08:15", "Female", 34, 25, "Yes", "Neurology", 7], ["ALIAS-2", "2024-11-02T09:40", "Male", 61, 48, "No", "", ""],
     ["ALIAS-3", "2024-11-03 23:05:00", "female", 8, 15, "no", "None", 10]])
# 5 duplicate rows inside one file (rows 2 and 4 are the same visit)
r5 = visits("DUP", 2)
csv("05_duplicate_rows_in_file.csv", H, r5 + [r5[0]])
# 6 replace: 60 fictional visits over two months
csv("06_replace_sixty_visits.csv", H, visits("REPL", 30, "01", "2025") + visits("REPL", 30, "02", "2025", start=31))
# 7 security: HTML and formula text in text fields
csv("07_security_formula_and_html.csv", H, [["SAFE-1", "05-11-2024 10:00", "F", 30, "<img src=x onerror=alert(1)>", "None", "TRUE", 5, 20, 0],
                                           ["SAFE-2", "05-11-2024 11:00", "M", 31, "White", '"=HYPERLINK(""http://example.com"")"', "FALSE", "", 25, 0]])
# 8 JSON (4 visits) and 9 XLSX (5 visits with real Excel date-time and boolean cells)
(OUT / "08_valid.json").write_text(json.dumps({"records": [dict(zip(H, r)) for r in visits("JSON", 4, "12")]}, indent=1))
wb = openpyxl.Workbook(); ws = wb.active; ws.append(H)
for i, r in enumerate(visits("XLSX", 5, "12")):
    r[1] = dt.datetime(2024, 12, 20 + i, 9 + i, 30); r[6] = bool(i % 2); ws.append(r)
    ws.cell(row=i + 2, column=2).number_format = "dd-mm-yyyy hh:mm"
wb.save(OUT / "09_valid.xlsx")
# 10 wrong file type
(OUT / "10_wrong_type.txt").write_text("this is not a data file\n")
print("written:", sorted(p.name for p in OUT.iterdir()))
