# Methodology

## 1. Data preparation

The same rules run in Python (`scripts/prepare_data.py`, the reference) and in the browser (`assets/js/data-processing.js`, used for the base data and for every upload).

| Rule | Field | Action | Rows (base data) |
|---|---|---|---:|
| C1 | First initial, last name | Dropped when a file is read (data minimisation) | 9,216 |
| C2 | Patient Id | Replaced by `P` + first 12 hex characters of SHA-256(ID); the original ID is not kept | 9,216 |
| C3 | Admission date | Day-first text parsed to date-time; impossible dates (for example 31-02) rejected | 9,216 |
| C4 | Referral | `None` (or blank) kept as "no specialty referral" | 5,400 |
| C5 | Satisfaction | Blank = no survey response; never imputed | 6,699 |
| C6 | Gender | `NC` kept as "not specified" | 24 |
| C7 | Admission flag | TRUE/FALSE converted to 1/0 | 9,216 |

**Validation.** Rows are rejected when any of these is missing or invalid: ID, arrival date-time, wait time (0-1440 minutes), or admission flag. Optional fields that are invalid are stored as missing, with a warning shown to the user. Duplicate visits (same key and arrival time) within one file are rejected.

**Upload modes:**
- **Append:** adds new visits only.
- **Merge:** updates matching visits. Only the columns present in the file are written, and blank cells keep the existing value, so a late satisfaction score can be added.
- **Replace:** asks for confirmation first, and can be undone.

## 2. Pseudonymisation, not anonymisation

Hashing the ID removes the readable identifier from everything the dashboard shows, stores and exports. It is **not** anonymisation, for two reasons:
- An unsalted hash of a 9-digit ID can be reversed by trying every possible ID.
- Age, race, gender and an exact arrival time can together single out a person.

A secret salt would make the hash much harder to reverse. It was not used here because the browser must produce the same keys as the published base data, and any salt shipped in a public static site would not be secret. The source data appears fictional, which makes this acceptable for a portfolio project. With real patient data:
- use a keyed hash (HMAC) whose key is held outside the repository;
- coarsen arrival times and ages;
- never upload records to a shared or public copy of the dashboard.

## 3. Measures

| Measure | Definition |
|---|---|
| Visits per day | Visits divided by calendar days in the selected months, clipped to the first and last arrival in the data. Days with no visits count as zero. |
| Weekday average | Visits on that weekday divided by the number of times that weekday occurs in the period |
| Hour average | Visits in that hour divided by calendar days |
| Surge day | Daily visits above mean + 2 standard deviations (sample SD) of daily visits in view |
| Average and median wait, 90th percentile | Mean, median and linear-interpolated 90th percentile of wait_min |
| % over target | Share of visits with wait_min greater than the target (15, 20, 30, 45 or 60 min; default 30) |
| Admission rate, referral rate | Share of visits admitted, or referred to a specialty department |
| Response rate | Share of visits with a satisfaction score |
| Average satisfaction, % satisfied | Mean score and share scoring 8-10, among respondents only |
| Month-on-month change | Latest month in view vs the month before. Visits are compared per calendar day, so month length does not bias the comparison. |
| Year-on-year | The same months of the year in the last two calendar years in view (Apr-Oct 2023 vs Apr-Oct 2024) |

## 4. Statistical tests (significance level 0.05)

| Question | Test | Why this test |
|---|---|---|
| Do waits differ by referral department, weekday, hour or age group? | Kruskal-Wallis H with tie correction; effect size epsilon squared | Waits are not normally distributed (nearly uniform from 10 to 60 minutes); comparing ranks is robust to this |
| Does admission depend on referral department or age group? | Pearson chi-square test of independence (no continuity correction); Cramer's V | Two categorical variables |
| Is waiting time related to satisfaction? | Spearman rank correlation (Pearson reported alongside) | Satisfaction is an ordinal 0-10 score |
| Does satisfaction differ between patient groups? | Kruskal-Wallis on respondents only | Ordinal outcome; several groups |
| How precise is a group's mean satisfaction? | 95% confidence interval: mean ± t(0.975, n-1) × SD / sqrt(n) | Shown as error bars |
| Are respondents different from non-respondents? | Comparison of average wait and of response rate by admission status | Checks for response bias |

The JavaScript versions of these tests were written for this project (`assets/js/utils.js`). They reproduce SciPy to at least 6 significant figures, which the automated tests check. With 9,216 visits, even tiny differences can reach significance, so the effect size is reported next to every test. The one significant wait test (age group, p = 0.010) has epsilon squared = 0.001, which is negligible.

## 5. Status and insight rules

Status thresholds are illustrative management conventions, set in `assets/js/config.js`:

| Area | Warning | Critical |
|---|---|---|
| % of visits over the wait target | over 25% | over 50% |
| % of respondents scoring 8-10 | under 60% | under 40% |
| Survey response rate | under 50% | under 25% |
| Surge days | any surge day | - |

Admissions have no target in the brief, so they are labelled "Monitor".

Key findings and recommendations come from fixed rules applied to the numbers currently in view. Each one shows its rule or its evidence. For example, the "map the patient journey" recommendation appears only when waits exceed the target and the hour and weekday tests are both non-significant. No result text is pre-written.

## 6. Verification

`scripts/prepare_data.py` produces every reference value independently with pandas and SciPy. `tests/run_tests.js` compares the dashboard against those values, and compares the dashboard's export field by field with the pandas analysis file. Results are in `tests/test-report.md`.
