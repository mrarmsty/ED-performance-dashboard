/* analytics.js - every number the dashboard shows is calculated here from the rows currently in view.
   Insights and recommendations are produced by fixed, documented rules from those numbers; none are pre-written. */
(function () {
  'use strict';
  const U = window.ErUtils;
  const { DAYS, RULES, AGE_BANDS, WAIT_BANDS } = window.ErConfig;
  const { isNum, mean, median } = U;
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const sum = (arr, f) => arr.reduce((s, r) => s + (f(r) || 0), 0);

  // ---------------------------------------------------------------- filters and period
  const inSet = (sel, v) => !sel.length || sel.includes(v);
  function applyFilters(all, f) {
    return all.filter((r) => r.month >= f.monthFrom && r.month <= f.monthTo && inSet(f.referrals, r.referral) && inSet(f.ages, r.age_group)
      && inSet(f.genders, r.gender) && inSet(f.races, r.race) && (f.admission === 'all' || String(r.admitted) === f.admission));
  }
  const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
  const lastDay = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
  // Calendar days covered by the selected months, clipped to the first and last arrival in the whole dataset.
  // Days with no visits count as zero, so averages per day are not inflated.
  function period(all, f) {
    if (!all.length) return { start: null, end: null, days: [], months: [], weekdayCount: {} };
    const start = [all[0].date, `${f.monthFrom}-01`].sort()[1];
    const end = [all[all.length - 1].date, lastDay(f.monthTo)].sort()[0];
    const days = [];
    for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86400000) days.push(dayStr(t));
    const months = [...new Set(days.map((d) => d.slice(0, 7)))];
    const weekdayCount = Object.fromEntries(DAYS.map((d) => [d, 0]));
    days.forEach((d) => { const [y, m, dd] = d.split('-').map(Number); weekdayCount[DAYS[(new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7]]++; });
    const monthDays = {}; days.forEach((d) => { const m = d.slice(0, 7); monthDays[m] = (monthDays[m] || 0) + 1; });
    return { start, end, days, months, weekdayCount, monthDays };
  }

  // ---------------------------------------------------------------- group statistics
  function stats(rows) {
    const waits = rows.map((r) => r.wait_min); const resp = rows.filter((r) => r.responded);
    return {
      visits: rows.length, avg_wait: mean(waits), median_wait: median(waits), pct_over: pct(sum(rows, (r) => r.over_target), rows.length),
      adm_rate: pct(sum(rows, (r) => r.admitted), rows.length), admissions: sum(rows, (r) => r.admitted),
      ref_rate: pct(sum(rows, (r) => r.referred), rows.length), n_resp: resp.length, resp_rate: pct(resp.length, rows.length),
      avg_sat: mean(resp.map((r) => r.satisfaction)), pct_satisfied: pct(sum(resp, (r) => r.satisfied), resp.length),
    };
  }
  function groupBy(rows, key) { const m = new Map(); rows.forEach((r) => { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; }

  function monthStats(rows, P) {
    const g = groupBy(rows, 'month');
    return P.months.map((m) => { const s = stats(g.get(m) || []); return { month: m, days: P.monthDays[m], ...s, visits_per_day: s.visits / P.monthDays[m] }; });
  }
  function weekdayStats(rows, P) {
    const g = groupBy(rows, 'weekday');
    return DAYS.map((d) => { const s = stats(g.get(d) || []); const n = P.weekdayCount[d] || 0; return { weekday: d, occurrences: n, ...s, visits_per_day: n ? s.visits / n : null }; });
  }
  function hourStats(rows, P) {
    const g = groupBy(rows, 'hour'); const n = P.days.length;
    return Array.from({ length: 24 }, (_, h) => { const s = stats(g.get(h) || []); return { hour: h, ...s, visits_per_day: n ? s.visits / n : null }; });
  }
  function heat(rows, P) {
    const c = DAYS.map(() => new Array(24).fill(0));
    rows.forEach((r) => { c[r.weekday_num - 1][r.hour]++; });
    return DAYS.map((d, i) => c[i].map((v) => (P.weekdayCount[d] ? v / P.weekdayCount[d] : null)));
  }
  function daily(rows, P) {
    const cnt = new Map(P.days.map((d) => [d, 0]));
    rows.forEach((r) => { if (cnt.has(r.date)) cnt.set(r.date, cnt.get(r.date) + 1); });
    const series = [...cnt.entries()].map(([date, visits]) => ({ date, visits }));
    const v = series.map((s) => s.visits); const m = mean(v), sd = U.stdev(v);
    const threshold = isNum(sd) ? m + RULES.peakSd * sd : null;
    const peaks = threshold === null ? [] : series.filter((s) => s.visits > threshold).map((s) => { const [y, mo, d] = s.date.split('-').map(Number);
      return { ...s, weekday: DAYS[(new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7] }; });
    return { series, mean: m, sd, threshold, peaks, max: Math.max(...v, 0), min: v.length ? Math.min(...v) : null };
  }
  function referralStats(rows) {
    const g = groupBy(rows, 'referral'); const totalAdm = sum(rows, (r) => r.admitted); const referred = sum(rows, (r) => r.referred);
    return [...g.entries()].map(([referral, rs]) => { const s = stats(rs); const w = rs.map((r) => r.wait_min);
      return { referral, ...s, share_pct: pct(rs.length, rows.length), share_of_referred_pct: referral === 'None' ? null : pct(rs.length, referred), share_of_admissions_pct: pct(s.admissions, totalAdm),
        q1: U.quantile(w, 0.25), q3: U.quantile(w, 0.75), min: Math.min(...w), max: Math.max(...w) }; })
      .sort((a, b) => b.visits - a.visits);
  }
  const ORDER = { age_group: [...AGE_BANDS.map((b) => b[2]), 'Not recorded'], wait_band: WAIT_BANDS.map((b) => b[2]), admitted_label: ['Admitted', 'Not admitted'] };
  function groupSat(rows, key) {
    const g = groupBy(rows, key);
    const out = [...g.entries()].filter(([k]) => k !== null && k !== undefined).map(([k, rs]) => { const resp = rs.filter((r) => r.responded); const ci = U.meanCI(resp.map((r) => r.satisfaction));
      return { group: key === 'gender' ? rs[0].gender_label : k, code: k, visits: rs.length, n: resp.length, mean: ci.mean, lo: ci.lo, hi: ci.hi, resp_rate: pct(resp.length, rs.length),
        pct_satisfied: pct(sum(resp, (r) => r.satisfied), resp.length), avg_wait: mean(rs.map((r) => r.wait_min)), small: resp.length < RULES.minGroupN }; });
    const ord = ORDER[key];
    return ord ? out.sort((a, b) => ord.indexOf(a.code) - ord.indexOf(b.code)) : out.sort((a, b) => b.visits - a.visits);
  }
  function admissionBy(rows, key) {
    const g = groupBy(rows, key);
    const out = [...g.entries()].map(([k, rs]) => ({ group: k, visits: rs.length, admissions: sum(rs, (r) => r.admitted), adm_rate: pct(sum(rs, (r) => r.admitted), rs.length), small: rs.length < RULES.minGroupN }));
    const ord = ORDER[key];
    return ord ? out.sort((a, b) => ord.indexOf(a.group) - ord.indexOf(b.group)) : out.sort((a, b) => b.visits - a.visits);
  }
  // waiting-time histogram: 5-minute bins (lo, lo+5]; a bin is "over target" when every wait in it exceeds the target
  function waitHist(rows, target) {
    if (!rows.length) return [];
    const maxW = Math.max(...rows.map((r) => r.wait_min)); const top = Math.min(180, Math.max(65, Math.ceil(maxW / 5) * 5));
    const bins = []; for (let lo = 0; lo < top; lo += 5) bins.push({ lo, hi: lo + 5, label: lo === 0 ? '0-5' : `${lo + 1}-${lo + 5}`, count: 0, over: lo >= target });
    let tail = 0;
    rows.forEach((r) => { const i = r.wait_min <= 0 ? 0 : Math.ceil(r.wait_min / 5) - 1; if (i < bins.length) bins[i].count++; else tail++; });
    if (tail) bins.push({ lo: top, hi: null, label: `${top + 1}+`, count: tail, over: true });
    while (bins.length && bins[0].count === 0) bins.shift();
    while (bins.length && bins[bins.length - 1].count === 0) bins.pop();
    return bins;
  }
  function satDistribution(rows) {
    const resp = rows.filter((r) => r.responded); const c = new Array(11).fill(0);
    resp.forEach((r) => { c[Math.max(0, Math.min(10, Math.round(r.satisfaction)))]++; });
    return c.map((n, s) => ({ score: s, n, pct: pct(n, resp.length) }));
  }
  function satMixByWait(rows) {
    return WAIT_BANDS.map((b) => b[2]).map((wb) => { const rs = rows.filter((r) => r.wait_band === wb && r.responded);
      const c = (g) => rs.filter((r) => r.sat_group === g).length;
      return { band: wb, n: rs.length, low: pct(c('Low (0-4)'), rs.length), medium: pct(c('Medium (5-7)'), rs.length), high: pct(c('High (8-10)'), rs.length) }; }).filter((x) => x.n > 0);
  }

  // ---------------------------------------------------------------- statistical tests
  function tests(rows) {
    const kwBy = (key, val, filter) => { const g = groupBy(filter ? rows.filter(filter) : rows, key); return { ...U.kruskal([...g.values()].map((rs) => rs.map(val))), groups: g.size }; };
    const ct = (key) => { const g = groupBy(rows, key); return U.chiSquare([...g.values()].map((rs) => { const a = sum(rs, (r) => r.admitted); return [a, rs.length - a]; })); };
    const resp = rows.filter((r) => r.responded);
    const sat = (r) => r.satisfaction, resp1 = (r) => r.responded === 1;
    const respondW = mean(resp.map((r) => r.wait_min)), nonW = mean(rows.filter((r) => !r.responded).map((r) => r.wait_min));
    return {
      waitByReferral: kwBy('referral', (r) => r.wait_min), waitByWeekday: kwBy('weekday', (r) => r.wait_min), waitByHour: kwBy('hour', (r) => r.wait_min),
      waitByAge: kwBy('age_group', (r) => r.wait_min),
      admByReferral: ct('referral'), admByAge: ct('age_group'),
      waitSatSpearman: U.spearman(resp.map((r) => r.wait_min), resp.map(sat)), waitSatPearson: U.pearson(resp.map((r) => r.wait_min), resp.map(sat)),
      satBy: Object.fromEntries(['gender', 'race', 'age_group', 'admitted_label', 'referral', 'wait_band'].map((k) => [k, kwBy(k, sat, resp1)])),
      respBias: { respondWait: respondW, nonRespondWait: nonW, respRateAdmitted: pct(sum(rows, (r) => r.admitted && r.responded), sum(rows, (r) => r.admitted)),
        respRateNotAdmitted: pct(sum(rows, (r) => !r.admitted && r.responded), sum(rows, (r) => !r.admitted)) },
    };
  }
  const sig = (t) => t && isNum(t.p) && t.p < RULES.alpha;

  // ---------------------------------------------------------------- KPIs
  function kpis(rows, P, months, weekdays, hours, day) {
    const s = stats(rows);
    const withData = months.filter((m) => m.visits > 0);
    const last = withData[withData.length - 1] || null; const prev = last ? months[months.indexOf(last) - 1] || null : null;
    const wd = weekdays.filter((w) => isNum(w.visits_per_day) && w.occurrences > 0);
    const busy = wd.slice().sort((a, b) => b.visits_per_day - a.visits_per_day);
    const hb = hours.slice().sort((a, b) => b.visits - a.visits);
    const d = (a, b) => (isNum(a) && isNum(b) ? a - b : null);
    // trend in visits per day across months (OLS slope per month, and its correlation p-value)
    const xs = withData.map((_, i) => i), ys = withData.map((m) => m.visits_per_day);
    const slope = U.slope(xs, ys); const trendP = withData.length >= 4 ? U.pearson(xs, ys).p : null;
    return {
      ...s, days: P.days.length, start: P.start, end: P.end, per_day: P.days.length ? rows.length / P.days.length : null,
      p90_wait: U.quantile(rows.map((r) => r.wait_min), 0.9),
      last, prev,
      d_visits_per_day_pct: last && prev && prev.visits_per_day ? (last.visits_per_day / prev.visits_per_day - 1) * 100 : null,
      d_avg_wait: last && prev ? d(last.avg_wait, prev.avg_wait) : null, d_pct_over: last && prev ? d(last.pct_over, prev.pct_over) : null,
      d_adm_rate: last && prev ? d(last.adm_rate, prev.adm_rate) : null, d_avg_sat: last && prev ? d(last.avg_sat, prev.avg_sat) : null,
      busiest_day: busy[0] || null, quietest_day: busy[busy.length - 1] || null,
      day_spread_pct: busy.length > 1 && busy[busy.length - 1].visits_per_day ? (busy[0].visits_per_day / busy[busy.length - 1].visits_per_day - 1) * 100 : null,
      busiest_hour: hb[0] && hb[0].visits ? hb[0] : null, quietest_hour: hb[hb.length - 1] || null,
      peak_days: day.peaks.length, peak_threshold: day.threshold,
      busiest_month: withData.slice().sort((a, b) => b.visits_per_day - a.visits_per_day)[0] || null,
      trend_slope: slope, trend_p: trendP, trend_pct_per_month: isNum(slope) && mean(ys) ? (slope / mean(ys)) * 100 : null,
    };
  }
  // same months of the year in the last two calendar years in view (e.g. Apr-Oct 2023 vs Apr-Oct 2024)
  function yoy(rows, months) {
    const years = [...new Set(months.filter((m) => m.visits > 0).map((m) => m.month.slice(0, 4)))].sort();
    if (years.length < 2) return null;
    const [y1, y2] = years.slice(-2);
    const moy = (y) => new Set(months.filter((m) => m.month.startsWith(y) && m.visits > 0).map((m) => m.month.slice(5)));
    const a = moy(y1), b = moy(y2); const common = [...a].filter((m) => b.has(m)).sort();
    if (!common.length) return null;
    const pick = (y) => rows.filter((r) => r.year === +y && common.includes(r.month.slice(5)));
    const days = (y) => months.filter((m) => m.month.startsWith(y) && common.includes(m.month.slice(5))).reduce((s, m) => s + m.days, 0);
    const s1 = stats(pick(y1)), s2 = stats(pick(y2)); const d1 = days(y1), d2 = days(y2);
    return { y1, y2, months: common.map((m) => U.MONTHS[+m - 1]), first: { ...s1, per_day: s1.visits / d1 }, second: { ...s2, per_day: s2.visits / d2 },
      d_per_day_pct: (s2.visits / d2) / (s1.visits / d1) * 100 - 100, d_avg_wait: s2.avg_wait - s1.avg_wait, d_pct_over: s2.pct_over - s1.pct_over, d_adm_rate: s2.adm_rate - s1.adm_rate };
  }

  // ---------------------------------------------------------------- status of areas needing attention
  function attention(k, target) {
    const S = RULES.status;
    const lvl = (v, t, lowerIsWorse) => (!isNum(v) ? 'na' : lowerIsWorse ? (v < t.crit ? 'crit' : v < t.warn ? 'warn' : 'ok') : (v > t.crit ? 'crit' : v > t.warn ? 'warn' : 'ok'));
    return [
      { area: 'Waiting times', measure: `Visits waiting over ${target} min`, value: U.fmtPct(k.pct_over), level: lvl(k.pct_over, S.overTarget, false), rule: `over ${S.overTarget.crit}% = critical, over ${S.overTarget.warn}% = warning` },
      { area: 'Patient experience', measure: `Respondents scoring ${RULES.satisfiedMin}-10`, value: U.fmtPct(k.pct_satisfied), level: lvl(k.pct_satisfied, S.satisfied, true), rule: `under ${S.satisfied.crit}% = critical, under ${S.satisfied.warn}% = warning` },
      { area: 'Feedback coverage', measure: 'Survey response rate', value: U.fmtPct(k.resp_rate), level: lvl(k.resp_rate, S.response, true), rule: `under ${S.response.crit}% = critical, under ${S.response.warn}% = warning` },
      { area: 'Demand peaks', measure: `Days above mean + ${RULES.peakSd} SD (${isNum(k.peak_threshold) ? k.peak_threshold.toFixed(1) : 'n/a'} visits)`, value: `${k.peak_days} of ${k.days} days`, level: k.peak_days ? 'warn' : 'ok', rule: 'any peak day = warning (plan surge cover)' },
      { area: 'Admissions', measure: 'Admission rate', value: U.fmtPct(k.adm_rate), level: 'info', rule: 'no target in the brief; monitored for change' },
    ];
  }

  // ---------------------------------------------------------------- rule-based insights
  function insights(ctx) {
    const { k, t, refs, target, yy, satBand } = ctx; const out = [];
    if (!k.visits) return out;
    const add = (type, text, rule) => out.push({ type, text, rule });
    add('Attendance', `${U.fmtNum(k.visits)} visits over ${k.days} days (${U.fmtNum(k.per_day, 1)} a day on average).${k.busiest_month ? ` The busiest month was ${U.monthLabel(k.busiest_month.month)} at ${k.busiest_month.visits_per_day.toFixed(1)} visits a day.` : ''}${isNum(k.trend_p) ? ` Monthly volume shows ${k.trend_p < RULES.alpha ? `a significant ${k.trend_slope > 0 ? 'upward' : 'downward'} trend (${U.fmtSigned(k.trend_pct_per_month, 1, '%')} a month)` : 'no significant trend'} (p = ${U.fmtP(k.trend_p)}).` : ''}`,
      'Visits per calendar day by month; trend = least-squares slope, tested with Pearson correlation of month order and volume.');
    if (k.busiest_day && k.quietest_day) {
      const even = isNum(k.day_spread_pct) && k.day_spread_pct < RULES.evenSpreadPct;
      add('Busiest days', `${k.busiest_day.weekday} is the busiest day (${k.busiest_day.visits_per_day.toFixed(1)} visits a day) and ${k.quietest_day.weekday} the quietest (${k.quietest_day.visits_per_day.toFixed(1)}), a gap of ${U.fmtPct(k.day_spread_pct, 0)}. ${even ? 'Demand is spread fairly evenly across the week.' : 'Weekly demand is uneven enough to plan rosters by day.'}`,
        `Average visits per occurrence of each weekday; under ${RULES.evenSpreadPct}% gap between busiest and quietest = evenly spread.`);
    }
    if (k.busiest_hour) add('Busiest hours', `Arrivals peak at ${U.hourLabel(k.busiest_hour.hour)}-${U.hourLabel((k.busiest_hour.hour + 1) % 24)} (${k.busiest_hour.visits_per_day.toFixed(2)} visits a day) and are lowest at ${U.hourLabel(k.quietest_hour.hour)} (${k.quietest_hour.visits_per_day.toFixed(2)}). ${k.busiest_hour.visits_per_day < 1.3 * (k.per_day / 24) ? 'No hour stands out strongly: arrivals are spread across the whole day and night.' : 'Arrivals are concentrated enough to plan staffing by hour.'}`,
      'Visits by hour of arrival divided by calendar days; "stands out" = busiest hour at least 30% above the hourly average.');
    if (k.peak_days) add('Demand surges', `${k.peak_days} day${k.peak_days > 1 ? 's' : ''} had more than ${k.peak_threshold.toFixed(1)} visits (mean + ${RULES.peakSd} SD). The highest was ${ctx.day.max} visits.`, `Daily visit counts above mean + ${RULES.peakSd} standard deviations.`);
    add('Waiting times', `Average wait ${U.fmtMin(k.avg_wait)} (median ${U.fmtMin(k.median_wait, 0)}, 90th percentile ${U.fmtMin(k.p90_wait, 0)}). ${U.fmtPct(k.pct_over)} of visits waited longer than the ${target}-minute target.`,
      `Wait over target = wait_min > ${target}. Target selectable in the filter bar.`);
    const wr = t.waitByReferral; const rv = refs.filter((r) => r.visits >= RULES.minGroupN);
    if (rv.length > 1) { const hi = rv.slice().sort((a, b) => b.avg_wait - a.avg_wait)[0], lo = rv.slice().sort((a, b) => a.avg_wait - b.avg_wait)[0];
      add('Wait by department', sig(wr) ? `Waiting times differ significantly between referral groups (Kruskal-Wallis p = ${U.fmtP(wr.p)}); the longest average is ${hi.referral} (${U.fmtMin(hi.avg_wait)}) and the shortest ${lo.referral} (${U.fmtMin(lo.avg_wait)}). Effect size: ${U.describeEffect(wr.epsilon_sq)}.`
        : `No statistically significant difference in waiting time between referral groups (Kruskal-Wallis p = ${U.fmtP(wr.p)}). Averages range only from ${U.fmtMin(lo.avg_wait)} (${lo.referral}) to ${U.fmtMin(hi.avg_wait)} (${hi.referral}).`,
      `Kruskal-Wallis test on wait_min across referral groups, alpha ${RULES.alpha}; groups under ${RULES.minGroupN} visits excluded from the range.`); }
    const th = t.waitByHour, tw = t.waitByWeekday;
    if (isNum(th.p) && isNum(tw.p)) add('Wait by time', `Waits ${sig(th) ? 'do' : 'do not'} differ significantly by hour of arrival (p = ${U.fmtP(th.p)}) and ${sig(tw) ? 'do' : 'do not'} differ by weekday (p = ${U.fmtP(tw.p)}).${!sig(th) && !sig(tw) ? ' Long waits happen at all times, which points to process capacity rather than specific shifts.' : ''}`,
      `Kruskal-Wallis tests on wait_min by hour (24 groups) and by weekday (7 groups), alpha ${RULES.alpha}.`);
    if (sig(t.waitByAge)) add('Wait by age', `Waits differ statistically by age group (p = ${U.fmtP(t.waitByAge.p)}), but the effect is ${U.describeEffect(t.waitByAge.epsilon_sq)} (epsilon squared ${Math.max(0, t.waitByAge.epsilon_sq).toFixed(4)}): age explains almost none of the variation in waiting time.`,
      'Kruskal-Wallis test on wait_min by age group; effect size epsilon squared (under 0.01 = negligible).');
    const ar = t.admByReferral; const topAdm = refs.slice().sort((a, b) => b.admissions - a.admissions);
    const topSpecialty = topAdm.find((r) => r.referral !== 'None');
    add('Admissions', `${U.fmtPct(k.adm_rate)} of visits led to admission.${topSpecialty ? ` Among referral departments, ${topSpecialty.referral} generates the most admissions (${U.fmtNum(topSpecialty.admissions)}, ${U.fmtPct(topSpecialty.share_of_admissions_pct)} of all).` : ''} Admission rates ${sig(ar) ? 'differ significantly' : 'do not differ significantly'} by referral department (chi-square p = ${U.fmtP(ar.p)}, Cramer's V ${isNum(ar.cramers_v) ? ar.cramers_v.toFixed(3) : 'n/a'})${sig(ar) ? '' : ', so volume, not a higher admission rate, drives the larger counts'}.`,
      'Admissions counted per referral group; chi-square test of independence (no continuity correction) between referral group and admission.');
    const sp = t.waitSatSpearman;
    if (isNum(sp.r)) add('Wait vs satisfaction', `Across ${U.fmtNum(sp.n)} survey responses, waiting time and satisfaction show ${U.describeCorr(sp.r)} association (Spearman rho = ${sp.r.toFixed(3)}, p = ${U.fmtP(sp.p)}).${satBand.length > 1 ? ` Average satisfaction by wait band ranges from ${Math.min(...satBand.map((b) => b.mean)).toFixed(2)} to ${Math.max(...satBand.map((b) => b.mean)).toFixed(2)}.` : ''}${sig(sp) ? '' : ' In this data shorter waits alone do not go with higher satisfaction.'}`,
      'Spearman rank correlation between wait_min and satisfaction score, respondents only; alpha 0.05.');
    const sg = t.satBy; const sigGroups = ['gender', 'race', 'age_group', 'admitted_label', 'referral'].filter((g) => sig(sg[g]));
    const names = { gender: 'gender', race: 'race', age_group: 'age group', admitted_label: 'admission status', referral: 'referral department' };
    add('Satisfaction by group', `Average satisfaction is ${U.fmtScore(k.avg_sat)} and ${U.fmtPct(k.pct_satisfied)} of respondents score ${RULES.satisfiedMin}-10. ${sigGroups.length ? `Satisfaction differs significantly by ${sigGroups.map((g) => names[g]).join(', ')}.` : 'No patient group (gender, race, age group, admission status, referral department) differs significantly.'}`,
      'Kruskal-Wallis tests on satisfaction for each grouping, respondents only, alpha 0.05.');
    if (isNum(k.resp_rate) && k.resp_rate < RULES.status.response.warn) add('Data caution', `Only ${U.fmtPct(k.resp_rate)} of visits have a satisfaction score (${U.fmtNum(k.n_resp)} responses). Results describe respondents and may not represent all patients.`,
      `Response rate under ${RULES.status.response.warn}% triggers this caution.`);
    if (yy) add('Year on year', `Same months (${yy.months[0]}-${yy.months[yy.months.length - 1]}) ${yy.y2} vs ${yy.y1}: visits a day ${U.fmtSigned(yy.d_per_day_pct, 1, '%')}, average wait ${U.fmtSigned(yy.d_avg_wait, 1, ' min')}, share over target ${U.fmtPp(yy.d_pct_over)}, admission rate ${U.fmtPp(yy.d_adm_rate)}.`,
      'Months present in both of the last two calendar years in view, compared per calendar day.');
    return out;
  }

  // ---------------------------------------------------------------- rule-based recommendations (each with its evidence)
  function recommendations(ctx) {
    const { k, t, refs, target } = ctx; const out = [];
    if (!k.visits) return out;
    const add = (horizon, text, evidence) => out.push({ horizon, text, evidence });
    if (isNum(k.pct_over) && k.pct_over > RULES.status.overTarget.warn) {
      add('Immediate', `Make waiting time the department's headline performance measure: review the share of patients waiting over ${target} minutes daily and escalate when it rises.`,
        `${U.fmtPct(k.pct_over)} of visits waited over ${target} min; average ${U.fmtMin(k.avg_wait)}.`);
      if (!sig(t.waitByHour) && !sig(t.waitByWeekday)) add('Short term', 'Map the patient journey (arrival, triage, assessment, decision, bed) to find where time is lost, rather than moving staff between shifts.',
        `Waits do not differ significantly by hour (p = ${U.fmtP(t.waitByHour.p)}) or weekday (p = ${U.fmtP(t.waitByWeekday.p)}), so delays are not tied to particular shifts.`);
      else add('Short term', 'Add capacity at the hours and days with the longest waits identified in the Waiting times tab.', `Waits differ significantly by ${sig(t.waitByHour) ? 'hour' : 'weekday'}.`);
    }
    if (k.busiest_day && isNum(k.day_spread_pct)) {
      if (k.day_spread_pct < RULES.evenSpreadPct) add('Short term', `Keep staffing levels broadly flat across the week, and prepare a surge plan for exceptional days rather than fixed weekend uplifts.`,
        `Busiest (${k.busiest_day.weekday}) and quietest (${k.quietest_day.weekday}) days differ by only ${U.fmtPct(k.day_spread_pct, 0)}; ${k.peak_days} surge day(s) above ${isNum(k.peak_threshold) ? k.peak_threshold.toFixed(1) : 'n/a'} visits.`);
      else add('Short term', `Align rosters with weekly demand, adding cover on ${k.busiest_day.weekday}.`, `${k.busiest_day.weekday} averages ${U.fmtPct(k.day_spread_pct, 0)} more visits than ${k.quietest_day.weekday}.`);
    }
    const ref = refs.filter((r) => r.referral !== 'None').sort((a, b) => b.visits - a.visits);
    if (ref.length >= 2) add('Short term', `Agree fast-track referral and admission pathways with ${ref[0].referral} and ${ref[1].referral}, the two largest referral departments.`,
      `Together ${U.fmtPct(((ref[0].visits + ref[1].visits) / k.visits) * 100)} of all visits and ${U.fmtNum(ref[0].admissions + ref[1].admissions)} admissions; admission rates ${sig(t.admByReferral) ? 'differ' : 'are similar'} across departments (p = ${U.fmtP(t.admByReferral.p)}).`);
    if (isNum(k.resp_rate) && k.resp_rate < RULES.status.response.warn) add('Immediate', 'Raise the survey response rate (for example a short question at discharge or by text message) before using satisfaction to judge performance.',
      `Only ${U.fmtPct(k.resp_rate)} of visits have a score; respondents waited ${U.fmtMin(t.respBias.respondWait)} on average vs ${U.fmtMin(t.respBias.nonRespondWait)} for non-respondents.`);
    const sp = t.waitSatSpearman;
    if (isNum(sp.r) && !sig(sp)) add('Longer term', 'Do not assume that cutting waits alone will lift satisfaction. Add questions on communication, pain management and staff attitude to find what drives scores.',
      `Spearman rho = ${sp.r.toFixed(3)} (p = ${U.fmtP(sp.p)}) between wait and satisfaction.`);
    if (isNum(k.pct_satisfied) && k.pct_satisfied < RULES.status.satisfied.warn) add('Longer term', 'Set a patient-experience improvement target and track it monthly alongside waiting times.', `${U.fmtPct(k.pct_satisfied)} of respondents scored ${RULES.satisfiedMin}-10; average ${U.fmtScore(k.avg_sat)}.`);
    add('Longer term', 'Capture triage category, time to first clinician, length of stay and discharge outcome, so waits can be judged against clinical urgency.',
      'The current data has one waiting-time figure per visit and no acuity or length-of-stay fields.');
    const order = { Immediate: 0, 'Short term': 1, 'Longer term': 2 };
    return out.sort((a, b) => order[a.horizon] - order[b.horizon]);
  }

  // ---------------------------------------------------------------- one call that builds the full analysis context
  function analyse(rows, all, filters, target) {
    const P = period(all, filters);
    const months = monthStats(rows, P), weekdays = weekdayStats(rows, P), hours = hourStats(rows, P), day = daily(rows, P);
    const refs = referralStats(rows);
    const k = kpis(rows, P, months, weekdays, hours, day);
    const t = rows.length ? tests(rows) : null;
    const satBand = groupSat(rows, 'wait_band').filter((g) => g.n > 0);
    const yy = yoy(rows, months);
    const ctx = { rows, P, months, weekdays, hours, day, refs, k, t, target, satBand, yy };
    ctx.insights = t ? insights(ctx) : []; ctx.recs = t ? recommendations(ctx) : []; ctx.attention = attention(k, target);
    return ctx;
  }

  window.ErAnalytics = { applyFilters, period, stats, monthStats, weekdayStats, hourStats, heat, daily, referralStats, groupSat, admissionBy, waitHist, satDistribution, satMixByWait,
    tests, kpis, yoy, attention, insights, recommendations, analyse, sig };
})();
