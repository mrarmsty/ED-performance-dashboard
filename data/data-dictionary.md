# Data dictionary

## 1. Source file (`data/raw/Hospital_ER_Data.csv`, not in the public repository)

The source file has 9,216 rows (one per Emergency Department visit) and 12 columns. It contains patient names and SSN-style identifiers. The values appear to be fictional, but the file is still excluded from the public repository through `.gitignore` as a precaution.

| Column | Type | Example | Notes |
|---|---|---|---|
| Patient Id | text | `###-##-####` (SSN-style) | Unique per row, so it identifies a visit. Replaced by a pseudonymous key and never published. |
| Patient Admission Date | text | `20-03-2024 08:47` | Arrival date and time, written day first (dd-mm-yyyy HH:MM). Covers 2023-04-01 to 2024-10-30. |
| Patient First Inital | text | `H` | Personal data, so it is dropped. The misspelling "Inital" comes from the source. |
| Patient Last Name | text | (surname) | Personal data, so it is dropped. |
| Patient Gender | text | `M`, `F`, `NC` | NC = not specified (24 visits). |
| Patient Age | integer | 1-79 | Age in years. |
| Patient Race | text | 7 groups | Includes "Declined to Identify". |
| Department Referral | text | `None`, `General Practice`, ... | 8 values. `None` = no referral to a specialty (5,400 visits). |
| Patient Admission Flag | text | `TRUE`, `FALSE` | Whether the patient was admitted to hospital. |
| Patient Satisfaction Score | number | 0-10 or blank | Blank = no survey response (6,699 visits, 72.7%). |
| Patient Waittime | integer | 10-60 | Waiting time in minutes. The stage of the journey it measures is not documented. |
| Patients CM | integer | 0 or 1 | Meaning not documented, so it is kept but not analysed. |

## 2. De-identified base dataset (`data/er_visits_deidentified.csv`, embedded in `data/base-data.js`)

This file has the same columns as the source, minus the two name columns. `Patient Id` holds the pseudonymous key: `P` followed by the first 12 hex characters of SHA-256 of the original ID (for example `Pf1fd232a8697`).

This file is also the **upload format**. The dashboard accepts it and the raw source format alike. When a raw ID is uploaded, the browser hashes it with the same rule, so the keys match.

## 3. Upload schema (what the dashboard accepts)

| Field | Required | Accepted values | Accepted column names (case, spaces and punctuation ignored) |
|---|---|---|---|
| Patient Id | Yes | Any text. Hashed unless it is already a `P` + 12-hex key. | Patient Id, Visit Id, Visit Key, Patient Key, ID |
| Patient Admission Date | Yes | `dd-mm-yyyy HH:MM`, `dd/mm/yyyy HH:MM`, `yyyy-mm-dd HH:MM[:SS]`, Excel date-time cells; years 2000-2100 | Patient Admission Date, Admission Date, Arrival, Arrival Date, Arrival Date Time, Visit Date, Date |
| Patient Waittime | Yes | Number from 0 to 1440 (minutes) | Patient Waittime, Patient Wait Time, Wait Time, Waiting Time, Wait Minutes, Wait |
| Patient Admission Flag | Yes | TRUE/FALSE, Yes/No, Y/N, 1/0, Excel booleans | Patient Admission Flag, Admission Flag, Admitted, Admission |
| Patient Gender | No | M/F/NC, Male/Female. Anything else is stored as NC with a warning. | Patient Gender, Gender, Sex |
| Patient Age | No | Whole number 0-120. Invalid values are stored as missing with a warning. | Patient Age, Age |
| Patient Race | No | Text (max 80 characters) | Patient Race, Race, Ethnicity |
| Department Referral | No | Text. Blank or `None` = no referral. | Department Referral, Referral, Referral Department, Department |
| Patient Satisfaction Score | No | 0-10 or blank. Out-of-range values are stored as no response with a warning. | Patient Satisfaction Score, Satisfaction Score, Satisfaction |
| Patients CM | No | 0/1 | Patients CM, Patient CM, CM |
| Name columns | - | Recognised and **dropped** | Patient First Inital/Initial, First Name, Last Name, Surname, Patient Name, Name |

**Business key.** The business key is the pseudonymous key plus the arrival date-time. The same key and time means the same visit. Repeat visits by the same patient at different times stay separate records.

## 4. Analysis fields (`data/processed/er_visits_analysis.csv` and the dashboard export)

| Field | Type | Definition |
|---|---|---|
| visit_key | text | Pseudonymous key (see section 2) |
| arrival | text | `yyyy-mm-dd HH:MM` |
| date, month, year | text / integer | Derived from arrival (`yyyy-mm-dd`, `yyyy-mm`, `yyyy`) |
| weekday, weekday_num | text / integer | Monday to Sunday; 1 = Monday |
| hour | integer | Hour of arrival, 0-23 |
| gender | text | M, F, NC (a blank value becomes NC) |
| age, age_group | integer / text | Age groups: 0-4, 5-12, 13-17, 18-29, 30-44, 45-64, 65+, Not recorded |
| race | text | As supplied; a blank value becomes "Not recorded" |
| referral, referred | text / 0-1 | referred = 1 when the referral is not `None` |
| admitted | 0-1 | 1 = admitted |
| wait_min, wait_band | number / text | Wait bands: 0-15, 16-30, 31-45, 46-60, 61+ minutes |
| over_target | 0-1 | 1 when wait_min > the selected target. The default target is 30 min; the Python file names this column `over_target_30`. |
| satisfaction, responded | number / 0-1 | responded = 1 when a score exists |
| sat_group, satisfied | text / 0-1 | Low 0-4, Medium 5-7, High 8-10; satisfied = score of 8 or more (respondents only) |
| cm_flag | 0-1 | Patients CM as supplied |
| record_source | text | `base dataset` or `upload <id>` (export only) |

## 5. Processed files written by `scripts/prepare_data.py`

| File | Content |
|---|---|
| `data/er_visits_deidentified.csv` | De-identified base data in the upload format |
| `data/processed/er_visits_analysis.csv` | 9,216 rows with all analysis fields (target 30) |
| `data/processed/cleaning_log.csv` | Rules C1-C7 with the number of rows affected |
| `data/processed/summary_by_month.csv`, `summary_by_weekday.csv`, `summary_by_hour.csv`, `summary_by_referral.csv` | Summary tables |
| `data/processed/reference_values.json` | KPIs, surge days and all statistical test results, used by the automated tests |
