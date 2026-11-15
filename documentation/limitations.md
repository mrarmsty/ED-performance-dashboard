# Limitations and assumptions

## Data

- **Likely synthetic data.** Several features suggest the data was generated for practice rather than recorded in a real hospital:
  - waits are spread almost evenly between 10 and 60 minutes;
  - 50.0% of visits are admitted;
  - volumes are nearly identical across weekdays and hours;
  - no wait, admission or satisfaction difference between groups reaches a meaningful size.

  The source is a widely shared practice dataset, and its origin and licence are not documented in the file. Findings illustrate the analytical method and should not be read as evidence about a real Emergency Department.
- **One waiting-time value per visit.** It is not stated which interval it measures (arrival to triage, to first clinician, or to decision). It is analysed as recorded.
- **Missing context.** There is no triage category or acuity, length of stay, outcome, staffing, bed occupancy or diagnosis. Waits therefore cannot be judged against clinical urgency or capacity.
- **Low survey coverage.** Satisfaction is available for 27.3% of visits. Respondents look similar to non-respondents in average wait (35.4 vs 35.2 min) and in admission (response rate 26.8% admitted vs 27.8% not admitted). Response bias on unmeasured factors cannot be ruled out.
- **Partial final month.** The data ends on 30 October 2024. Month-on-month comparisons use visits per calendar day, so the missing day does not distort them.
- **Undocumented flag.** The meaning of `Patients CM` is unknown, so it is stored but not analysed.

## Assumptions

- **Wait target.** The 30-minute default is an illustrative assumption. The dashboard offers 15, 20, 30, 45 and 60 minutes.
- **Status thresholds.** The values in `config.js` are illustrative management conventions, not national standards.
- **Referral.** `None` means no referral to a specialty department. Gender `NC` means not specified.
- **Date order.** Text dates without a leading 4-digit year are read day first, as in the source file.

## Method

- Statistical tests show whether differences are larger than chance. They do not show cause and effect.
- With about 9,000 visits, trivial differences can be statistically significant, so effect sizes are reported alongside.
- Groups with fewer than 30 cases are shown but flagged. The Renal group has 23 satisfaction responses, so its estimate is imprecise.

## Privacy

- Pseudonymisation with an unsalted SHA-256 hash is not anonymisation (see the methodology document, section 2).
- The raw file with names and SSN-style IDs is excluded from the public repository. The published data contains no names or original IDs.
- Do not upload real patient data to a public or shared copy of the dashboard.

## Technical

- Uploaded data is stored only in the current browser (IndexedDB). It is not shared with other visitors or devices, and it is lost if the user clears site data.
- File limits are 10 MB and 50,000 rows per upload, to keep analysis responsive in the browser.
- The automated tests ran in Chromium only. Firefox, Safari and screen-reader software were not tested.
- An actual publish to GitHub Pages was not performed from this environment. The tests confirm only the conditions it needs (relative paths, no server code).
