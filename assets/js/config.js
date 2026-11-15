/* config.js - schema, business rules, thresholds and KPI definitions. Every analytical convention lives here so it
   can be reviewed and changed in one place. */
(function () {
  'use strict';
  const n = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const uniq = (a) => [...new Set(a)];
  // Upload schema. The first alias is the standard name; the others are recognised alternatives (matched ignoring case,
  // spaces and punctuation).
  const FIELDS = [
    { key: 'patient_id', label: 'Patient Id', type: 'text', required: true, unit: '', desc: 'Visit identifier. Replaced by a pseudonymous key (P + 12 hex characters of SHA-256) when read; the original ID is never stored',
      aliases: uniq(['Patient Id', 'Patient ID', 'Visit Id', 'Visit Key', 'Patient Key', 'ID'].map(n)) },
    { key: 'arrival', label: 'Patient Admission Date', type: 'datetime', required: true, unit: 'date-time', desc: 'Arrival date and time at the ED: dd-mm-yyyy HH:MM (day first), dd/mm/yyyy HH:MM or yyyy-mm-dd HH:MM',
      aliases: uniq(['Patient Admission Date', 'Admission Date', 'Arrival', 'Arrival Date', 'Arrival Date Time', 'Visit Date', 'Date'].map(n)) },
    { key: 'gender', label: 'Patient Gender', type: 'text', required: false, unit: 'M / F / NC', desc: 'M, F or NC (not specified). Male/Female are accepted',
      aliases: uniq(['Patient Gender', 'Gender', 'Sex'].map(n)) },
    { key: 'age', label: 'Patient Age', type: 'int', required: false, unit: 'years', min: 0, max: 120, desc: 'Age in whole years (0-120)',
      aliases: uniq(['Patient Age', 'Age'].map(n)) },
    { key: 'race', label: 'Patient Race', type: 'text', required: false, unit: '', desc: 'Self-reported race/ethnicity group',
      aliases: uniq(['Patient Race', 'Race', 'Ethnicity'].map(n)) },
    { key: 'referral', label: 'Department Referral', type: 'text', required: false, unit: '', desc: "Department the patient was referred to; 'None' or blank = no referral",
      aliases: uniq(['Department Referral', 'Referral', 'Referral Department', 'Department'].map(n)) },
    { key: 'admitted', label: 'Patient Admission Flag', type: 'bool', required: true, unit: 'TRUE / FALSE', desc: 'Whether the patient was admitted to hospital (TRUE/FALSE, Yes/No, 1/0)',
      aliases: uniq(['Patient Admission Flag', 'Admission Flag', 'Admitted', 'Admission'].map(n)) },
    { key: 'satisfaction', label: 'Patient Satisfaction Score', type: 'num', required: false, unit: '0-10', min: 0, max: 10, desc: 'Survey score 0-10; blank = no survey response',
      aliases: uniq(['Patient Satisfaction Score', 'Satisfaction Score', 'Satisfaction'].map(n)) },
    { key: 'wait_min', label: 'Patient Waittime', type: 'num', required: true, unit: 'minutes', min: 0, max: 1440, desc: 'Waiting time in minutes (0-1440)',
      aliases: uniq(['Patient Waittime', 'Patient Wait Time', 'Wait Time', 'Waiting Time', 'Wait Minutes', 'Wait'].map(n)) },
    { key: 'cm_flag', label: 'Patients CM', type: 'flag', required: false, unit: '0 / 1', desc: 'Flag supplied in the source; its meaning is not documented, so it is stored but not analysed',
      aliases: uniq(['Patients CM', 'Patient CM', 'CM'].map(n)) },
  ];
  // Columns with personal names: recognised so that they are explicitly dropped (never stored, never exported).
  const DROP_ALIASES = uniq(['Patient First Inital', 'Patient First Initial', 'First Initial', 'First Name', 'Patient First Name', 'Patient Last Name', 'Last Name', 'Surname', 'Patient Name', 'Name'].map(n));

  const AGE_BANDS = [[0, 4, '0-4'], [5, 12, '5-12'], [13, 17, '13-17'], [18, 29, '18-29'], [30, 44, '30-44'], [45, 64, '45-64'], [65, 200, '65+']];
  const WAIT_BANDS = [[0, 15, '0-15'], [16, 30, '16-30'], [31, 45, '31-45'], [46, 60, '46-60'], [61, 1e9, '61+']];
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const GENDER_LABEL = { M: 'Male', F: 'Female', NC: 'NC - not specified' };

  const RULES = {
    maxFileBytes: 10 * 1024 * 1024, maxRows: 50000,
    waitTargets: [15, 20, 30, 45, 60], defaultTarget: 30,       // assumption: 30 minutes; selectable in the filter bar
    satisfiedMin: 8,                                             // a score of 8-10 counts as "satisfied"
    alpha: 0.05,                                                 // significance level for all tests
    peakSd: 2,                                                   // a peak day has more visits than mean + 2 standard deviations
    minGroupN: 30,                                               // groups with fewer responses are shown but flagged as small
    evenSpreadPct: 10,                                           // busiest vs quietest weekday within 10% = demand evenly spread
    // illustrative management thresholds for the status column on Overview (adjust to local standards)
    status: {
      overTarget: { warn: 25, crit: 50 },                       // % of visits over the waiting-time target
      satisfied: { warn: 60, crit: 40 },                        // % of respondents scoring 8-10 (lower is worse)
      response: { warn: 50, crit: 25 },                         // survey response rate % (lower is worse)
    },
  };

  const KPI_DEFS = [
    { id: 'visits', name: 'Total visits', formula: 'Count of ED visits (rows) in the current view', compare: 'Average visits per calendar day, and the latest month vs the previous month (per day, so month length does not bias it)', unit: 'visits', fields: 'patient_id' },
    { id: 'avg_wait', name: 'Average wait', formula: 'Mean of waiting time in minutes', compare: 'Median shown alongside; latest month vs previous month', unit: 'minutes', fields: 'wait_min' },
    { id: 'over_target', name: 'Over wait target', formula: 'Visits with wait > target / all visits x 100 (target selectable: 15, 20, 30, 45 or 60 min; default 30)', compare: 'Latest month vs previous month (pp); status thresholds 25% and 50%', unit: '%', fields: 'wait_min' },
    { id: 'admission', name: 'Admission rate', formula: 'Visits with admission flag TRUE / all visits x 100', compare: 'Latest month vs previous month (pp)', unit: '%', fields: 'admitted' },
    { id: 'referral', name: 'Referral rate', formula: "Visits referred to a department (referral not 'None') / all visits x 100", compare: 'Share of all visits', unit: '%', fields: 'referral' },
    { id: 'satisfaction', name: 'Average satisfaction', formula: 'Mean score (0-10) among patients who answered the survey; blanks excluded', compare: 'Share scoring 8-10 and the response rate shown alongside', unit: 'score 0-10', fields: 'satisfaction' },
    { id: 'response', name: 'Survey response rate', formula: 'Visits with a satisfaction score / all visits x 100', compare: 'Status thresholds 50% and 25%', unit: '%', fields: 'satisfaction' },
    { id: 'peak', name: 'Peak demand', formula: 'Busiest weekday and hour by average visits per calendar day; peak days = days with visits > mean + 2 SD', compare: 'Busiest vs quietest weekday (%)', unit: 'visits a day', fields: 'arrival' },
  ];

  // measures available in the monthly trend and the hour / weekday charts
  const MEASURES = {
    visits_per_day: { label: 'Visits per day', unit: 'num' },
    avg_wait: { label: 'Average wait (min)', unit: 'min' },
    median_wait: { label: 'Median wait (min)', unit: 'min' },
    pct_over: { label: '% over wait target', unit: 'pct' },
    adm_rate: { label: 'Admission rate (%)', unit: 'pct' },
    avg_sat: { label: 'Average satisfaction (0-10)', unit: 'score' },
    resp_rate: { label: 'Survey response rate (%)', unit: 'pct' },
  };
  const GROUPS = { referral: 'Referral department', gender: 'Gender', age_group: 'Age group', race: 'Race', admitted_label: 'Admission status', wait_band: 'Wait band (min)' };

  window.ErConfig = { FIELDS, DROP_ALIASES, AGE_BANDS, WAIT_BANDS, DAYS, GENDER_LABEL, RULES, KPI_DEFS, MEASURES, GROUPS };
})();
