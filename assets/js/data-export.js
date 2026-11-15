/* data-export.js - downloads of the data the dashboard is actually analysing (full or filtered), summary tables and
   the validation results of an upload. Exports contain only de-identified fields (no names, pseudonymous keys only).
   CSV text cells are protected against formula injection. */
(function () {
  'use strict';
  const U = window.ErUtils;

  const COLUMNS = ['visit_key', 'arrival', 'date', 'month', 'year', 'weekday', 'weekday_num', 'hour', 'gender', 'age', 'age_group', 'race', 'referral', 'referred',
    'admitted', 'wait_min', 'wait_band', 'over_target', 'satisfaction', 'responded', 'sat_group', 'satisfied', 'cm_flag', 'record_source'].map((k) => ({ key: k, label: k }));
  const MONTH_COLS = ['month', 'days', 'visits', 'visits_per_day', 'avg_wait', 'median_wait', 'pct_over', 'admissions', 'adm_rate', 'ref_rate', 'n_resp', 'resp_rate', 'avg_sat', 'pct_satisfied'];
  const WEEKDAY_COLS = ['weekday', 'occurrences', 'visits', 'visits_per_day', 'avg_wait', 'median_wait', 'pct_over', 'adm_rate', 'n_resp', 'avg_sat'];
  const HOUR_COLS = ['hour', 'visits', 'visits_per_day', 'avg_wait', 'median_wait', 'pct_over', 'adm_rate', 'n_resp', 'avg_sat'];
  const REF_COLS = ['referral', 'visits', 'share_pct', 'share_of_referred_pct', 'admissions', 'adm_rate', 'share_of_admissions_pct', 'avg_wait', 'median_wait', 'q1', 'q3', 'pct_over', 'n_resp', 'avg_sat', 'pct_satisfied'];
  const cols = (keys) => keys.map((k) => ({ key: k, label: k }));

  const round = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
  const pick = (rows, keys) => rows.map((r) => Object.fromEntries(keys.map((k) => [k, round(r[k])])));
  const prep = (rows) => rows.map((r) => { const o = {}; COLUMNS.forEach((c) => { o[c.key] = round(c.key === 'record_source' ? (r._batch && r._batch !== 'base' ? `upload ${r._batch}` : 'base dataset') : r[c.key]); }); return o; });
  const csvBlob = (csv) => new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });

  function dataCsv(rows, scope) {
    U.download(csvBlob(U.toCsv(prep(rows), COLUMNS)), `er_visits_analysis_${scope}_${U.stamp()}.csv`);
    return { rows: rows.length, columns: COLUMNS.length };
  }
  function referralCsv(refs, scope) { U.download(csvBlob(U.toCsv(pick(refs, REF_COLS), cols(REF_COLS))), `er_referral_department_summary_${scope}_${U.stamp()}.csv`); }
  function validationCsv(upload) {
    const c = [{ key: 'row', label: 'file_row' }, { key: 'key', label: 'visit_key_and_arrival' }, { key: 'outcome', label: 'outcome' }, { key: 'reason', label: 'reason' }];
    const rows = [
      ...upload.rejected.map((r) => ({ row: r.row, key: r.key, outcome: r.type === 'invalid' ? 'rejected' : r.type === 'conflict' ? 'not added (conflict)' : 'not added (duplicate)', reason: r.reason })),
      ...upload.warnings.map((w) => ({ row: w.row, key: '', outcome: 'accepted with warning', reason: `${w.field}: ${w.message}` })),
    ];
    U.download(csvBlob(U.toCsv(rows, c)), `upload_validation_${(upload.fileName || 'file').replace(/[^\w.-]+/g, '_')}_${U.stamp()}.csv`);
  }
  async function dataXlsx(ctx, scope, meta) {
    const wb = new window.ExcelJS.Workbook(); wb.creator = 'Emergency Department Performance Dashboard'; wb.created = new Date();
    const add = (name, c, data) => {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = c.map((x) => ({ header: x.label, key: x.key, width: Math.min(26, Math.max(10, x.label.length + 2)) }));
      data.forEach((d) => ws.addRow(d));
      ws.getRow(1).font = { bold: true }; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: c.length } };
    };
    add('Visits', COLUMNS, prep(ctx.rows));
    add('By month', cols(MONTH_COLS), pick(ctx.months, MONTH_COLS));
    add('By weekday', cols(WEEKDAY_COLS), pick(ctx.weekdays, WEEKDAY_COLS));
    add('By hour', cols(HOUR_COLS), pick(ctx.hours, HOUR_COLS));
    add('By referral', cols(REF_COLS), pick(ctx.refs, REF_COLS));
    const about = wb.addWorksheet('About');
    [['Export scope', scope === 'full' ? 'Full analysis dataset' : 'Currently filtered dataset'], ['Filters', meta.filters], ['Visits', ctx.rows.length],
      ['Wait target', `${meta.target} minutes (over_target = 1 when wait_min > ${meta.target})`], ['Generated', new Date().toISOString()], ['Dataset status', meta.status],
      ['Privacy', 'No names. visit_key is a pseudonymous key (P + 12 hex characters of SHA-256 of the original ID); the original ID is not included.'],
      ['Units', 'wait in minutes; rates and shares in %; satisfaction 0-10 (respondents only); *_per_day = per calendar day'],
      ['Definitions', 'See the Methodology tab of the dashboard and data/data-dictionary.md']].forEach((r) => about.addRow(r));
    about.getColumn(1).width = 18; about.getColumn(2).width = 100; about.getColumn(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    U.download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `er_visits_analysis_${scope}_${U.stamp()}.xlsx`);
  }

  window.ErExport = { dataCsv, dataXlsx, referralCsv, validationCsv, COLUMNS };
})();
