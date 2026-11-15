# Portfolio positioning

## Competencies demonstrated

| Competency | Evidence in this project |
|---|---|
| Business problem-solving | Turned management's concerns (waits, flow, admissions, satisfaction) into six objectives and 12 questions. Each one maps to a tab, chart, KPI or test, with an "areas needing attention" view for managers. |
| Healthcare operations analytics | Attendance per calendar day, demand heatmaps, surge-day detection, waiting-time targets and percentiles, admission and referral patterns, patient-experience measurement and response bias |
| Statistical reasoning | Kruskal-Wallis, chi-square with Cramer's V, Spearman and Pearson correlation, and 95% confidence intervals, all implemented in JavaScript and matched to SciPy. Effect sizes are reported so that "significant" is not mistaken for "important". |
| Analytical honesty | Recognised that the data is almost certainly synthetic and reported null results plainly, instead of over-interpreting tiny gaps |
| Data privacy | Dropped names, pseudonymised IDs (identically in Python and in the browser), kept the raw file out of the repository and documented why hashing is not anonymisation |
| Data cleaning and validation | Day-first date parsing with impossible-date rejection; an upload validator with column-name mapping, required fields, per-row reasons and duplicate detection on a defensible key (patient key + arrival time) |
| Dashboard development | Vanilla JavaScript application with 8 tabs, 19 interactive charts (Apache ECharts), click-to-filter, a configurable wait target, sortable and paginated tables, light and dark themes and a responsive layout |
| Data management | Append, update-or-add and replace modes; undo and reset; IndexedDB persistence; honest disclosure that changes stay in one browser |
| Reporting | Client-side PDF report (jsPDF) built from current data and filters; CSV and Excel exports with formula-injection protection |
| Testing and QA | 138 automated browser checks (Playwright). All KPIs, tests and 9,216 exported rows were cross-checked against pandas/SciPy. |

## Relevant roles

| Role | Fit | Why |
|---|---|---|
| Healthcare / NHS Data Analyst, Performance Analyst | Strongest | ED performance measures, waiting-time targets, demand patterns, patient experience, patient-data privacy |
| Business Intelligence Analyst | Strong | KPI design, interactive dashboard, filters, drill-down, exports and refreshable data |
| Data Analyst / Senior Data Analyst | Strong | End-to-end: data assessment, cleaning, statistics, validation, reporting and stakeholder communication |
| Operations / Process Improvement Analyst | Good | Evidence-based recommendations on rostering, surge planning and patient-journey mapping |
| Analytics Engineer | Partial | JavaScript data pipeline, validation, pseudonymisation and automated testing |

## CV entry

**Emergency Department Performance Dashboard** (HTML, CSS, JavaScript, Apache ECharts, jsPDF, ExcelJS, Playwright, Python/pandas/SciPy)

- Built an interactive dashboard analysing 9,216 Emergency Department visits (Apr 2023 - Oct 2024) covering attendance, waiting times, admissions, referrals and patient satisfaction, with an "areas needing attention" view and rule-based recommendations.
- Showed that 59% of patients waited longer than a 30-minute target, and that long waits were not tied to any hour, weekday or referral department (Kruskal-Wallis p > 0.08). This pointed management to process capacity rather than shift patterns, and found no link between waiting time and satisfaction (Spearman rho = -0.02).
- De-identified patient data by dropping names and pseudonymising IDs identically in Python and in the browser. Implemented validated CSV, Excel and JSON uploads with append, merge and replace modes, local persistence and PDF and Excel outputs that recalculate from the updated data.
- Verified every KPI and statistical test against an independent pandas/SciPy pipeline with 138 automated browser checks.

## Interview questions and answers

**1. What problem does the dashboard solve?**
Management was worried about long waits, patient flow, admissions and satisfaction, but had no shared view of the facts. The dashboard answers the 12 questions in the brief, flags which areas need attention against explicit thresholds, and recommends actions with their evidence. Managers can filter by period, department or patient group, and add new months of data themselves.

**2. The data looks unusually even. How did you handle that?**
I noticed it early:
- waits are spread almost uniformly between 10 and 60 minutes;
- exactly half of visits are admitted;
- volumes are flat across hours and weekdays.

That pattern suggests synthetic data. I didn't hide it or invent stories around small gaps. I tested every apparent difference and reported effect sizes, and the report says plainly that most differences are not significant. In an interview I'd say this is the right outcome: a dashboard that shows "no difference" when there is none is more useful than one that over-reads noise.

**3. Why Kruskal-Wallis rather than ANOVA?**
Waiting times are not normally distributed; they are roughly uniform. Satisfaction is an ordinal 0-10 score. Rank-based tests make no normality assumption. I added epsilon squared because with 9,216 rows even a tiny difference can be "significant": age group is significant (p = 0.010), but explains about 0.1% of the variation.

**4. How did you choose the 30-minute target?**
The brief asked for "% exceeding a defined waiting-time target" without defining one. I chose 30 minutes as a clearly labelled assumption and made it selectable (15 to 60 minutes) so managers can apply their local standard. Every KPI, chart, report and export follows the selected target.

**5. How did you protect patient privacy?**
- The source had names and SSN-style IDs. I dropped the names on reading and replaced each ID with a SHA-256-based key.
- The browser applies exactly the same rule, so uploaded raw files match existing visits without the original ID ever being stored.
- I kept the raw file out of the public repository.
- I documented that an unsalted hash is pseudonymisation, not anonymisation, and what I would do with real data: a keyed HMAC held outside the code, coarser ages and times, and no uploads to public copies.

**6. Is longer waiting associated with lower satisfaction?**
Not in this data. Spearman rho is -0.02 (p = 0.30) across 2,517 responses, and satisfaction by wait band ranges only from 4.9 to 5.4. The recommendation is therefore not "cut waits to raise satisfaction". It is to find the real drivers by adding survey questions on communication, pain management and staff attitude. I also checked for response bias: respondents waited 35.4 minutes on average vs 35.2 for non-respondents.

**7. Which periods have the highest demand?**
- **Weekdays:** Saturday is the busiest day at 16.6 visits a day, but only 9% above Wednesday, so weekly demand is fairly even.
- **Hours:** the hourly profile is flat, with 23:00 slightly highest.
- **Surge days:** these are where planning matters. I flagged 18 days above mean + 2 SD (more than 23.4 visits), with a maximum of 30.

The recommendation is a surge protocol rather than fixed weekend uplifts.

**8. Which referral departments generate the most admissions?**
General Practice generates 887 admissions and Orthopedics 498, but admission rates are the same across departments (chi-square p = 0.80, Cramer's V = 0.02). The larger counts come from volume, not from sicker referrals, which is why I suggested fast-track pathways with the two largest referrers.

**9. How do uploads work, and how do you avoid duplicates?**
The file is read in the browser and its columns are matched to the schema (including alternative names). Each row is validated and the reasons for every rejection are shown before anything changes. The business key is the pseudonymous patient key plus the arrival time, so a repeat visit by the same patient stays separate. The upload modes are:
- **Append:** skips identical visits and flags conflicting ones.
- **Merge:** updates them; blank cells keep existing values, so a late satisfaction score can be added.
- **Replace:** asks for confirmation.

Every upload can be undone.

**10. How did you know your numbers were right?**
I wrote an independent pandas/SciPy pipeline. The Playwright test suite compares it with the dashboard:
- every KPI, surge day, per-month, weekday, hour and department figure;
- every statistical test, to at least 6 significant figures;
- all 9,216 exported rows, field by field.

It also tests uploads, merges, undo, persistence, exports, the PDF, mobile layout and the file:// mode: 138 checks in total, all passing.

**11. What would you do next with real data?**
- Add triage category, time to first clinician, length of stay and outcome, so waits can be judged against clinical urgency.
- Add staffing and bed-occupancy data, to test the capacity explanation.
- Raise the survey response rate.
- Move the data to a governed backend with access control, since browser storage suits a demonstration but not shared operational use.
