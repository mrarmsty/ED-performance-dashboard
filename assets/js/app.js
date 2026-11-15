/* app.js - application state, rendering and user interaction.
   Data flow: stored records -> ErData.derive() -> filters -> ErAnalytics.analyse() -> charts, tables, KPIs, report, exports.
   Every change (filter, wait target, upload, undo, reset) re-runs that whole chain, so all views share one dataset. */
(function () {
  'use strict';
  const U = window.ErUtils, D = window.ErData, A = window.ErAnalytics, C = window.ErCharts, S = window.ErStore;
  const { KPI_DEFS, RULES, FIELDS, MEASURES, GROUPS, AGE_BANDS, GENDER_LABEL, DROP_ALIASES } = window.ErConfig;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = U.esc;
  const TABS = ['overview', 'flow', 'wait', 'admit', 'experience', 'explorer', 'data', 'method'];

  const state = {
    baseRecords: [], records: [], batches: [], updatedAt: null, storage: false,
    all: [], filtered: [], ctx: null, months: [], target: RULES.defaultTarget,
    filters: { monthFrom: '', monthTo: '', referrals: [], ages: [], genders: [], races: [], admission: 'all' },
    view: { tab: 'overview', monthMeasure: 'visits_per_day', waitMeasure: 'avg_wait', satGroup: 'referral',
      table: { search: '', cols: 'key', page: 1, size: 50, sort: 'arrival', dir: 1 }, sorts: {} },
    pending: null, dirty: new Set(),
  };

  // ================================================================ start-up
  async function init() {
    try {
      busy(true, 'Loading data...');
      const parsed = D.readCsvText(window.BASE_DATASET.csv);
      const map = D.mapColumns(parsed.headers);
      const v = D.validateRows(parsed.rows, map);
      state.baseRecords = v.accepted.map((r) => { const o = {}; D.INPUT_KEYS.forEach((k) => { o[k] = r[k]; }); o._batch = 'base'; return o; });
      state.baseCheck = { rows: parsed.rows.length, accepted: v.accepted.length, rejected: v.rejected.length, warnings: v.warnings.length };
      state.storage = await S.available();
      const saved = state.storage ? await S.load() : null;
      if (saved && Array.isArray(saved.records) && saved.records.length) {
        state.records = saved.records; state.batches = saved.batches || []; state.updatedAt = saved.updatedAt;
        if (RULES.waitTargets.includes(saved.target)) state.target = saved.target;
        toast(`Loaded your working dataset saved in this browser (${U.fmtNum(saved.records.length)} records).`);
      } else state.records = state.baseRecords.slice();
      try { const t = localStorage.getItem('er-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked */ }
      renderStatic();
      wire();
      recompute(true);
    } catch (e) {
      console.error(e);
      $('#main').insertAdjacentHTML('afterbegin', `<div class="msg err">The dashboard could not start: ${esc(e.message)}. Check that all files in assets/ and data/ were deployed.</div>`);
    } finally { busy(false); }
  }

  // ================================================================ recalculation
  function recompute(resetFilters = false) {
    state.all = D.derive(state.records, state.target);
    state.months = [...new Set(state.all.map((r) => r.month))].sort();
    const f = state.filters, mFirst = state.months[0], mLast = state.months[state.months.length - 1];
    if (resetFilters || !f.monthFrom) Object.assign(f, { monthFrom: mFirst, monthTo: mLast, referrals: [], ages: [], genders: [], races: [], admission: 'all' });
    if (f.monthFrom < mFirst || f.monthFrom > mLast) f.monthFrom = mFirst;
    if (f.monthTo > mLast || f.monthTo < mFirst) f.monthTo = mLast;
    const keep = (sel, key) => { const vals = new Set(state.all.map((r) => r[key])); return sel.filter((x) => x === '__none__' || vals.has(x)); };
    f.referrals = keep(f.referrals, 'referral'); f.ages = keep(f.ages, 'age_group'); f.genders = keep(f.genders, 'gender'); f.races = keep(f.races, 'race');
    buildFilterOptions();
    refresh();
  }
  function refresh() {
    state.filtered = A.applyFilters(state.all, state.filters);
    state.ctx = A.analyse(state.filtered, state.all, state.filters, state.target);
    state.view.table.page = 1;
    renderHeader(); renderChips();
    TABS.forEach((t) => state.dirty.add(t));
    renderTab(state.view.tab);
  }
  function renderTab(tab) {
    if (!state.dirty.has(tab)) return;
    state.dirty.delete(tab);
    ({ overview: renderOverview, flow: renderFlow, wait: renderWait, admit: renderAdmit, experience: renderExperience,
      explorer: renderExplorer, data: renderDataTab, method: renderMethod })[tab](!state.filtered.length);
  }
  const fullFilters = () => ({ monthFrom: state.months[0], monthTo: state.months[state.months.length - 1], referrals: [], ages: [], genders: [], races: [], admission: 'all' });
  function filterTo(key, value) {
    if (key === 'month') { state.filters.monthFrom = value; state.filters.monthTo = value; }
    else state.filters[key] = [value];
    buildFilterOptions(); refresh(); toast(`Filtered to ${key === 'month' ? U.monthLabel(value) : value}. Remove the chip to undo.`);
  }

  // ================================================================ header, filters, chips
  function renderHeader() {
    const modified = state.batches.length > 0;
    const st = $('#datasetStatus');
    st.textContent = modified ? `Working dataset: ${U.fmtNum(state.records.length)} visits (${state.batches.length} upload${state.batches.length > 1 ? 's' : ''} in this browser)` : `Original dataset: ${U.fmtNum(state.records.length)} visits`;
    st.classList.toggle('modified', modified);
    const a = state.all;
    $('#datasetScope').textContent = a.length ? `${a[0].date} to ${a[a.length - 1].date}` : '';
    $('#lastUpdated').textContent = modified ? `Data last changed ${new Date(state.updatedAt).toLocaleString('en-GB')}` : `Source: ${window.BASE_DATASET.name}`;
  }
  function datasetStatusText() {
    return state.batches.length ? `Working dataset modified in this browser: ${state.batches.length} upload(s), last change ${new Date(state.updatedAt).toLocaleString('en-GB')}` : `Original dataset (${window.BASE_DATASET.name}), unmodified`;
  }
  const MULTI = [
    { box: '#fRef', key: 'referrals', field: 'referral', val: '#fRefVal', label: 'Referral', order: null },
    { box: '#fAge', key: 'ages', field: 'age_group', val: '#fAgeVal', label: 'Age', order: [...AGE_BANDS.map((b) => b[2]), 'Not recorded'] },
    { box: '#fGender', key: 'genders', field: 'gender', val: '#fGenderVal', label: 'Gender', order: ['F', 'M', 'NC'], fmt: (v) => GENDER_LABEL[v] || v },
    { box: '#fRace', key: 'races', field: 'race', val: '#fRaceVal', label: 'Race', order: null },
  ];
  function buildFilterOptions() {
    const f = state.filters;
    const opt = (sel) => state.months.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${U.monthLabel(m)}</option>`).join('');
    $('#fFrom').innerHTML = opt(f.monthFrom); $('#fTo').innerHTML = opt(f.monthTo);
    $('#fTarget').innerHTML = RULES.waitTargets.map((t) => `<option value="${t}" ${t === state.target ? 'selected' : ''}>${t} min</option>`).join('');
    $('#fAdm').value = f.admission;
    MULTI.forEach((m) => {
      const counts = new Map(); state.all.forEach((r) => counts.set(r[m.field], (counts.get(r[m.field]) || 0) + 1));
      const vals = [...counts.keys()].sort((a, b) => (m.order ? m.order.indexOf(a) - m.order.indexOf(b) : counts.get(b) - counts.get(a)));
      const sel = f[m.key];
      $(m.box).innerHTML = vals.map((v) => `<label><input type="checkbox" value="${esc(v)}" ${!sel.length || sel.includes(v) ? 'checked' : ''}> ${esc(m.fmt ? m.fmt(v) : v)} <small class="note">(${U.fmtNum(counts.get(v))})</small></label>`).join('')
        + '<div class="menu-actions"><button type="button" data-all>All</button><button type="button" data-none>None</button></div>';
    });
    updateFilterLabels();
  }
  function readMulti(box) { const all = $$(`${box} input`).length; const checked = $$(`${box} input:checked`).map((i) => i.value);
    return checked.length === all ? [] : checked.length === 0 ? ['__none__'] : checked; }
  function updateFilterLabels() {
    MULTI.forEach((m) => { const s = state.filters[m.key]; const show = (v) => (m.fmt ? m.fmt(v) : v);
      $(m.val).textContent = !s.length ? 'All' : s.includes('__none__') ? 'None' : s.length === 1 ? show(s[0]) : `${s.length} selected`; });
  }
  function renderChips() {
    const f = state.filters, chips = [];
    if (f.monthFrom !== state.months[0] || f.monthTo !== state.months[state.months.length - 1]) chips.push(['months', f.monthFrom === f.monthTo ? U.monthLabel(f.monthFrom) : `${U.monthLabel(f.monthFrom)} to ${U.monthLabel(f.monthTo)}`]);
    MULTI.forEach((m) => { const s = f[m.key]; if (s.length) chips.push([m.key, s.includes('__none__') ? `${m.label}: none selected` : `${m.label}: ${s.length <= 3 ? s.map((v) => (m.fmt ? m.fmt(v) : v)).join(', ') : s.length + ' selected'}`]); });
    if (f.admission !== 'all') chips.push(['admission', f.admission === '1' ? 'Admitted only' : 'Not admitted only']);
    if (state.target !== RULES.defaultTarget) chips.push(['target', `Wait target ${state.target} min`]);
    $('#activeFilters').innerHTML = chips.length ? chips.map(([k, t]) => `<button class="chip" type="button" data-chip="${esc(k)}" aria-label="Remove filter ${esc(t)}">${esc(t)} <span aria-hidden="true">✕</span></button>`).join('')
      : '<span class="note">No filters: showing all visits</span>';
    updateFilterLabels();
  }
  function filtersDescription() {
    const f = state.filters; const parts = [];
    if (f.monthFrom !== state.months[0] || f.monthTo !== state.months[state.months.length - 1]) parts.push(`months ${U.monthLabel(f.monthFrom)} to ${U.monthLabel(f.monthTo)}`);
    MULTI.forEach((m) => { if (f[m.key].length) parts.push(`${m.label.toLowerCase()}: ${f[m.key].includes('__none__') ? 'none' : f[m.key].map((v) => (m.fmt ? m.fmt(v) : v)).join(', ')}`); });
    if (f.admission !== 'all') parts.push(f.admission === '1' ? 'admitted visits only' : 'non-admitted visits only');
    return parts.length ? parts.join('; ') : 'None (all visits)';
  }
  const scopeText = () => { const k = state.ctx.k; return k.visits ? `${U.fmtNum(k.visits)} visits from ${k.start} to ${k.end}; filters: ${filtersDescription()}; wait target ${state.target} minutes.` : 'no visits match the filters.'; };

  // ================================================================ overview
  function kpiCard(def, value, delta, deltaClass, context) {
    return `<div class="kpi"><div class="k-name">${esc(def.name)} <button class="info" type="button" aria-label="Definition of ${esc(def.name)}">i<span class="tip" role="tooltip"><b>${esc(def.name)}</b><br>${esc(def.formula)}.<br><i>${esc(def.compare)}.</i></span></button></div>
      <div class="k-value">${value}</div>${delta ? `<div class="k-delta ${deltaClass}">${delta}</div>` : ''}<div class="k-context">${context}</div></div>`;
  }
  // class by meaning: 'up' (green) = better, 'down' (red) = worse; arrows always show direction
  const cls = (v, goodWhenUp, eps = 0.05) => (!U.isNum(v) || Math.abs(v) <= eps || goodWhenUp === null ? 'flat' : (v > 0) === goodWhenUp ? 'up' : 'down');
  const arrow = (v, eps = 0.05) => (!U.isNum(v) || Math.abs(v) <= eps ? '' : v > 0 ? '▲ ' : '▼ ');
  const ST = { ok: ['st-ok', 'On track'], warn: ['st-warn', 'Warning'], crit: ['st-crit', 'Critical'], info: ['st-info', 'Monitor'], na: ['st-info', 'n/a'] };
  const status = (lvl) => `<span class="st ${ST[lvl][0]}">${ST[lvl][1]}</span>`;
  const overallOf = (k, m) => ({ visits_per_day: k.per_day, avg_wait: k.avg_wait, median_wait: k.median_wait, pct_over: k.pct_over, adm_rate: k.adm_rate, avg_sat: k.avg_sat, resp_rate: k.resp_rate }[m]);

  function renderOverview(empty) {
    const c = state.ctx, k = c.k;
    $('#ovScope').textContent = scopeText();
    if (empty) {
      $('#kpis').innerHTML = '<p class="empty">No visits match the current filters. Use Reset filters to see all data.</p>'; $('#kpiNote').textContent = '';
      ['#insights', '#attention', '#recs'].forEach((s) => { $(s).innerHTML = ''; }); C.monthTrend($('#cMonth'), [], { measure: 'visits_per_day' }); C.waitHist($('#cWaitHistOv'), [], state.target); return;
    }
    const d = Object.fromEntries(KPI_DEFS.map((x) => [x.id, x]));
    const mom = k.last && k.prev ? `${U.monthLabel(k.last.month).slice(0, 3)} vs ${U.monthLabel(k.prev.month).slice(0, 3)}` : '';
    const att = Object.fromEntries(c.attention.map((a) => [a.area, a.level]));
    $('#kpis').innerHTML = [
      kpiCard(d.visits, U.fmtNum(k.visits), mom ? `${arrow(k.d_visits_per_day_pct)}${U.fmtSignedPct(k.d_visits_per_day_pct)} a day, ${mom}` : '', cls(k.d_visits_per_day_pct, null), `${U.fmtNum(k.per_day, 1)} a day over ${k.days} days`),
      kpiCard(d.avg_wait, U.fmtMin(k.avg_wait), mom ? `${arrow(k.d_avg_wait)}${U.fmtSigned(k.d_avg_wait, 1, ' min')}, ${mom}` : '', cls(k.d_avg_wait, false), `Median ${U.fmtMin(k.median_wait, 0)}; 90th percentile ${U.fmtMin(k.p90_wait, 0)}`),
      kpiCard(d.over_target, U.fmtPct(k.pct_over), mom ? `${arrow(k.d_pct_over)}${U.fmtPp(k.d_pct_over)}, ${mom}` : '', cls(k.d_pct_over, false), `Waited over ${state.target} min<br>${status(att['Waiting times'])}`),
      kpiCard(d.admission, U.fmtPct(k.adm_rate), mom ? `${arrow(k.d_adm_rate)}${U.fmtPp(k.d_adm_rate)}, ${mom}` : '', 'flat', `${U.fmtNum(k.admissions)} admissions`),
      kpiCard(d.referral, U.fmtPct(k.ref_rate), '', '', `${U.fmtNum(Math.round(k.ref_rate * k.visits / 100))} visits referred to a specialty`),
      kpiCard(d.satisfaction, U.isNum(k.avg_sat) ? `${k.avg_sat.toFixed(2)}<small style="font-size:13px;font-weight:600;color:var(--text-secondary)"> / 10</small>` : 'n/a', mom && U.isNum(k.d_avg_sat) ? `${arrow(k.d_avg_sat, 0.01)}${U.fmtSigned(k.d_avg_sat, 2)}, ${mom}` : '', cls(k.d_avg_sat, true, 0.01),
        `${U.fmtPct(k.pct_satisfied)} score ${RULES.satisfiedMin}-10<br>${status(att['Patient experience'])}`),
      kpiCard(d.response, U.fmtPct(k.resp_rate), '', '', `${U.fmtNum(k.n_resp)} survey responses<br>${status(att['Feedback coverage'])}`),
      kpiCard(d.peak, k.busiest_day ? esc(k.busiest_day.weekday) : 'n/a', '', '', k.busiest_day ? `${k.busiest_day.visits_per_day.toFixed(1)} visits a day; busiest hour ${k.busiest_hour ? U.hourLabel(k.busiest_hour.hour) : 'n/a'}; ${k.peak_days} surge day${k.peak_days === 1 ? '' : 's'}` : ''),
    ].join('');
    $('#kpiNote').textContent = k.last && k.prev ? `Month-on-month changes compare ${U.monthLabel(k.last.month)} (${k.last.days} days in range) with ${U.monthLabel(k.prev.month)}. Green = better, red = worse, grey = no target direction. Status thresholds are on the Methodology tab.` : 'Month-on-month changes need at least two months in view.';
    renderMonthTrend();
    $('#insights').innerHTML = c.insights.map((i) => `<li><b>${esc(i.type)}</b>${esc(i.text)}<small>Rule: ${esc(i.rule)}</small></li>`).join('') || '<li>No findings for this selection.</li>';
    $('#attention').innerHTML = `<thead><tr><th>Area</th><th>Measure</th><th class="num">Value</th><th>Status</th></tr></thead><tbody>${
      c.attention.map((a) => `<tr><td><b>${esc(a.area)}</b></td><td class="wrap">${esc(a.measure)}</td><td class="num">${esc(a.value)}</td><td title="${esc(a.rule)}">${status(a.level)}</td></tr>`).join('')}</tbody>`;
    C.waitHist($('#cWaitHistOv'), A.waitHist(state.filtered, state.target), state.target);
    setAria('#cWaitHistOv', `Waiting-time distribution: ${U.fmtPct(k.pct_over)} of visits waited over ${state.target} minutes.`);
    $('#recs').innerHTML = c.recs.map((r) => `<div class="rec"><div class="h">${esc(r.horizon)}</div><p>${esc(r.text)}</p><small><b>Evidence:</b> ${esc(r.evidence)}</small></div>`).join('');
  }
  function renderMonthTrend() {
    const c = state.ctx, m = state.view.monthMeasure;
    $('#monthTitle').textContent = `${MEASURES[m].label} by month`;
    C.monthTrend($('#cMonth'), c.months, { measure: m, overall: overallOf(c.k, m), onClick: (month) => filterTo('month', month) });
    const vals = c.months.filter((x) => U.isNum(x[m]));
    if (vals.length) { const hi = vals.slice().sort((a, b) => b[m] - a[m])[0], lo = vals.slice().sort((a, b) => a[m] - b[m])[0];
      setAria('#cMonth', `${MEASURES[m].label} by month: highest ${U.monthLabel(hi.month)} ${U.fmtByUnit(hi[m], MEASURES[m].unit)}, lowest ${U.monthLabel(lo.month)} ${U.fmtByUnit(lo[m], MEASURES[m].unit)}.`); }
  }

  // ================================================================ patient flow
  function renderFlow() {
    const c = state.ctx, k = c.k;
    C.dailyLine($('#cDaily'), c.day);
    $('#dailyNote').textContent = c.day.series.length ? `${c.day.series.length} days; mean ${U.fmtNum(c.day.mean, 1)} visits (SD ${U.fmtNum(c.day.sd, 1)}), range ${c.day.min}-${c.day.max}. Orange points are surge days above mean + ${RULES.peakSd} SD. Drag the slider to zoom.` : '';
    setAria('#cDaily', `Daily visits: mean ${U.fmtNum(c.day.mean, 1)}, ${c.day.peaks.length} surge days.`);
    C.profileBars($('#cWeekday'), c.weekdays, { labelKey: 'weekday', measure: 'visits_per_day', overall: k.per_day, labelFmt: (v) => v.slice(0, 3) });
    setAria('#cWeekday', k.busiest_day ? `Busiest weekday ${k.busiest_day.weekday} (${k.busiest_day.visits_per_day.toFixed(1)} a day); quietest ${k.quietest_day.weekday}.` : 'No data.');
    C.profileBars($('#cHour'), c.hours, { labelKey: 'hour', measure: 'visits_per_day', overall: k.per_day / 24, labelFmt: (h) => String(h).padStart(2, '0') });
    setAria('#cHour', k.busiest_hour ? `Busiest hour ${U.hourLabel(k.busiest_hour.hour)}, ${k.busiest_hour.visits_per_day.toFixed(2)} visits a day.` : 'No data.');
    C.heatmap($('#cHeat'), A.heat(state.filtered, c.P));
    setAria('#cHeat', 'Heatmap of average visits by weekday and hour.');
    $('#peakNote').textContent = c.day.peaks.length ? `${c.day.peaks.length} days had more than ${c.day.threshold.toFixed(1)} visits (mean + ${RULES.peakSd} SD).` : 'No day exceeded the surge threshold.';
    $('#peakTable').innerHTML = `<thead><tr><th>Date</th><th>Weekday</th><th class="num">Visits</th><th class="num">vs average</th></tr></thead><tbody>${
      c.day.peaks.slice().sort((a, b) => b.visits - a.visits).map((p) => `<tr><td>${p.date}</td><td>${p.weekday}</td><td class="num">${p.visits}</td><td class="num">${U.fmtSignedPct((p.visits / c.day.mean - 1) * 100, 0)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">None</td></tr>'}</tbody>`;
    const rows = c.months.map((m, i) => ({ ...m, mom_pct: i && c.months[i - 1].visits_per_day ? (m.visits_per_day / c.months[i - 1].visits_per_day - 1) * 100 : null }));
    sortableTable($('#monthTable'), 'months', [
      { key: 'month', label: 'Month', f: (v) => U.monthLabel(v) }, { key: 'days', label: 'Days', num: true }, { key: 'visits', label: 'Visits', num: true, f: (v) => U.fmtNum(v) },
      { key: 'visits_per_day', label: 'Per day', num: true, f: (v) => U.fmtNum(v, 1) }, { key: 'mom_pct', label: 'Change (per day)', num: true, f: (v) => U.fmtSignedPct(v) },
      { key: 'avg_wait', label: 'Avg wait', num: true, f: (v) => U.fmtMin(v) }, { key: 'pct_over', label: 'Over target', num: true, f: (v) => U.fmtPct(v) },
      { key: 'adm_rate', label: 'Admitted', num: true, f: (v) => U.fmtPct(v) }, { key: 'avg_sat', label: 'Satisfaction', num: true, f: (v) => (U.isNum(v) ? v.toFixed(2) : 'n/a') },
    ], rows, 'month', 1);
  }

  // ================================================================ waiting times
  const testRow = (label, t) => `<tr><td>${esc(label)}</td><td class="num">${t.groups ?? ''}</td><td class="num">${U.isNum(t.H) ? t.H.toFixed(2) : 'n/a'}</td><td class="num">${U.fmtP(t.p)}</td><td class="num">${U.isNum(t.epsilon_sq) ? Math.max(0, t.epsilon_sq).toFixed(4) : 'n/a'}</td>
    <td>${!U.isNum(t.p) ? 'not enough data' : t.p < RULES.alpha ? `<span class="st st-warn">Significant</span> ${U.describeEffect(t.epsilon_sq)} effect` : '<span class="st st-info">Not significant</span>'}</td></tr>`;
  const testHead = '<thead><tr><th>Grouping</th><th class="num">Groups</th><th class="num">H</th><th class="num">p-value</th><th class="num">Effect (ε²)</th><th>Reading</th></tr></thead>';
  function renderWait(empty) {
    const c = state.ctx, k = c.k, m = state.view.waitMeasure;
    $('#waitIntro').textContent = empty ? 'No visits match the filters.' : `Average wait ${U.fmtMin(k.avg_wait)}, median ${U.fmtMin(k.median_wait, 0)}, 90th percentile ${U.fmtMin(k.p90_wait, 0)}. ${U.fmtPct(k.pct_over)} of visits waited longer than the ${state.target}-minute target (change it in the filter bar).`;
    C.waitHist($('#cWaitHist'), A.waitHist(state.filtered, state.target), state.target);
    setAria('#cWaitHist', `Waiting-time distribution; ${U.fmtPct(k.pct_over)} over ${state.target} minutes.`);
    C.referralBox($('#cWaitRef'), c.refs, state.target, (ref) => filterTo('referrals', ref));
    setAria('#cWaitRef', 'Box plot of waiting time by referral department.');
    const ov = overallOf(k, m);
    C.profileBars($('#cWaitHour'), c.hours, { labelKey: 'hour', measure: m, overall: ov, labelFmt: (h) => String(h).padStart(2, '0') });
    C.profileBars($('#cWaitDay'), c.weekdays, { labelKey: 'weekday', measure: m, overall: ov, labelFmt: (v) => v.slice(0, 3) });
    C.monthTrend($('#cWaitMonth'), c.months, { measure: m, overall: ov, onClick: (month) => filterTo('month', month) });
    const mx = (arr, key) => arr.filter((x) => U.isNum(x[m])).sort((a, b) => b[m] - a[m])[0];
    const h = mx(c.hours), w = mx(c.weekdays);
    setAria('#cWaitHour', h ? `Longest ${MEASURES[m].label.toLowerCase()} at ${U.hourLabel(h.hour)}: ${U.fmtByUnit(h[m], MEASURES[m].unit)}.` : 'No data.');
    setAria('#cWaitDay', w ? `Longest ${MEASURES[m].label.toLowerCase()} on ${w.weekday}: ${U.fmtByUnit(w[m], MEASURES[m].unit)}.` : 'No data.');
    $('#waitTests').innerHTML = c.t ? `${testHead}<tbody>${testRow('Referral department', c.t.waitByReferral)}${testRow('Day of the week', c.t.waitByWeekday)}${testRow('Hour of arrival', c.t.waitByHour)}${testRow('Age group', c.t.waitByAge)}</tbody>` : '';
    sortableTable($('#refWaitTable'), 'refwait', [
      { key: 'referral', label: 'Department' }, { key: 'visits', label: 'Visits', num: true, f: (v) => U.fmtNum(v) }, { key: 'avg_wait', label: 'Mean', num: true, f: (v) => U.fmtMin(v) },
      { key: 'median_wait', label: 'Median', num: true, f: (v) => U.fmtMin(v, 0) }, { key: 'q1', label: 'Q1', num: true, f: (v) => U.fmtMin(v, 0) }, { key: 'q3', label: 'Q3', num: true, f: (v) => U.fmtMin(v, 0) },
      { key: 'pct_over', label: `Over ${state.target} min`, num: true, f: (v) => U.fmtPct(v) },
    ], c.refs, 'avg_wait', -1);
  }

  // ================================================================ admissions and referrals
  function renderAdmit(empty) {
    const c = state.ctx, k = c.k, t = c.t;
    const refSpec = c.refs.filter((r) => r.referral !== 'None');
    $('#admIntro').textContent = empty ? 'No visits match the filters.' : `${U.fmtPct(k.adm_rate)} of visits (${U.fmtNum(k.admissions)}) led to admission; ${U.fmtPct(k.ref_rate)} were referred to a specialty department.${refSpec[0] ? ` The largest referral department is ${refSpec[0].referral} (${U.fmtNum(refSpec[0].visits)} visits, ${U.fmtPct(refSpec[0].share_of_referred_pct)} of referrals).` : ''}`;
    C.referralVolume($('#cRefVol'), c.refs, (ref) => filterTo('referrals', ref));
    setAria('#cRefVol', `Visits and admissions by referral department; largest ${c.refs[0] ? c.refs[0].referral : 'n/a'}.`);
    C.rateBars($('#cAdmRef'), c.refs.map((r) => ({ group: r.referral, adm_rate: r.adm_rate, visits: r.visits, small: r.visits < RULES.minGroupN })), { valueKey: 'adm_rate', overall: k.adm_rate, sort: true, onClick: (ref) => filterTo('referrals', ref) });
    setAria('#cAdmRef', 'Admission rate by referral department.');
    C.rateBars($('#cAdmAge'), A.admissionBy(state.filtered, 'age_group'), { valueKey: 'adm_rate', overall: k.adm_rate });
    setAria('#cAdmAge', 'Admission rate by age group.');
    C.monthTrend($('#cAdmMonth'), c.months, { measure: 'adm_rate', overall: k.adm_rate, onClick: (month) => filterTo('month', month) });
    setAria('#cAdmMonth', 'Admission rate by month.');
    $('#admTests').textContent = t ? `Chi-square test, referral department vs admission: chi2 = ${U.fmtNum(t.admByReferral.chi2, 2)}, df ${t.admByReferral.df}, p = ${U.fmtP(t.admByReferral.p)}, Cramer's V ${U.fmtNum(t.admByReferral.cramers_v, 3)} (${A.sig(t.admByReferral) ? 'significant' : 'not significant'}). Age group vs admission: p = ${U.fmtP(t.admByAge.p)} (${A.sig(t.admByAge) ? 'significant' : 'not significant'}).${U.isNum(t.admByReferral.minExpected) && t.admByReferral.minExpected < 5 ? ' Some expected counts are below 5, so treat the test with caution.' : ''}` : '';
    sortableTable($('#refTable'), 'refs', [
      { key: 'referral', label: 'Department', f: (v) => `<b>${esc(v)}</b>`, html: true }, { key: 'visits', label: 'Visits', num: true, f: (v) => U.fmtNum(v) }, { key: 'share_pct', label: 'Share of visits', num: true, f: (v) => U.fmtPct(v) },
      { key: 'share_of_referred_pct', label: 'Share of referrals', num: true, f: (v) => (U.isNum(v) ? U.fmtPct(v) : '-') }, { key: 'admissions', label: 'Admissions', num: true, f: (v) => U.fmtNum(v) },
      { key: 'adm_rate', label: 'Admission rate', num: true, f: (v) => U.fmtPct(v) }, { key: 'share_of_admissions_pct', label: 'Share of admissions', num: true, f: (v) => U.fmtPct(v) },
      { key: 'avg_wait', label: 'Avg wait', num: true, f: (v) => U.fmtMin(v) }, { key: 'avg_sat', label: 'Satisfaction', num: true, f: (v, r) => (U.isNum(v) ? `${v.toFixed(2)} (n=${r.n_resp})` : 'n/a') },
    ], c.refs, 'visits', -1);
  }

  // ================================================================ patient experience
  function renderExperience(empty) {
    const c = state.ctx, k = c.k, t = c.t;
    $('#expIntro').textContent = empty ? 'No visits match the filters.' : `${U.fmtNum(k.n_resp)} of ${U.fmtNum(k.visits)} visits (${U.fmtPct(k.resp_rate)}) have a satisfaction score. Average ${U.fmtScore(k.avg_sat)}; ${U.fmtPct(k.pct_satisfied)} scored ${RULES.satisfiedMin}-10. All satisfaction figures describe respondents only.`;
    C.satBars($('#cSatWait'), c.satBand.map((b) => ({ ...b, group: `${b.group} min` })), k.avg_sat);
    setAria('#cSatWait', 'Average satisfaction with 95% confidence intervals by waiting-time band.');
    C.satMix($('#cSatMix'), A.satMixByWait(state.filtered));
    setAria('#cSatMix', 'Share of low, medium and high satisfaction scores by waiting-time band.');
    if (t) {
      const sp = t.waitSatSpearman, pe = t.waitSatPearson;
      $('#corrBox').innerHTML = `<div class="corr"><div class="stat"><b>${U.isNum(sp.r) ? sp.r.toFixed(3) : 'n/a'}</b><span>Spearman rho (rank correlation)</span></div><div class="stat"><b>${U.fmtP(sp.p)}</b><span>p-value (Spearman)</span></div>
        <div class="stat"><b>${U.isNum(pe.r) ? pe.r.toFixed(3) : 'n/a'}</b><span>Pearson r (linear)</span></div><div class="stat"><b>${U.fmtNum(sp.n)}</b><span>responses used</span></div></div>
        <p>${U.isNum(sp.r) ? `<b>Reading:</b> ${esc(U.describeCorr(sp.r))} association, ${A.sig(sp) ? `statistically significant (p ${U.fmtP(sp.p)})` : `not statistically significant (p = ${U.fmtP(sp.p)})`}. ${Math.abs(sp.r) < 0.1 ? 'Waiting time explains almost none of the variation in satisfaction in this data, so other factors drive scores.' : sp.r < 0 ? 'Longer waits go with lower satisfaction.' : 'Longer waits go with higher satisfaction, which is unexpected and worth checking.'} Correlation does not show cause and effect.` : 'Not enough responses to measure.'}</p>`;
      $('#satTests').innerHTML = `${testHead}<tbody>${Object.entries({ gender: 'Gender', race: 'Race', age_group: 'Age group', admitted_label: 'Admission status', referral: 'Referral department', wait_band: 'Wait band' }).map(([g, l]) => testRow(l, t.satBy[g])).join('')}</tbody>`;
      const rb = t.respBias;
      $('#respBox').innerHTML = `<div class="corr"><div class="stat"><b>${U.fmtPct(rb.respRateAdmitted)}</b><span>response rate, admitted</span></div><div class="stat"><b>${U.fmtPct(rb.respRateNotAdmitted)}</b><span>response rate, not admitted</span></div>
        <div class="stat"><b>${U.fmtMin(rb.respondWait)}</b><span>avg wait, respondents</span></div><div class="stat"><b>${U.fmtMin(rb.nonRespondWait)}</b><span>avg wait, non-respondents</span></div></div>
        <p class="note">${Math.abs(rb.respondWait - rb.nonRespondWait) < 1 && Math.abs(rb.respRateAdmitted - rb.respRateNotAdmitted) < 3 ? 'Respondents look similar to non-respondents on waiting time and admission, which reduces (but does not remove) the risk of response bias.' : 'Respondents differ from non-respondents, so satisfaction results may be biased towards the groups that answer more often.'}</p>`;
    } else { ['#corrBox', '#satTests', '#respBox'].forEach((s) => { $(s).innerHTML = ''; }); }
    renderSatGroup();
    C.satDist($('#cSatDist'), A.satDistribution(state.filtered));
    setAria('#cSatDist', 'Distribution of satisfaction scores from 0 to 10.');
  }
  function renderSatGroup() {
    const g = state.view.satGroup;
    $('#satGroupTitle').textContent = `Satisfaction by ${GROUPS[g].toLowerCase()}`;
    C.satBars($('#cSatGroup'), A.groupSat(state.filtered, g), state.ctx.k.avg_sat);
    setAria('#cSatGroup', `Average satisfaction by ${GROUPS[g].toLowerCase()} with 95% confidence intervals.`);
  }

  // ================================================================ data explorer
  const COLSETS = {
    key: ['visit_key', 'arrival', 'weekday', 'referral', 'admitted_label', 'wait_min', 'over_target', 'satisfaction', 'age', 'gender', 'race'],
    all: ['visit_key', 'arrival', 'date', 'month', 'weekday', 'hour', 'gender', 'age', 'age_group', 'race', 'referral', 'referred', 'admitted', 'admitted_label', 'wait_min', 'wait_band',
      'over_target', 'satisfaction', 'responded', 'sat_group', 'cm_flag', '_src'],
  };
  const LABELS = { visit_key: 'Visit key (pseudonymous)', arrival: 'Arrival', date: 'Date', month: 'Month', weekday: 'Weekday', hour: 'Hour', gender: 'Gender', age: 'Age', age_group: 'Age group',
    race: 'Race', referral: 'Referral', referred: 'Referred (1/0)', admitted: 'Admitted (1/0)', admitted_label: 'Admission', wait_min: 'Wait (min)', wait_band: 'Wait band',
    over_target: 'Over target (1/0)', satisfaction: 'Satisfaction', responded: 'Responded (1/0)', sat_group: 'Score group', cm_flag: 'Patients CM', _src: 'Source' };
  const NUMERIC = new Set(['hour', 'age', 'referred', 'admitted', 'wait_min', 'over_target', 'satisfaction', 'responded', 'cm_flag']);
  function renderExplorer() {
    const t = state.view.table; const q = t.search.trim().toLowerCase();
    let rows = state.filtered;
    if (q) rows = rows.filter((r) => `${r.visit_key} ${r.referral} ${r.race} ${r.arrival} ${r.weekday} ${r.age_group} ${r.admitted_label}`.toLowerCase().includes(q));
    rows = rows.map((r) => ({ ...r, _src: r._batch && r._batch !== 'base' ? 'Upload' : 'Original' }));
    rows.sort((a, b) => cmp(a[t.sort], b[t.sort]) * t.dir || cmp(a.arrival, b.arrival));
    const pages = Math.max(1, Math.ceil(rows.length / t.size)); t.page = Math.min(t.page, pages);
    const slice = rows.slice((t.page - 1) * t.size, t.page * t.size);
    const cols = COLSETS[t.cols];
    $('#explorer').innerHTML = `<thead><tr>${cols.map((k) => `<th class="${NUMERIC.has(k) ? 'num' : ''}" data-k="${k}" tabindex="0" aria-sort="${t.sort === k ? (t.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(LABELS[k])}</th>`).join('')}</tr></thead>
      <tbody>${slice.map((r) => `<tr>${cols.map((k) => `<td class="${NUMERIC.has(k) ? 'num' : ''}">${r[k] === null || r[k] === undefined ? '' : esc(r[k])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">No records match.</td></tr>`}</tbody>`;
    $('#tCount').textContent = `${U.fmtNum(rows.length)} of ${U.fmtNum(state.all.length)} visits (${U.fmtNum(state.filtered.length)} after filters${q ? `, ${U.fmtNum(rows.length)} matching "${t.search}"` : ''}). Page ${t.page} of ${pages}.`;
    const btn = (p, l, dis, cur) => `<button type="button" data-p="${p}" ${dis ? 'disabled' : ''} ${cur ? 'aria-current="page"' : ''}>${l}</button>`;
    let html = btn(t.page - 1, '‹ Prev', t.page === 1);
    for (let p = Math.max(1, t.page - 2); p <= Math.min(pages, t.page + 2); p++) html += btn(p, p, false, p === t.page);
    $('#pager').innerHTML = html + btn(t.page + 1, 'Next ›', t.page === pages);
  }
  const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? 1 : b === null || b === undefined ? -1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));

  // generic sortable table
  function sortableTable(el, id, cols, rows, defSort, defDir = 1) {
    const s = state.view.sorts[id] || (state.view.sorts[id] = { key: defSort || cols[0].key, dir: defDir });
    const data = rows.slice().sort((a, b) => cmp(a[s.key], b[s.key]) * s.dir);
    el.innerHTML = `<thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}" data-k="${c.key}" tabindex="0" aria-sort="${s.key === c.key ? (s.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${data.map((r) => `<tr>${cols.map((c) => { const v = r[c.key]; const out = c.f ? (c.f.length > 1 ? c.f(v, r) : c.f(v)) : v === null || v === undefined ? 'n/a' : v;
        return `<td class="${c.num ? 'num' : ''}${c.wrap ? ' wrap' : ''}">${c.html ? out : esc(out)}</td>`; }).join('')}</tr>`).join('')}</tbody>`;
    el.onclick = el.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; const th = e.target.closest('th[data-k]'); if (!th) return;
      const k = th.dataset.k; s.dir = s.key === k ? -s.dir : (cols.find((c) => c.key === k).num ? -1 : 1); s.key = k; sortableTable(el, id, cols, rows, defSort, defDir); };
  }

  // ================================================================ data management (upload)
  const MODE_LABEL = { append: 'Add new records', merge: 'Update or add', replace: 'Replace dataset' };
  const currentMode = () => $('input[name="mode"]:checked').value;
  async function handleFile(file) {
    busy(true, `Reading ${file.name}...`);
    try {
      const parsed = await D.readFile(file);
      const map = D.mapColumns(parsed.headers);
      if (map.missingRequired.length) {
        state.pending = null;
        $('#uploadPanel').innerHTML = `<div class="msg err"><b>Upload rejected: required columns missing.</b> "${esc(file.name)}" has no column for: ${map.missingRequired.map(esc).join(', ')}.
          <ul><li>Columns found: ${parsed.headers.map((h) => `"${esc(h)}"`).join(', ') || 'none'}</li><li>Rename the columns (see "Upload file format" under Methodology &amp; help) and try again. Nothing was changed.</li></ul></div>`;
        return;
      }
      const v = D.validateRows(parsed.rows, map);
      state.pending = { fileName: file.name, size: file.size, parsed, map, v };
      previewPending();
    } catch (e) {
      state.pending = null;
      $('#uploadPanel').innerHTML = `<div class="msg err"><b>The file could not be used.</b> ${esc(e instanceof D.UserError ? e.message : 'It may be damaged or in an unexpected format.')} Nothing was changed.</div>`;
      if (!(e instanceof D.UserError)) console.error(e);
    } finally { busy(false); $('#fileInput').value = ''; }
  }
  function previewPending() {
    const p = state.pending; if (!p) return;
    const mode = currentMode();
    const sim = D.applyBatch(state.records, p.v.accepted, mode, p.map.present, 'preview');
    p.mode = mode; p.sim = sim;
    const s = sim.summary, v = p.v;
    const invalid = v.rejected.filter((r) => r.type === 'invalid').length, dupFile = v.rejected.filter((r) => r.type === 'duplicate_in_file').length;
    const canApply = mode === 'replace' ? v.accepted.length > 0 : s.inserted + s.updated > 0;
    const problems = [...v.rejected, ...sim.skipped];
    $('#uploadPanel').innerHTML = `
      <p><b>${esc(p.fileName)}</b> · ${U.fmtBytes(p.size)} · mode: <b>${MODE_LABEL[mode]}</b></p>
      <div class="summary-grid">
        <div class="stat"><b>${U.fmtNum(p.parsed.rows.length)}</b><span>rows in file</span></div>
        <div class="stat"><b>${U.fmtNum(v.accepted.length)}</b><span>passed validation</span></div>
        <div class="stat"><b>${invalid}</b><span>invalid (rejected)</span></div>
        <div class="stat"><b>${dupFile + s.duplicatesExisting}</b><span>duplicates</span></div>
        ${mode === 'append' ? `<div class="stat"><b>${s.conflicts}</b><span>existing visits with different values</span></div>` : ''}
        <div class="stat"><b>${U.fmtNum(s.inserted)}</b><span>${mode === 'replace' ? 'records in new dataset' : 'new visits to add'}</span></div>
        ${mode === 'merge' ? `<div class="stat"><b>${s.updated}</b><span>visits to update</span></div><div class="stat"><b>${s.unchanged}</b><span>already identical</span></div>` : ''}
      </div>
      ${p.map.dropped.length ? `<div class="msg ok">Personal name column${p.map.dropped.length > 1 ? 's' : ''} ${p.map.dropped.map((h) => `"${esc(h)}"`).join(', ')} dropped: not stored or exported. Patient IDs are replaced by pseudonymous keys.</div>` : ''}
      ${mode === 'replace' ? `<div class="msg warn">Replacing removes the current ${U.fmtNum(state.records.length)} visits from the analysis (you can undo this afterwards).</div>` : ''}
      ${!canApply ? '<div class="msg warn">There is nothing to apply: no new or changed visits in this file for the chosen mode.</div>' : ''}
      <details class="more"><summary>Column mapping (${p.map.notes.length} matched${p.map.unknown.length ? `, ${p.map.unknown.length} ignored` : ''})</summary>
        <ul>${p.map.notes.map((n) => `<li>"${esc(n.header)}" → ${esc(n.field)} <small class="note">(${n.method})</small></li>`).join('')}
        ${p.map.dropped.map((h) => `<li>"${esc(h)}" → <i>personal name, dropped</i></li>`).join('')}
        ${p.map.unknown.map((h) => `<li>"${esc(h)}" → <i>not recognised, ignored</i></li>`).join('')}${p.map.clashes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        ${p.map.missingOptional.length ? `<p class="note">Optional columns not in the file (stored as missing${mode === 'merge' ? ', existing values kept' : ''}): ${p.map.missingOptional.map(esc).join(', ')}.</p>` : ''}
      </details>
      ${problems.length ? `<details class="more" open><summary>Rows not used (${problems.length})</summary><div class="table-wrap"><table class="data compact"><thead><tr><th class="num">Row</th><th>Visit (key, arrival)</th><th>Reason</th></tr></thead><tbody>
        ${problems.slice(0, 200).map((r) => `<tr><td class="num">${r.row}</td><td>${esc(r.key)}</td><td class="wrap">${esc(r.reason)}</td></tr>`).join('')}</tbody></table></div>${problems.length > 200 ? '<p class="note">First 200 shown; download the validation results for all.</p>' : ''}</details>` : ''}
      ${v.warnings.length ? `<details class="more"><summary>Warnings (${v.warnings.length}, rows still accepted)</summary><ul>${v.warnings.slice(0, 100).map((w) => `<li>Row ${w.row}, ${esc(w.field)}: ${esc(w.message)}</li>`).join('')}</ul></details>` : ''}
      <div class="btn-row">
        <button class="btn btn-primary" type="button" id="btnApply" ${canApply ? '' : 'disabled'}>Apply upload</button>
        <button class="btn btn-ghost" type="button" id="btnCancel">Cancel</button>
        <button class="btn btn-ghost" type="button" id="btnValidation">Download validation results</button>
      </div>`;
    $('#btnApply').onclick = applyPending;
    $('#btnCancel').onclick = () => { state.pending = null; $('#uploadPanel').innerHTML = '<p class="empty">Upload cancelled. Nothing was changed.</p>'; };
    $('#btnValidation').onclick = () => window.ErExport.validationCsv({ fileName: p.fileName, rejected: problems, warnings: v.warnings });
  }
  async function applyPending() {
    const p = state.pending; if (!p) return;
    if (p.mode === 'replace' && !(await confirmBox(`Replace the current ${U.fmtNum(state.records.length)} visits with the ${U.fmtNum(p.v.accepted.length)} valid visits from "${p.fileName}"? You can undo this with "Undo last upload".`))) return;
    const id = `${Date.now().toString(36)}`;
    const res = D.applyBatch(state.records, p.v.accepted, p.mode, p.map.present, id);
    const s = res.summary, v = p.v;
    const dupFile = v.rejected.filter((r) => r.type === 'duplicate_in_file').length, invalid = v.rejected.filter((r) => r.type === 'invalid').length;
    const counts = { processed: p.parsed.rows.length, accepted: s.inserted + s.updated + s.unchanged, duplicates: dupFile + s.duplicatesExisting, rejected: invalid + s.conflicts,
      inserted: s.inserted, updated: s.updated, unchanged: s.unchanged, conflicts: s.conflicts, removed: s.removed };
    const batch = { id, file: p.fileName, size: p.size, mode: p.mode, at: new Date().toISOString(), counts, snapshot: state.records };
    state.records = res.next; state.batches.push(batch); state.updatedAt = batch.at; state.pending = null;
    const saved = await persist();
    recompute(p.mode === 'replace');
    const msg = `Data successfully ${p.mode === 'replace' ? 'replaced' : 'added'}. ${U.fmtNum(counts.processed)} records were processed, ${U.fmtNum(counts.accepted)} were accepted (${U.fmtNum(counts.inserted)} added${p.mode === 'merge' ? `, ${counts.updated} updated` : ''}), ${counts.duplicates} duplicate${counts.duplicates === 1 ? ' was' : 's were'} detected and ${counts.rejected} record${counts.rejected === 1 ? ' was' : 's were'} rejected.`;
    $('#uploadPanel').innerHTML = `<div class="msg ok"><b>${esc(msg)}</b><br>All KPIs, charts, tables, the report and the exports now use the updated dataset.${saved ? ' Saved in this browser.' : ' <b>Not saved:</b> browser storage is unavailable, so the changes last until the page is closed.'}</div>`;
    toast(msg);
  }
  async function persist() {
    if (!state.storage) return false;
    const r = await S.save({ records: state.records, batches: state.batches, updatedAt: state.updatedAt, target: state.target });
    return r.ok;
  }
  async function undoLast() {
    const b = state.batches[state.batches.length - 1]; if (!b) return;
    if (!(await confirmBox(`Undo the upload of "${b.file}" (${MODE_LABEL[b.mode]}, ${new Date(b.at).toLocaleString('en-GB')})? The dataset returns to how it was before that upload.`))) return;
    state.records = b.snapshot; state.batches.pop(); state.updatedAt = state.batches.length ? state.batches[state.batches.length - 1].at : null;
    if (state.batches.length) await persist(); else await S.clear();
    recompute(b.mode === 'replace'); toast(`Upload of "${b.file}" undone.`);
  }
  async function resetAll() {
    if (!(await confirmBox('Remove all uploaded data from this browser and return to the original dataset? This cannot be undone.'))) return;
    await S.clear(); state.records = state.baseRecords.slice(); state.batches = []; state.updatedAt = null; state.pending = null;
    $('#uploadPanel').innerHTML = '<p class="empty">No file selected yet.</p>';
    recompute(true); toast('Back to the original dataset. Locally saved data was cleared.');
  }
  function renderDataTab() {
    const uploads = state.records.filter((r) => r._batch && r._batch !== 'base').length;
    $('#storeInfo').innerHTML = `<p>${state.batches.length ? `<b>${U.fmtNum(state.records.length)}</b> visits in the working dataset, of which <b>${U.fmtNum(uploads)}</b> come from uploads.` : `Using the original dataset (<b>${U.fmtNum(state.records.length)}</b> visits). No uploads yet.`}
      ${state.storage ? 'Changes are saved in this browser (IndexedDB) and reloaded next time you open the dashboard here.' : '<b>Browser storage is unavailable</b> (for example in a private window), so changes last only until the page is closed.'}</p>`;
    $('#batchTable').innerHTML = state.batches.length ? `<thead><tr><th>#</th><th>When</th><th>File</th><th>Mode</th><th class="num">Rows</th><th class="num">Added</th><th class="num">Updated</th><th class="num">Duplicates</th><th class="num">Rejected</th></tr></thead><tbody>${
      state.batches.map((b, i) => `<tr><td>${i + 1}</td><td>${new Date(b.at).toLocaleString('en-GB')}</td><td>${esc(b.file)}</td><td>${MODE_LABEL[b.mode]}</td><td class="num">${b.counts.processed}</td>
        <td class="num">${b.counts.inserted}</td><td class="num">${b.counts.updated}</td><td class="num">${b.counts.duplicates}</td><td class="num">${b.counts.rejected}</td></tr>`).join('')}</tbody>` : '';
    $('#btnUndo').disabled = !state.batches.length; $('#btnClear').disabled = !state.batches.length;
  }

  // ================================================================ methodology tab and static content
  function cleaningCounts(rows) {
    return { total: rows.length, noReferral: rows.filter((r) => r.referral === 'None').length, noScore: rows.filter((r) => !r.responded).length,
      genderNc: rows.filter((r) => r.gender === 'NC').length, ageMissing: rows.filter((r) => r.age_group === 'Not recorded').length, raceMissing: rows.filter((r) => r.race === 'Not recorded').length };
  }
  function renderMethod() {
    const c = cleaningCounts(state.all);
    $('#cleanRules').innerHTML = `<thead><tr><th>Rule</th><th>What happens</th><th class="num">Records</th></tr></thead><tbody>${[
      ['C1 Names', 'First initial and last name columns dropped when a file is read (never stored or exported)', 'all files'],
      ['C2 Patient ID', 'Replaced by a pseudonymous key: P + first 12 hex characters of SHA-256 of the ID', U.fmtNum(c.total)],
      ['C3 Arrival', 'Day-first text (dd-mm-yyyy HH:MM) or ISO dates parsed to date and time; impossible dates rejected', U.fmtNum(c.total)],
      ['C4 Referral', "'None' or blank = no specialty referral (kept as its own category)", U.fmtNum(c.noReferral)],
      ['C5 Satisfaction', 'Blank = no survey response; kept missing, never imputed; scores outside 0-10 set to missing', U.fmtNum(c.noScore)],
      ['C6 Gender', "'NC' (not specified) kept as its own category; unrecognised codes stored as NC with a warning", U.fmtNum(c.genderNc)],
      ['C7 Admission flag', 'TRUE/FALSE (also Yes/No, 1/0) converted to 1/0; anything else rejected', U.fmtNum(c.total)],
      ['C8 Age / race', 'Missing or invalid values shown as "Not recorded"', `${c.ageMissing} / ${c.raceMissing}`],
      ['C9 Duplicates', 'Same pseudonymous key and arrival time = same visit; duplicates within a file are rejected', '0 in base data'],
      ['C10 Patients CM', 'Kept as supplied (0/1) but not analysed: meaning undocumented', U.fmtNum(c.total)],
    ].map((r) => `<tr><td>${r[0]}</td><td class="wrap">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join('')}</tbody>`;
  }
  function renderStatic() {
    $('#srcName').textContent = window.BASE_DATASET.name;
    $('#kpiDefs').innerHTML = `<thead><tr><th>KPI</th><th>Formula</th><th>Comparison</th><th>Unit</th><th>Fields</th></tr></thead><tbody>${
      KPI_DEFS.map((k) => `<tr><td><b>${esc(k.name)}</b></td><td class="wrap">${esc(k.formula)}</td><td class="wrap">${esc(k.compare)}</td><td>${esc(k.unit)}</td><td>${esc(k.fields)}</td></tr>`).join('')}</tbody>`;
    const R = RULES, St = R.status;
    $('#ruleList').innerHTML = [
      `<b>Per-day averages</b> divide by calendar days in the selected months (clipped to the first and last arrival in the data), so days with no visits count as zero.`,
      `<b>Surge day</b>: a day with more visits than the mean + ${R.peakSd} standard deviations of daily visits in view.`,
      `<b>Evenly spread demand</b>: busiest and quietest weekday within ${R.evenSpreadPct}% of each other.`,
      `<b>Tests</b>: Kruskal-Wallis (differences in wait or satisfaction between groups), chi-square (admission vs referral or age), Spearman rank correlation (wait vs satisfaction). Significant = p below ${R.alpha}. Groups with fewer than ${R.minGroupN} cases are shown pale.`,
      `<b>Status thresholds</b> (illustrative, set in config.js): over target ${St.overTarget.warn}% warning / ${St.overTarget.crit}% critical; satisfied (8-10) below ${St.satisfied.warn}% warning / ${St.satisfied.crit}% critical; response rate below ${St.response.warn}% warning / ${St.response.crit}% critical.`,
      `<b>Satisfied</b> = score of ${R.satisfiedMin} or more. Score groups: low 0-4, medium 5-7, high 8-10.`,
      '<b>Key findings and recommendations</b> are produced by fixed rules from the current data (each shows its rule or evidence); they are not AI-generated and contain no pre-written results.',
    ].map((t) => `<li>${t}</li>`).join('');
    $('#schemaTable').innerHTML = `<thead><tr><th>Field</th><th>Required</th><th>Format</th><th>Notes</th><th>Accepted column names (normalised)</th></tr></thead><tbody>${
      FIELDS.map((f) => `<tr><td><b>${esc(f.label)}</b></td><td>${f.required ? 'Yes' : 'No'}</td><td>${esc(f.unit || f.type)}</td><td class="wrap">${esc(f.desc)}</td><td class="wrap">${f.aliases.map(esc).join(', ')}</td></tr>`).join('')}
      <tr><td><b>Name columns</b></td><td>-</td><td>-</td><td class="wrap">Recognised and dropped; never stored</td><td class="wrap">${DROP_ALIASES.map(esc).join(', ')}</td></tr></tbody>`;
    $('#monthMeasure').innerHTML = Object.entries(MEASURES).map(([k, m]) => `<option value="${k}" ${k === state.view.monthMeasure ? 'selected' : ''}>${m.label}</option>`).join('');
    $('#satGroup').innerHTML = Object.entries(GROUPS).filter(([k]) => k !== 'wait_band').map(([k, l]) => `<option value="${k}" ${k === state.view.satGroup ? 'selected' : ''}>${l}</option>`).join('');
  }

  // ================================================================ report and data downloads
  function scopeCtx(scope) {
    if (scope !== 'full') return state.ctx;
    return A.analyse(state.all, state.all, fullFilters(), state.target);
  }
  async function generateReport(scope) {
    const ctx = scopeCtx(scope);
    if (!ctx.rows.length) { toast('No visits in this scope: nothing to report.'); return; }
    busy(true, 'Building the PDF report...');
    try {
      const res = await window.ErReport.generate({
        scope, ctx, target: state.target,
        scopeLabel: scope === 'full' ? 'Entire available dataset' : 'Current filtered view', filtersDesc: scope === 'full' ? 'None (entire dataset)' : filtersDescription(),
        datasetStatus: datasetStatusText(), sourceName: `${window.BASE_DATASET.name}${state.batches.length ? ` plus ${state.batches.length} upload(s)` : ''}`,
        cleaningCounts: cleaningCounts(ctx.rows),
        uploads: state.batches.map((b) => ({ at: b.at, file: b.file, modeLabel: MODE_LABEL[b.mode], resultText: `${b.counts.inserted} added, ${b.counts.updated} updated, ${b.counts.duplicates} duplicates, ${b.counts.rejected} rejected` })),
      });
      toast(`Report downloaded: ${res.fname} (${res.pages} pages).`);
    } catch (e) { console.error(e); toast('The report could not be generated. Please try again.'); } finally { busy(false); }
  }
  async function downloadData(scope, fmt) {
    const ctx = scopeCtx(scope);
    if (!ctx.rows.length) { toast('No visits in this scope: nothing to download.'); return; }
    if (fmt === 'xlsx') { busy(true, 'Building the Excel file...'); try { await window.ErExport.dataXlsx(ctx, scope, { filters: scope === 'full' ? 'None' : filtersDescription(), status: datasetStatusText(), target: state.target }); } finally { busy(false); } }
    else window.ErExport.dataCsv(ctx.rows, scope);
    toast(`Downloaded ${U.fmtNum(ctx.rows.length)} visits (${scope === 'full' ? 'full dataset' : 'filtered view'}, ${fmt.toUpperCase()}).`);
  }

  // ================================================================ helpers: toast, busy, confirm, aria, tabs
  let toastTimer;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 5200); }
  function busy(on, text) { $('#busy').hidden = !on; if (text) $('#busyText').textContent = text; }
  function confirmBox(text) {
    return new Promise((resolve) => { const d = $('#dlgConfirm'); $('#dlgConfirmText').textContent = text; d.returnValue = '';
      d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }); d.showModal(); });
  }
  function setAria(sel, text) { const el = $(sel); if (el) el.setAttribute('aria-label', text); }
  function switchTab(tab) {
    state.view.tab = tab;
    $$('[role="tab"]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    $$('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
    renderTab(tab); requestAnimationFrame(C.resizeAll);
  }
  const UPLOAD_HEAD = ['Patient Id', 'Patient Admission Date', 'Patient Gender', 'Patient Age', 'Patient Race', 'Department Referral', 'Patient Admission Flag', 'Patient Satisfaction Score', 'Patient Waittime', 'Patients CM'];
  const templateCsv = () => UPLOAD_HEAD.join(',') + '\r\n';
  // Fictional test file: 12 invented visits in the month after the data ends (IDs DEMO-001...), one exact duplicate of an
  // existing visit, one invalid row and a fictional name column, so a user can see de-identification, duplicate
  // detection and validation working.
  function sampleCsv() {
    const last = state.baseRecords.reduce((m, r) => (r.arrival > m ? r.arrival : m), '');
    const y = +last.slice(0, 4), m = +last.slice(5, 7); const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    const p2 = (x) => String(x).padStart(2, '0');
    const deps = ['None', 'General Practice', 'Orthopedics', 'None', 'Cardiology', 'None'];
    const lines = [['Patient First Inital', ...UPLOAD_HEAD].join(',')];
    for (let i = 1; i <= 12; i++) {
      lines.push(['X', `DEMO-${String(i).padStart(3, '0')}`, `${p2(i)}-${p2(nm)}-${ny} ${p2((i * 5) % 24)}:${p2((i * 13) % 60)}`, i % 2 ? 'F' : 'M', 10 + i * 5, 'White', deps[i % deps.length],
        i % 3 === 0 ? 'TRUE' : 'FALSE', i % 4 === 0 ? (i % 10) : '', 15 + i * 3, 0].join(','));
    }
    const ex = state.baseRecords[0];
    if (ex) lines.push(['', ex.visit_key, ex.arrival, ex.gender ?? '', ex.age ?? '', ex.race ?? '', ex.referral ?? '', ex.admitted ? 'TRUE' : 'FALSE', ex.satisfaction ?? '', ex.wait_min, ex.cm_flag ?? ''].join(','));
    lines.push(['X', 'DEMO-999', '31-02-2024 10:00', 'F', 40, 'White', 'None', 'maybe', '', 'abc', 0].join(','));
    return lines.join('\r\n') + '\r\n';
  }

  // ================================================================ event wiring
  function wire() {
    $('#tabList').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) switchTab(b.dataset.tab); });
    $('#tabList').addEventListener('keydown', (e) => { if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return; const tabs = $$('[role="tab"]'); const i = tabs.findIndex((t) => t.dataset.tab === state.view.tab);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); switchTab(n.dataset.tab); });
    const onMonth = () => { let a = $('#fFrom').value, b = $('#fTo').value; if (a > b) [a, b] = [b, a]; state.filters.monthFrom = a; state.filters.monthTo = b; buildFilterOptions(); refresh(); };
    $('#fFrom').onchange = onMonth; $('#fTo').onchange = onMonth;
    $('#fTarget').onchange = async (e) => { state.target = +e.target.value; recompute(false); if (state.batches.length) persist(); };
    $('#fAdm').onchange = (e) => { state.filters.admission = e.target.value; refresh(); };
    MULTI.forEach((m) => {
      $(m.box).addEventListener('change', () => { state.filters[m.key] = readMulti(m.box); refresh(); });
      $(m.box).addEventListener('click', (e) => { if (e.target.matches('[data-all],[data-none]')) { const on = e.target.matches('[data-all]'); $$(`${m.box} input`).forEach((i) => { i.checked = on; }); state.filters[m.key] = on ? [] : ['__none__']; refresh(); } });
    });
    document.addEventListener('click', (e) => { $$('details.multi[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
    $('#btnReset').onclick = () => { if (state.target !== RULES.defaultTarget) { state.target = RULES.defaultTarget; } recompute(true); toast('Filters reset: showing all visits with the 30-minute target.'); };
    $('#activeFilters').onclick = (e) => { const c = e.target.closest('[data-chip]'); if (!c) return; const k = c.dataset.chip; const f = state.filters;
      if (k === 'months') { f.monthFrom = state.months[0]; f.monthTo = state.months[state.months.length - 1]; }
      else if (k === 'admission') f.admission = 'all';
      else if (k === 'target') { state.target = RULES.defaultTarget; recompute(false); return; }
      else f[k] = [];
      buildFilterOptions(); refresh(); };
    $('#monthMeasure').onchange = (e) => { state.view.monthMeasure = e.target.value; renderMonthTrend(); };
    $('#waitMeasure').onchange = (e) => { state.view.waitMeasure = e.target.value; state.dirty.add('wait'); renderTab('wait'); };
    $('#satGroup').onchange = (e) => { state.view.satGroup = e.target.value; renderSatGroup(); };
    $('#tSearch').addEventListener('input', U.debounce((e) => { state.view.table.search = e.target.value; state.view.table.page = 1; renderExplorer(); }, 200));
    $('#tCols').onchange = (e) => { state.view.table.cols = e.target.value; renderExplorer(); };
    $('#tPage').onchange = (e) => { state.view.table.size = +e.target.value; state.view.table.page = 1; renderExplorer(); };
    $('#pager').onclick = (e) => { const b = e.target.closest('button[data-p]'); if (!b || b.disabled) return; state.view.table.page = +b.dataset.p; renderExplorer(); };
    $('#explorer').onclick = $('#explorer').onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; const th = e.target.closest('th[data-k]'); if (!th) return; const t = state.view.table; t.dir = t.sort === th.dataset.k ? -t.dir : 1; t.sort = th.dataset.k; renderExplorer(); };
    // upload
    const drop = $('#drop'), input = $('#fileInput');
    drop.onclick = () => input.click();
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    input.onchange = () => { if (input.files[0]) handleFile(input.files[0]); };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    $$('input[name="mode"]').forEach((r) => { r.onchange = previewPending; });
    $('#btnUndo').onclick = undoLast; $('#btnClear').onclick = resetAll;
    $('#btnSummaryCsv').onclick = () => window.ErExport.referralCsv(state.ctx.refs, 'filtered');
    $('#templateLink').onclick = (e) => { e.preventDefault(); U.download(new Blob([templateCsv()], { type: 'text/csv' }), 'er_visits_template.csv'); };
    $('#sampleLink').onclick = (e) => { e.preventDefault(); U.download(new Blob([sampleCsv()], { type: 'text/csv' }), 'test_upload_fictional_visits.csv'); };
    // downloads
    $('#btnReport').onclick = () => { $('#rScopeFiltered').textContent = `(${U.fmtNum(state.filtered.length)} visits)`; $('#rScopeFull').textContent = `(${U.fmtNum(state.all.length)} visits)`; $('#dlgReport').showModal(); };
    $('#dlgReport').addEventListener('close', () => { if ($('#dlgReport').returnValue === 'ok') generateReport($('input[name="rscope"]:checked').value); });
    $('#btnData').onclick = () => { $('#dScopeFiltered').textContent = `(${U.fmtNum(state.filtered.length)} visits)`; $('#dScopeFull').textContent = `(${U.fmtNum(state.all.length)} visits)`; $('#dlgData').showModal(); };
    $('#dlgData').addEventListener('close', () => { if ($('#dlgData').returnValue === 'ok') downloadData($('input[name="dscope"]:checked').value, $('input[name="dfmt"]:checked').value); });
    // theme, fullscreen, resize
    $('#btnTheme').onclick = () => { const dark = getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim() === 'dark';
      document.documentElement.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('er-theme', document.documentElement.dataset.theme); } catch (e) { /* ignore */ }
      ['overview', 'flow', 'wait', 'admit', 'experience'].forEach((t) => state.dirty.add(t)); renderTab(state.view.tab); };
    document.addEventListener('click', (e) => { const b = e.target.closest('.fs'); if (!b) return; const card = b.closest('.card');
      if (document.fullscreenElement) document.exitFullscreen(); else if (card.requestFullscreen) card.requestFullscreen(); });
    document.addEventListener('fullscreenchange', () => setTimeout(C.resizeAll, 80));
    window.addEventListener('resize', U.debounce(C.resizeAll, 150));
  }

  // exposed for automated tests (read-only views of state)
  window.ErApp = { state, refresh, recompute };
  document.addEventListener('DOMContentLoaded', init);
})();
