# Test report

Automated run: 2026-11-09 19:33:54 UTC in Chromium (Playwright). Result: **138 of 138 checks passed**, 0 failed.

Every check below was executed by `tests/run_tests.js` against the running dashboard; nothing here is marked as passed without being run.
Expected values never come from the dashboard itself: they come from `scripts/prepare_data.py` (pandas and SciPy, saved in `data/processed/reference_values.json` and `er_visits_analysis.csv`) or are counted directly from the data files by the test script.

## Acceptance checklist

| Requirement | Tests | Checks | Status |
|---|---|---:|---|
| Dashboard loads correctly | T01 | 28 | Passed |
| Charts render correctly | T02 | 21 | Passed |
| KPI calculations match the underlying data | T01 | 28 | Passed |
| Filters work correctly | T03 | 14 | Passed |
| Charts update when filters are applied | T03 | 14 | Passed |
| Tables reflect selected filters | T03 | 14 | Passed |
| Additional data can be uploaded | T05 T09 | 16 | Passed |
| Invalid data is handled correctly | T04 T05 | 14 | Passed |
| Duplicate records are handled appropriately | T07 | 3 | Passed |
| Successful uploads update all dependent metrics | T05 T08 | 14 | Passed |
| Local persistence works | T06 | 1 | Passed |
| Reset functionality works | T13 | 6 | Passed |
| Analysis report downloads successfully | T12 | 17 | Passed |
| Downloaded report reflects current data | T12 | 17 | Passed |
| Dataset export downloads successfully | T11 | 7 | Passed |
| Exported data matches the analysed dataset | T11 | 7 | Passed |
| Mobile and desktop layouts work | T14 | 9 | Passed |
| GitHub Pages deployment paths are valid | T15 | 5 | Passed |

**Not tested:** an actual publish to GitHub Pages. No repository was pushed from this environment. The checks in T15 confirm the conditions GitHub Pages needs: every asset path is relative, every referenced file exists, no server code or external request is used, and the page works when opened directly from disk. Browsers other than Chromium (Firefox, Safari) and screen-reader software were not tested.

## All checks

### T01 load and KPI accuracy

| Check | Result | Detail |
|---|---|---|
| 9,216 visits loaded over 579 calendar days | Pass | 9216 visits, 579 days |
| KPI per_day matches pandas | Pass | dashboard 15.917098445595855 vs python 15.917098445595855 |
| KPI avg_wait matches pandas | Pass | dashboard 35.25987413194444 vs python 35.25987413194444 |
| KPI median_wait matches pandas | Pass | dashboard 35 vs python 35 |
| KPI p90_wait matches pandas | Pass | dashboard 56 vs python 56 |
| KPI pct_over matches pandas | Pass | dashboard 59.32074652777778 vs python 59.32074652777778 |
| KPI adm_rate matches pandas | Pass | dashboard 50.04340277777778 vs python 50.04340277777778 |
| KPI ref_rate matches pandas | Pass | dashboard 41.40625 vs python 41.40625 |
| KPI resp_rate matches pandas | Pass | dashboard 27.311197916666668 vs python 27.311197916666668 |
| KPI avg_sat matches pandas | Pass | dashboard 4.992054032578467 vs python 4.992054032578467 |
| KPI pct_satisfied matches pandas | Pass | dashboard 26.261422328168454 vs python 26.261422328168454 |
| busiest weekday, hour and month match pandas | Pass | Saturday, 23, 2024-08 |
| surge days (mean + 2 SD) identical to pandas | Pass | 18 days, threshold 23.370771154663526 |
| visits by month identical | Pass | 19 months |
| average visits per weekday identical | Pass |  |
| visits by hour identical | Pass |  |
| admissions and average wait by referral identical | Pass |  |
| Kruskal-Wallis wait by referral matches SciPy | Pass | H 6.0992548699874405, p 0.5282089344298084 |
| Kruskal-Wallis wait by weekday matches SciPy | Pass |  |
| Kruskal-Wallis wait by hour matches SciPy | Pass |  |
| Kruskal-Wallis wait by age group matches SciPy | Pass |  |
| chi-square admission by referral matches SciPy | Pass | p 0.7997833577416127 |
| chi-square admission by age group matches SciPy | Pass |  |
| Spearman wait vs satisfaction matches SciPy | Pass |  |
| Pearson wait vs satisfaction matches SciPy | Pass |  |
| Kruskal-Wallis satisfaction tests (5 groupings) match SciPy | Pass |  |
| browser pseudonymisation of 200 raw IDs equals the Python keys | Pass | Pf1fd232a8697 |
| KPI cards show formatted values | Pass | Total visits iTotal visitsCount of ED visits (rows) in the current view.Average visits per calendar day, and the latest  |

### T02 charts render

| Check | Result | Detail |
|---|---|---|
| overview: cMonth has data | Pass | 1 series with data |
| overview: cWaitHistOv has data | Pass | 2 series with data |
| flow: cDaily has data | Pass | 2 series with data |
| flow: cWeekday has data | Pass | 1 series with data |
| flow: cHour has data | Pass | 1 series with data |
| flow: cHeat has data | Pass | 1 series with data |
| wait: cWaitHist has data | Pass | 2 series with data |
| wait: cWaitRef has data | Pass | 1 series with data |
| wait: cWaitHour has data | Pass | 1 series with data |
| wait: cWaitDay has data | Pass | 1 series with data |
| wait: cWaitMonth has data | Pass | 1 series with data |
| admit: cRefVol has data | Pass | 2 series with data |
| admit: cAdmRef has data | Pass | 1 series with data |
| admit: cAdmAge has data | Pass | 1 series with data |
| admit: cAdmMonth has data | Pass | 1 series with data |
| experience: cSatWait has data | Pass | 3 series with data |
| experience: cSatMix has data | Pass | 3 series with data |
| experience: cSatGroup has data | Pass | 3 series with data |
| experience: cSatDist has data | Pass | 1 series with data |
| satisfaction test table lists 6 groupings | Pass | 6 |
| measure and grouping selectors switch without errors | Pass |  |

### T03 filters

| Check | Result | Detail |
|---|---|---|
| month filter Apr 2024 to Oct 2024 keeps exactly the matching visits in the file | Pass | 3428 vs 3428 |
| calendar days recomputed for the period (2024-04-01 to 2024-10-30 = 213) | Pass | 213 |
| referral filter: General Practice only | Pass | 1840 vs 1840 |
| active filter chip shown | Pass | Referral: General Practice ✕ |
| removing a chip removes that filter | Pass | 9216 |
| gender + admission filters combine (female and admitted) | Pass | 2250 vs 2250 |
| data explorer reflects filters | Pass | 2,250 of 9,216 visits (2,250 after filters). Page 1 of 45. |
| explorer search narrows rows (Renal = 86) | Pass | 86 of 9,216 visits (9,216 after filters, 86 matching "Renal"). Page 1 of 2. |
| explorer sorting toggles ascending/descending | Pass | 10 / 60 |
| pagination controls rendered | Pass | 5 |
| wait target 45 min: share over target recalculated | Pass | 29.83940972222222 vs 29.83940972222222 |
| non-default target shown as a chip | Pass |  |
| removing target chip returns to 30 min | Pass |  |
| clicking a department bar filters the dashboard to it (Orthopedics = 995) | Pass | 995 |

### T04 invalid files

| Check | Result | Detail |
|---|---|---|
| missing required column rejected with explanation | Pass | Upload rejected: required columns missing. "02_missing_required_column.csv" has no column for: Patient Waittime.           Columns found: "P |
| wrong file type rejected | Pass | The file could not be used. "10_wrong_type.txt" is a .txt file. Please upload a CSV, Excel (.xlsx) or JSON file. Nothing |
| file over 10 MB rejected | Pass | The file could not be used. The file is 10.5 MB. The limit is 10 MB. Nothing was changed. |
| dataset unchanged after rejected files | Pass |  |

### T05 append upload

| Check | Result | Detail |
|---|---|---|
| preview: 12 rows, 11 valid, 1 invalid, 1 duplicate, 10 new | Pass | {"rows in file":12,"passed validation":11,"invalid (rejected)":1,"duplicates":1,"existing visits with different values":0,"new visits to add |
| rejection reasons listed (impossible date, bad flag, bad wait) | Pass |  |
| name columns reported as dropped | Pass |  |
| validation results downloadable | Pass | upload_validation_01_append_valid_with_duplicate_and_invalid.csv_2026-11-09.csv |
| confirmation sentence uses actual counts | Pass | Data successfully added. 12 records were processed, 10 were accepted (10 added), 1 duplicate was detected and 1 record was rejected.All KPIs |
| dataset grows to 9,226 visits | Pass | 9226 |
| stored records hold no names and no original IDs | Pass | _batch,admitted,age,arrival,cm_flag,gender,race,referral,satisfaction,visit_key,wait_min |
| day-first dates parsed correctly (14-11-2024 07:11 -> 2024-11-14 07:11) | Pass | 2024-11-14 07:11 |
| month filter gains Nov 2024 | Pass |  |
| header shows working dataset status | Pass | Working dataset: 9,226 visits (1 upload in this browser) |

### T06 local persistence

| Check | Result | Detail |
|---|---|---|
| after reload the working dataset (9,226 visits, 1 upload) is restored from IndexedDB | Pass | 9226, 1 |

### T07 duplicate handling

| Check | Result | Detail |
|---|---|---|
| re-uploading the same file adds nothing and reports 11 duplicates | Pass | {"rows in file":12,"passed validation":11,"invalid (rejected)":1,"duplicates":11,"existing visits with different values":0,"new visits to ad |
| apply button disabled when nothing to add | Pass |  |
| duplicate rows inside one file detected | Pass | {"rows in file":3,"passed validation":2,"invalid (rejected)":0,"duplicates":1,"existing visits with different values":0,"new visits to add": |

### T08 update or add (merge)

| Check | Result | Detail |
|---|---|---|
| append mode flags the changed existing visit as a conflict | Pass | {"rows in file":2,"passed validation":2,"invalid (rejected)":0,"duplicates":0,"existing visits with different values":1,"new visits to add": |
| merge mode: 1 update, 1 insert | Pass | {"rows in file":2,"passed validation":2,"invalid (rejected)":0,"duplicates":0,"new visits to add":1,"visits to update":1,"already identical" |
| late satisfaction score merged into the existing visit and response count recalculated | Pass | 9, responses 2520 -> 2521 |
| dataset now 9,227 visits | Pass | 9227 |

### T09 JSON, XLSX and alternative headers

| Check | Result | Detail |
|---|---|---|
| JSON: 4 visits accepted | Pass | {"rows in file":4,"passed validation":4,"invalid (rejected)":0,"duplicates":0,"existing visits with different values":0,"new visits to add": |
| XLSX: 5 visits accepted | Pass | {"rows in file":5,"passed validation":5,"invalid (rejected)":0,"duplicates":0,"existing visits with different values":0,"new visits to add": |
| Excel date-time and boolean cells read correctly | Pass | 2024-12-20 09:30/0 |
| alternative names mapped and reported | Pass |  |
| ISO dates, Female/Male and Yes/No normalised | Pass | 2024-11-02 08:15/F/1/Neurology;2024-11-02 09:40/M/0/None |
| dataset now 9,239 visits | Pass | 9239 |

### T10 security

| Check | Result | Detail |
|---|---|---|
| HTML in uploaded text is shown as text, not executed | Pass | img elements 0, alerts 0 |
| exported CSV neutralises formula text | Pass |  |

### T11 data export

| Check | Result | Detail |
|---|---|---|
| full CSV export has every analysed visit | Pass | 9241 rows vs 9241 |
| export has no names or original IDs | Pass |  |
| export includes uploaded visits and the source column | Pass |  |
| all 9,216 base visits in the export match the pandas analysis file (17 fields each) | Pass |  |
| filtered CSV export matches filtered view | Pass | 2456 vs 2456; er_visits_analysis_filtered_2026-11-09.csv |
| XLSX export opens with visits, 4 summary sheets and About | Pass | ['Visits', 'By month', 'By weekday', 'By hour', 'By referral', 'About'] 9241 21 |
| department summary CSV downloads | Pass | er_referral_department_summary_filtered_2026-11-09.csv |

### T12 PDF report

| Check | Result | Detail |
|---|---|---|
| filtered report downloads as a valid PDF | Pass | 8 pages, ed_performance_report_filtered_2026-11-09.pdf |
| report states scope and filters | Pass |  |
| report has section "1. Business context" | Pass |  |
| report has section "2. Purpose and objectives" | Pass |  |
| report has section "3. Dataset overview" | Pass |  |
| report has section "4. Data preparation and privacy" | Pass |  |
| report has section "5. Analytical methods" | Pass |  |
| report has section "6. KPI definitions" | Pass |  |
| report has section "7. Results by objective" | Pass |  |
| report has section "8. Key findings" | Pass |  |
| report has section "9. Areas requiring management attention" | Pass |  |
| report has section "11. Recommendations" | Pass |  |
| report has section "12. Limitations" | Pass |  |
| report reflects uploaded data (upload history) | Pass |  |
| full-dataset report covers every visit | Pass | 9241 visits |
| report has 8 embedded chart images | Pass |  |
| report text is plain ASCII (no broken glyphs) | Pass |  |

### T13 undo and reset

| Check | Result | Detail |
|---|---|---|
| undo removes the last upload (security file) | Pass | 9239, 5 |
| replace asks for confirmation | Pass |  |
| replace leaves only the 60 visits in the file | Pass | 60 visits, 46 days |
| undoing a replace restores the previous dataset | Pass | 9239 |
| reset returns to the original 9,216 visits | Pass |  |
| after reset and reload, local data is gone | Pass |  |

### T14 layout and accessibility

| Check | Result | Detail |
|---|---|---|
| dark mode applied | Pass |  |
| arrow keys move between tabs | Pass |  |
| visible charts have text alternatives (aria-label) | Pass |  |
| mobile 390px: no horizontal page scroll on overview | Pass | overflow 0px |
| mobile 390px: no horizontal page scroll on flow | Pass | overflow 0px |
| mobile 390px: no horizontal page scroll on wait | Pass | overflow 0px |
| mobile 390px: no horizontal page scroll on experience | Pass | overflow 0px |
| mobile 390px: no horizontal page scroll on data | Pass | overflow 0px |
| tablet 820px: no horizontal page scroll | Pass |  |

### T15 deployment

| Check | Result | Detail |
|---|---|---|
| all asset references are relative | Pass |  |
| every referenced file exists | Pass |  |
| dashboard also works opened directly from disk (file://) | Pass | 9216 visits;  |
| no network requests to external hosts | Pass |  |
| embedded base data has no name columns and no SSN-style IDs | Pass |  |

### T16 console

| Check | Result | Detail |
|---|---|---|
| no JavaScript errors during the whole run | Pass |  |

## Test data

The upload test files in `tests/data/` (created by `tests/make_test_files.py`) contain fictional visits with invented IDs (TEST-, MERGE-, ALIAS-, DUP-, REPL-, SAFE-, JSON-, XLSX-) and a fictional name column, plus two rows copied from the de-identified base data (pseudonymous keys only) to test duplicate detection and merging. They are test fixtures, not patient data.

## How to re-run

```bash
python -m http.server 8765 &
python scripts/prepare_data.py   # needs data/raw/Hospital_ER_Data.csv
python tests/make_test_files.py
node tests/run_tests.js
python tests/make_test_report.py
```
