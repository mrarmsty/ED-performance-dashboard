/* report-generator.js - builds the downloadable PDF analysis report from the data currently loaded.
   Nothing in the report is pre-written about results: every number, table, finding and chart is produced from the
   same calculations as the dashboard at the moment the button is pressed. Text uses the standard PDF Helvetica font,
   so only plain ASCII characters are written. */
(function () {
  'use strict';
  const U = window.ErUtils, A = window.ErAnalytics, C = window.ErCharts;
  const { KPI_DEFS, RULES } = window.ErConfig;

  // replaces typographic characters with plain ASCII (the standard PDF font has no glyphs for them)
  const ascii = (s) => String(s ?? '').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u03B5\u00B2/g, 'epsilon sq.').replace(/[^\x20-\x7E\n]/g, '');

  async function chartImages(ctx, target) {
    const host = document.createElement('div');
    host.className = 'report-canvas';                      // forces light-theme colours (styles.css)
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;';
    document.body.appendChild(host);
    const out = {}, sizes = {};
    const mk = (name, h, draw) => { const d = document.createElement('div'); d.style.cssText = `width:900px;height:${h}px`; host.appendChild(d); draw(d); out[name] = C.image(d); sizes[name] = h; };
    C.setAnimation(false);
    try {
      const k = ctx.k;
      mk('month', 320, (d) => C.monthTrend(d, ctx.months, { measure: 'visits_per_day', overall: k.per_day }));
      mk('weekday', 280, (d) => C.profileBars(d, ctx.weekdays, { labelKey: 'weekday', measure: 'visits_per_day', overall: k.per_day, labelFmt: (v) => v.slice(0, 3) }));
      mk('hour', 280, (d) => C.profileBars(d, ctx.hours, { labelKey: 'hour', measure: 'visits_per_day', overall: k.per_day / 24, labelFmt: (h) => String(h).padStart(2, '0') }));
      mk('heat', 340, (d) => C.heatmap(d, A.heat(ctx.rows, ctx.P)));
      mk('hist', 300, (d) => C.waitHist(d, A.waitHist(ctx.rows, target), target));
      mk('box', Math.max(240, 34 * ctx.refs.length + 60), (d) => C.referralBox(d, ctx.refs, target));
      mk('refvol', Math.max(240, 34 * ctx.refs.length + 60), (d) => C.referralVolume(d, ctx.refs));
      mk('satwait', 260, (d) => C.satBars(d, ctx.satBand.map((b) => ({ ...b, group: `${b.group} min` })), k.avg_sat));
    } finally {
      C.setAnimation(true);
      host.querySelectorAll('div').forEach((el) => { const inst = window.echarts.getInstanceByDom(el); if (inst) inst.dispose(); });
      host.remove();
    }
    return { out, sizes };
  }

  async function generate(R) {
    const { jsPDF } = window.jspdf;
    // jspdf-autotable 5 exposes applyPlugin() globally; it adds doc.autoTable to jsPDF instances.
    if (typeof jsPDF.API.autoTable !== 'function' && typeof window.applyPlugin === 'function') window.applyPlugin(jsPDF);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48, CW = W - 2 * M;
    const NAVY = [31, 56, 100], BLUE = [42, 120, 214], GREY = [90, 90, 90];
    let y = M;
    const ensure = (h) => { if (y + h > H - M) { doc.addPage(); y = M; } };
    const h1 = (t) => { ensure(60); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...NAVY); doc.text(ascii(t), M, y); y += 8; doc.setDrawColor(...BLUE); doc.setLineWidth(1); doc.line(M, y, M + CW, y); y += 16; };
    const h2 = (t) => { ensure(40); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY); doc.text(ascii(t), M, y); y += 14; };
    const p = (t, opt = {}) => { doc.setFont('helvetica', opt.bold ? 'bold' : 'normal'); doc.setFontSize(opt.size || 9.5); doc.setTextColor(...(opt.color || [20, 20, 20]));
      const lines = doc.splitTextToSize(ascii(t), CW - (opt.indent || 0)); lines.forEach((ln) => { ensure(13); doc.text(ln, M + (opt.indent || 0), y); y += 12.5; }); y += opt.after ?? 4; };
    const bullet = (t) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(20, 20, 20);
      const lines = doc.splitTextToSize(ascii(t), CW - 14); lines.forEach((ln, i) => { ensure(13); if (!i) doc.text('-', M + 2, y); doc.text(ln, M + 14, y); y += 12.5; }); y += 2; };
    const table = (head, body, opts = {}) => {
      doc.autoTable({ startY: y, head: [head.map(ascii)], body: body.map((r) => r.map((c) => ascii(c))), margin: { left: M, right: M }, theme: 'grid',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, lineColor: [220, 220, 220], lineWidth: 0.5, textColor: [20, 20, 20], overflow: 'linebreak' },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [246, 248, 252] }, columnStyles: opts.columnStyles || {} });
      y = doc.lastAutoTable.finalY + 12;
    };
    const img = (name) => { const data = images.out[name]; if (!data) return; const h = CW * (images.sizes[name] / 900); ensure(h + 8); doc.addImage(data, 'JPEG', M, y, CW, h); y += h + 8; };
    const caption = (t) => p(t, { size: 8, color: GREY, after: 8 });
    const tRow = (label, t) => [label, String(t.groups ?? ''), U.isNum(t.H) ? t.H.toFixed(2) : 'n/a', U.fmtP(t.p), U.isNum(t.epsilon_sq) ? Math.max(0, t.epsilon_sq).toFixed(4) : 'n/a', !U.isNum(t.p) ? 'n/a' : A.sig(t) ? `significant, ${U.describeEffect(t.epsilon_sq)} effect` : 'not significant'];

    const { ctx, target } = R; const k = ctx.k, t = ctx.t;
    const images = await chartImages(ctx, target);

    // ---- cover
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, 130, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('Emergency Department Performance Analysis', M, 62);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text(ascii(`Attendance, waiting times, admissions and patient satisfaction, ${k.start} to ${k.end}`), M, 86);
    doc.setFontSize(9); doc.text(ascii(`Generated ${new Date().toLocaleString('en-GB')} from the Emergency Department Performance Dashboard`), M, 108);
    y = 160;
    table(['Report scope', ''], [
      ['Scope', R.scopeLabel], ['Filters applied', R.filtersDesc], ['Visits analysed', `${U.fmtNum(k.visits)} visits over ${k.days} calendar days (${k.start} to ${k.end})`],
      ['Waiting-time target', `${target} minutes (a visit is "over target" when the wait is longer than ${target} minutes)`],
      ['Dataset status', R.datasetStatus], ['Privacy', 'De-identified: no names; patient IDs replaced by pseudonymous keys before analysis'],
    ], { columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold' } } });
    h2('Summary');
    ctx.insights.slice(0, 6).forEach((i) => bullet(`${i.type}: ${i.text}`));

    // ---- 1-6
    h1('1. Business context and problem');
    p("Management of the hospital's Emergency Department (ED) has expressed concern about long waiting times, patient flow, admission patterns and patient satisfaction. A Data Analyst was asked to provide a clear picture of operational performance and to identify the areas that require management attention.");
    p('The problem: without consistent measurement, it is not clear whether waits are long everywhere or only at particular times or for particular referral routes, when demand peaks, what drives admissions, and whether shorter waits would lift satisfaction. Decisions on staffing and process improvement need that evidence.');
    h1('2. Purpose and objectives');
    ['Evaluate patient attendance patterns.', 'Assess Emergency Department waiting times.', 'Examine admission and referral patterns.', 'Identify periods of high patient demand.',
      'Examine the relationship between waiting times and patient satisfaction.', 'Develop an operational performance dashboard.'].forEach((x, i) => bullet(`${i + 1}. ${x}`));
    h1('3. Dataset overview');
    table(['Item', 'Value'], [
      ['Source', R.sourceName], ['Unit of analysis', 'One row per ED visit'], ['Visits in scope', U.fmtNum(k.visits)], ['Period', `${k.start} to ${k.end} (${ctx.months.length} months, ${k.days} days)`],
      ['Fields used', 'Arrival date and time, gender, age, race, referral department, admission flag, satisfaction score (0-10), waiting time (minutes)'],
      ['Not used', 'Patient names (dropped), original patient ID (replaced), Patients CM flag (meaning undocumented)'],
      ['Nature of data', 'The distributions are almost perfectly even (waits 10-60 minutes, about half of visits admitted), which suggests a synthetic practice dataset. Results are reported as found.'],
    ], { columnStyles: { 0: { cellWidth: 110, fontStyle: 'bold' } } });
    h1('4. Data preparation and privacy');
    const cc = R.cleaningCounts;
    table(['Rule', 'Action', 'Visits affected (in scope)'], [
      ['Names', 'First initial and last name dropped on reading (data minimisation)', 'all'],
      ['Patient ID', 'Replaced by P + 12 hex characters of SHA-256 of the ID (pseudonymisation, not anonymisation)', 'all'],
      ['Arrival', 'Day-first text dates parsed to date and time; date, month, weekday and hour derived', 'all'],
      ['Referral', "'None' kept as 'no specialty referral'", U.fmtNum(cc.noReferral)],
      ['Satisfaction', 'Blank = no survey response; not imputed; satisfaction measures use respondents only', U.fmtNum(cc.noScore)],
      ['Gender', "'NC' (not specified) kept as its own category", U.fmtNum(cc.genderNc)],
      ['Admission flag', 'TRUE/FALSE converted to 1/0', 'all'],
      ['Derived bands', 'Age groups 0-4, 5-12, 13-17, 18-29, 30-44, 45-64, 65+; wait bands 0-15, 16-30, 31-45, 46-60, 61+ minutes', 'all'],
    ], { columnStyles: { 0: { cellWidth: 80, fontStyle: 'bold' }, 2: { cellWidth: 90 } } });
    if (R.uploads.length) { h2('Data added during use'); table(['When', 'File', 'Mode', 'Result'], R.uploads.map((b) => [new Date(b.at).toLocaleString('en-GB'), b.file, b.modeLabel, b.resultText])); }
    h1('5. Analytical methods');
    [
      'Attendance: visits counted by month, weekday, hour and calendar day. Averages are per calendar day in the period, so days without visits count as zero and months of different length compare fairly.',
      `High demand: weekday x hour heatmap of average visits; surge days = days with more visits than the mean + ${RULES.peakSd} standard deviations.`,
      `Waiting times: mean, median and 90th percentile; share of visits over the ${target}-minute target; Kruskal-Wallis tests of differences by referral department, weekday, hour and age group (non-parametric because waits are not normally distributed).`,
      'Admissions: admission rate overall and by referral department and age group; chi-square test of independence with Cramer\'s V as effect size.',
      'Satisfaction: mean score with 95% confidence interval and share scoring 8-10, respondents only; Spearman rank correlation between wait and score; Kruskal-Wallis tests across patient groups; response-bias check comparing respondents with non-respondents.',
      `Significance level ${RULES.alpha}. Tests show whether a difference is larger than chance would explain; they do not show cause and effect.`,
    ].forEach(bullet);
    h1('6. KPI definitions');
    table(['KPI', 'Definition', 'Comparison'], KPI_DEFS.map((d) => [d.name, d.formula, d.compare]), { columnStyles: { 0: { cellWidth: 100, fontStyle: 'bold' } } });

    // ---- 7 results by objective
    h1('7. Results by objective');
    table(['KPI', 'Value', 'Context'], [
      ['Total visits', U.fmtNum(k.visits), `${U.fmtNum(k.per_day, 1)} a day over ${k.days} days`],
      ['Average wait', U.fmtMin(k.avg_wait), `median ${U.fmtMin(k.median_wait, 0)}; 90th percentile ${U.fmtMin(k.p90_wait, 0)}`],
      [`Over ${target}-min target`, U.fmtPct(k.pct_over), k.last && k.prev ? `${U.fmtPp(k.d_pct_over)} ${U.monthLabel(k.last.month)} vs ${U.monthLabel(k.prev.month)}` : ''],
      ['Admission rate', U.fmtPct(k.adm_rate), `${U.fmtNum(k.admissions)} admissions`],
      ['Referral rate', U.fmtPct(k.ref_rate), 'referred to a specialty department'],
      ['Average satisfaction', U.fmtScore(k.avg_sat), `${U.fmtPct(k.pct_satisfied)} score 8-10; ${U.fmtNum(k.n_resp)} responses`],
      ['Survey response rate', U.fmtPct(k.resp_rate), 'visits with a satisfaction score'],
    ], { columnStyles: { 0: { cellWidth: 120, fontStyle: 'bold' } } });

    h2('7.1 Patient attendance patterns');
    p(`${U.fmtNum(k.visits)} visits were recorded, ${U.fmtNum(k.per_day, 1)} a day on average.${k.busiest_month ? ` The busiest month was ${U.monthLabel(k.busiest_month.month)} (${k.busiest_month.visits_per_day.toFixed(1)} a day).` : ''}${U.isNum(k.trend_p) ? ` The monthly trend is ${k.trend_p < RULES.alpha ? 'significant' : 'not significant'} (p = ${U.fmtP(k.trend_p)}).` : ''}`);
    img('month'); caption('Visits per calendar day by month; dashed line = average for the period.');
    if (ctx.yy) p(`Same months ${ctx.yy.y2} vs ${ctx.yy.y1} (${ctx.yy.months[0]}-${ctx.yy.months[ctx.yy.months.length - 1]}): visits a day ${U.fmtSigned(ctx.yy.d_per_day_pct, 1, '%')}, average wait ${U.fmtSigned(ctx.yy.d_avg_wait, 1, ' min')}, admission rate ${U.fmtPp(ctx.yy.d_adm_rate)}.`);
    img('weekday'); caption(`Average visits by weekday. Busiest ${k.busiest_day ? k.busiest_day.weekday : 'n/a'}, quietest ${k.quietest_day ? k.quietest_day.weekday : 'n/a'} (gap ${U.fmtPct(k.day_spread_pct, 0)}).`);
    img('hour'); caption(`Average visits by hour of arrival. Busiest hour ${k.busiest_hour ? U.hourLabel(k.busiest_hour.hour) : 'n/a'}.`);
    table(['Month', 'Days', 'Visits', 'Per day', 'Avg wait', 'Over target', 'Admitted', 'Satisfaction'],
      ctx.months.map((m) => [U.monthLabel(m.month), String(m.days), U.fmtNum(m.visits), U.fmtNum(m.visits_per_day, 1), U.fmtMin(m.avg_wait), U.fmtPct(m.pct_over), U.fmtPct(m.adm_rate), U.isNum(m.avg_sat) ? m.avg_sat.toFixed(2) : 'n/a']));

    h2('7.2 Waiting times');
    p(`Average wait ${U.fmtMin(k.avg_wait)} (median ${U.fmtMin(k.median_wait, 0)}). ${U.fmtPct(k.pct_over)} of visits waited longer than ${target} minutes.`);
    img('hist'); caption(`Distribution of waiting times in 5-minute bands; orange = over the ${target}-minute target.`);
    img('box'); caption('Waiting time by referral department: box = middle 50%, line = median, whiskers = range, dashed line = target.');
    table(['Grouping', 'Groups', 'H', 'p-value', 'Effect (epsilon sq.)', 'Reading'], [tRow('Referral department', t.waitByReferral), tRow('Day of the week', t.waitByWeekday), tRow('Hour of arrival', t.waitByHour), tRow('Age group', t.waitByAge)]);
    table(['Department', 'Visits', 'Mean wait', 'Median', `Over ${target} min`], ctx.refs.slice().sort((a, b) => b.avg_wait - a.avg_wait).map((r) => [r.referral, U.fmtNum(r.visits), U.fmtMin(r.avg_wait), U.fmtMin(r.median_wait, 0), U.fmtPct(r.pct_over)]));

    h2('7.3 Admission and referral patterns');
    p(`${U.fmtPct(k.adm_rate)} of visits led to admission and ${U.fmtPct(k.ref_rate)} were referred to a specialty department. Chi-square test of referral department vs admission: chi2 = ${U.fmtNum(t.admByReferral.chi2, 2)}, df ${t.admByReferral.df}, p = ${U.fmtP(t.admByReferral.p)}, Cramer's V ${U.fmtNum(t.admByReferral.cramers_v, 3)} (${A.sig(t.admByReferral) ? 'significant' : 'not significant'}). Age group vs admission: p = ${U.fmtP(t.admByAge.p)}.`);
    img('refvol'); caption('Visits by referral department, split into admitted and not admitted.');
    table(['Department', 'Visits', 'Share', 'Admissions', 'Admission rate', 'Share of admissions'],
      ctx.refs.map((r) => [r.referral, U.fmtNum(r.visits), U.fmtPct(r.share_pct), U.fmtNum(r.admissions), U.fmtPct(r.adm_rate), U.fmtPct(r.share_of_admissions_pct)]));

    h2('7.4 Periods of high patient demand');
    img('heat'); caption('Average visits in each hour of each weekday; darker = busier.');
    p(ctx.day.peaks.length ? `${ctx.day.peaks.length} surge days had more than ${ctx.day.threshold.toFixed(1)} visits (daily mean ${U.fmtNum(ctx.day.mean, 1)}, SD ${U.fmtNum(ctx.day.sd, 1)}): ${ctx.day.peaks.slice().sort((a, b) => b.visits - a.visits).slice(0, 12).map((d) => `${d.date} (${d.weekday.slice(0, 3)}, ${d.visits})`).join('; ')}${ctx.day.peaks.length > 12 ? '; ...' : ''}.` : 'No day exceeded the surge threshold.');

    h2('7.5 Waiting times and patient satisfaction');
    const sp = t.waitSatSpearman;
    p(`${U.fmtNum(k.n_resp)} visits (${U.fmtPct(k.resp_rate)}) have a satisfaction score. Spearman rho between wait and satisfaction = ${U.isNum(sp.r) ? sp.r.toFixed(3) : 'n/a'} (p = ${U.fmtP(sp.p)}, n = ${U.fmtNum(sp.n)}): ${U.describeCorr(sp.r)} association${A.sig(sp) ? ', statistically significant' : ', not statistically significant'}.`);
    img('satwait'); caption('Mean satisfaction by waiting-time band with 95% confidence intervals (respondents only).');
    table(['Grouping', 'Groups', 'H', 'p-value', 'Effect (epsilon sq.)', 'Reading'], [['gender', 'Gender'], ['race', 'Race'], ['age_group', 'Age group'], ['admitted_label', 'Admission status'], ['referral', 'Referral department'], ['wait_band', 'Wait band']].map(([g, l]) => tRow(l, t.satBy[g])));
    p(`Response check: response rate ${U.fmtPct(t.respBias.respRateAdmitted)} among admitted and ${U.fmtPct(t.respBias.respRateNotAdmitted)} among non-admitted patients; average wait ${U.fmtMin(t.respBias.respondWait)} for respondents vs ${U.fmtMin(t.respBias.nonRespondWait)} for non-respondents.`);

    // ---- 8-12
    h1('8. Key findings');
    ctx.insights.forEach((i) => bullet(`${i.type}: ${i.text}`));
    h1('9. Areas requiring management attention');
    const lbl = { ok: 'On track', warn: 'Warning', crit: 'Critical', info: 'Monitor', na: 'n/a' };
    table(['Area', 'Measure', 'Value', 'Status', 'Rule'], ctx.attention.map((a) => [a.area, a.measure, a.value, lbl[a.level], a.rule]), { columnStyles: { 0: { fontStyle: 'bold' } } });
    h1('10. Business interpretation');
    p(`What the data shows: waits are long across the board (${U.fmtPct(k.pct_over)} over ${target} minutes) and ${A.sig(t.waitByHour) || A.sig(t.waitByWeekday) || A.sig(t.waitByReferral) ? 'some groups wait longer than others (see 7.2)' : 'they are not concentrated in particular hours, weekdays or referral routes'}. Demand is ${isFinite(k.day_spread_pct) && k.day_spread_pct < RULES.evenSpreadPct ? 'spread evenly' : 'uneven'} across the week, with occasional surge days. About half of visits end in admission, and the larger referral departments generate more admissions mainly through volume.`);
    p(`What the analysis suggests: because long waits occur at all times, the cause is more likely process capacity (triage, assessment, decision-making, bed availability) than the timing of shifts. Satisfaction is low (${U.fmtScore(k.avg_sat)}) but ${A.sig(sp) ? 'is linked to waiting time' : 'is not linked to waiting time in this data'}, so shortening waits may not by itself improve patient experience.`);
    p('What requires further investigation: the stage of the journey the waiting time measures, clinical urgency (triage category), length of stay and reasons for low scores are not in the data; the low survey response rate limits how far satisfaction results can be generalised.');
    h1('11. Recommendations');
    table(['Horizon', 'Recommendation', 'Evidence'], ctx.recs.map((r) => [r.horizon, r.text, r.evidence]), { columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold' } } });
    h1('12. Limitations and assumptions');
    [
      'The data appears to be a synthetic practice dataset with near-uniform distributions; findings illustrate the method and should not be read as evidence about a real hospital.',
      `The ${target}-minute target is an assumption chosen for illustration (selectable in the dashboard); local standards may differ.`,
      'One waiting-time value per visit; the stage it measures (for example arrival to first clinician) is not documented.',
      `Satisfaction is available for ${U.fmtPct(k.resp_rate)} of visits; results describe respondents and may be affected by response bias.`,
      'No triage category, length of stay, outcome or staffing data, so waits cannot be judged against clinical urgency or capacity.',
      'Patient IDs are pseudonymised with an unsalted hash, which protects against casual identification but is not anonymisation.',
      'Statistical tests show association, not causation. Status thresholds in section 9 are illustrative management conventions.',
    ].forEach(bullet);
    p(`Report generated: ${new Date().toLocaleString('en-GB')}. Scope: ${R.scopeLabel}. Visits: ${U.fmtNum(k.visits)}.`, { color: GREY, size: 8.5 });

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130);
      doc.text(ascii(`Emergency Department Performance Analysis | ${R.scopeLabel} | page ${i} of ${pages}`), M, H - 22); }
    const fname = `ed_performance_report_${R.scope}_${U.stamp()}.pdf`;
    doc.save(fname);
    return { pages, fname };
  }

  window.ErReport = { generate };
})();
