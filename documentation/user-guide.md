# User guide

## Opening the dashboard

- **Online:** open the GitHub Pages address of the repository.
- **On your computer:** double-click `index.html`, or run `python -m http.server 8765` in the project folder and open `http://localhost:8765`.

All analysis runs in your browser. Nothing is sent to a server.

## The header

| Item | What it does |
|---|---|
| Dataset status pill | Shows "Original dataset" or "Working dataset". Working dataset means data has been added in this browser. |
| **Generate Analysis Report** | Creates a PDF report of the current filtered view or of the whole dataset |
| **Download Analysis Data** | Exports the cleaned, de-identified visit records (CSV, or Excel with summary sheets) |
| Moon icon | Switches between light and dark mode (your choice is remembered) |

## Filters

The filter bar applies to every tab, the report and the exports.

- **From / To:** month range.
- **Wait target:** what counts as a long wait (15, 20, 30, 45 or 60 minutes; default 30). It changes "% over target" everywhere.
- **Referral, Age, Gender, Race:** tick the groups to include. Use All or None for quick selection.
- **Admission:** all visits, admitted only, or not admitted only.
- **Chips** under the filter bar show what is active. Click a chip to remove that filter. **Reset filters** clears everything.
- **Shortcut:** click a month in a monthly chart, or a department bar or box, to filter the whole dashboard to it.

## Tabs

| Tab | Answers |
|---|---|
| Overview | How are we doing? Shows KPI cards with month-on-month change and status, key findings, areas needing attention, the waiting-time distribution and recommended actions. |
| Patient flow | How many patients come, and when? Shows daily visits with surge days, weekday and hour profiles, a day x hour heatmap, a surge-day list and a monthly table. |
| Waiting times | How long do patients wait, and is it worse at certain times or for certain departments? Shows a distribution, a box plot by department, wait by hour, weekday and month, and statistical tests. |
| Admissions & referrals | Who is admitted, and which departments generate admissions? Shows volumes, rates by department, age and month, and a summary table. |
| Patient experience | Do longer waits mean lower satisfaction? Which groups are less satisfied? Shows satisfaction by wait band with confidence intervals, score mix, correlation, satisfaction by group, tests and a response check. |
| Data explorer | The records behind every chart: search, sort, choose columns, page through |
| Add data | Upload new visits, see the validation check, apply, undo or reset |
| Methodology & help | KPI definitions, cleaning rules, analysis and status rules, upload format |

**Reading the charts**
- Hover any chart for exact values. Use ⤢ for full screen.
- Pale bars mark groups with fewer than 30 cases.
- Status badges always combine an icon and a word, not colour alone: ✓ On track, ! Warning, ✕ Critical, i Monitor.

## Adding data

1. Open **Add data**. Optionally download the blank template or the fictional test file.
2. Choose a mode:
   - **Add new records:** new visits only; existing visits are untouched.
   - **Update or add:** matching visits (same patient ID and arrival time) are updated, and new ones are added. Blank cells keep existing values.
   - **Replace the whole dataset:** you will be asked to confirm.
3. Drag a CSV, XLSX or JSON file onto the box, or click to browse (limit 10 MB).
4. Read the **Upload check**:
   - counts of rows read, valid, invalid, duplicate and new;
   - how each column was matched;
   - which name columns were dropped;
   - the reason for every row not used.

   You can download the check as a CSV.
5. Click **Apply upload**. A confirmation message gives the actual counts, and every tab recalculates.
6. **Undo last upload** reverses the most recent upload. **Reset to the original dataset** removes all uploaded data from this browser.

**Your data stays in this browser.** It is saved in IndexedDB and reloaded the next time you open the dashboard on the same browser. Other people and other devices do not see it. Do not upload real patient data to a public copy of the dashboard.

## Reports and exports

- **PDF report** (about 8-9 pages):
  - scope and filters;
  - business context and objectives;
  - dataset and data preparation;
  - methods and KPI definitions;
  - results by objective, with 8 charts;
  - key findings and the attention table;
  - interpretation, recommendations and limitations.

  It is built from the data loaded at that moment, including uploads.
- **CSV export:** one row per visit with all derived fields and the record source. Text that could be read as a spreadsheet formula is prefixed with an apostrophe.
- **Excel export:** visits plus monthly, weekday, hour and department summaries, and an About sheet with the scope, filters and wait target.
- **Department summary (CSV):** on the Add data tab.
