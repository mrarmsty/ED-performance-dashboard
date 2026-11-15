/* charts.js - ECharts builders. Colours come from CSS custom properties so light and dark mode share one code path.
   Rules followed: one y-axis per chart, categorical colours in a fixed order, sequential colour = one hue light to
   dark, diverging = two hues with a grey middle, values formatted with units in every tooltip, bars start at zero. */
(function () {
  'use strict';
  const U = window.ErUtils;
  const { MEASURES, DAYS } = window.ErConfig;
  const instances = new Map();
  let animate = true;                       // switched off while charts are rendered for the PDF report
  const setAnimation = (on) => { animate = on; };

  // Colours are read from the chart element itself, so an element inside a light-themed container (the PDF report
  // canvas) gets light colours even when the page is in dark mode.
  function palette(el) {
    const cs = getComputedStyle(el || document.documentElement); const css = (n) => cs.getPropertyValue(n).trim();
    return {
      text: css('--text-primary'), text2: css('--text-secondary'), muted: css('--text-muted'), grid: css('--grid'), axis: css('--axis'),
      surface: css('--surface-1'), series: [css('--series-1'), css('--series-2'), css('--series-3')], other: css('--series-other'),
      pos: css('--div-pos'), neg: css('--div-neg'), mid: css('--div-mid'), seqLo: css('--seq-lo'), seqHi: css('--seq-hi'), warning: css('--warning'),
    };
  }
  function get(el) {
    let c = instances.get(el);
    if (!c || c.isDisposed()) { c = window.echarts.init(el, null, { renderer: 'canvas' }); instances.set(el, c); }
    return c;
  }
  function render(el, option, onClick) {
    const c = get(el); c.clear();
    c.setOption({ aria: { enabled: true }, animation: animate, animationDuration: 300, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' }, ...option }, true);
    c.off('click'); if (onClick) c.on('click', (p) => onClick(p));
    return c;
  }
  const axisCommon = (P) => ({ axisLine: { lineStyle: { color: P.axis } }, axisTick: { show: false }, axisLabel: { color: P.text2, fontSize: 11 }, splitLine: { lineStyle: { color: P.grid } }, nameTextStyle: { color: P.text2, fontSize: 11 } });
  const tip = (P) => ({ backgroundColor: P.surface, borderColor: P.axis, textStyle: { color: P.text, fontSize: 12 }, extraCssText: 'box-shadow:0 4px 16px rgba(0,0,0,.12);border-radius:8px;' });
  const axisFmt = (unit) => (v) => (unit === 'pct' ? `${v}%` : unit === 'min' ? `${v}m` : `${v}`);
  function empty(el, msg) { render(el, { title: { text: msg, left: 'center', top: 'middle', textStyle: { color: palette(el).muted, fontSize: 13, fontWeight: 'normal' } } }); }
  const avgLine = (P, value, label) => ({ silent: true, symbol: 'none', lineStyle: { color: P.text2, type: 'dashed', width: 1 }, label: { color: P.text2, fontSize: 10, formatter: label, position: 'insideEndTop', backgroundColor: P.surface, padding: [1, 3] }, data: [{ yAxis: value }] });

  // ---------------------------------------------------------------- monthly trend of one measure
  function monthTrend(el, months, { measure, overall, onClick }) {
    const P = palette(el), m = MEASURES[measure];
    const data = months.map((x) => (U.isNum(x[measure]) ? +x[measure].toFixed(3) : null));
    if (!data.some((v) => v !== null)) return empty(el, 'No data for the current filters');
    render(el, {
      grid: { left: 52, right: 24, top: 24, bottom: 40 },
      tooltip: { ...tip(P), trigger: 'axis', formatter: (ps) => { const x = months[ps[0].dataIndex];
        return `<b>${U.monthLabel(x.month)}</b>${x.days < 28 ? ` <span style="color:${P.muted}">(${x.days} days in range)</span>` : ''}<br/>${m.label}: <b>${U.fmtByUnit(x[measure], m.unit)}</b><br/>Visits: ${U.fmtNum(x.visits)} · avg wait ${U.fmtMin(x.avg_wait)} · admitted ${U.fmtPct(x.adm_rate)}`; } },
      xAxis: { type: 'category', data: months.map((x) => U.monthLabel(x.month)), boundaryGap: false, ...axisCommon(P), splitLine: { show: false }, axisLabel: { color: P.text2, fontSize: 10, rotate: months.length > 12 ? 40 : 0 } },
      yAxis: { type: 'value', min: 0, max: m.unit === 'score' ? 10 : undefined, ...axisCommon(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axisFmt(m.unit) } },
      series: [{ name: m.label, type: 'line', data, symbol: 'circle', symbolSize: 7, lineStyle: { width: 2, color: P.series[0] }, itemStyle: { color: P.series[0], borderColor: P.surface, borderWidth: 2 },
        markLine: U.isNum(overall) ? avgLine(P, overall, `period ${U.fmtByUnit(overall, m.unit)}`) : undefined }],
    }, onClick && ((p) => onClick(months[p.dataIndex].month)));
  }

  // ---------------------------------------------------------------- vertical bars for weekday or hour profiles
  function profileBars(el, items, { labelKey, measure, overall, labelFmt = (v) => v, highlightMax = true }) {
    const P = palette(el), m = MEASURES[measure];
    const vals = items.map((x) => (U.isNum(x[measure]) ? x[measure] : null));
    if (!vals.some((v) => v !== null)) return empty(el, 'No data for the current filters');
    const max = Math.max(...vals.filter((v) => v !== null));
    render(el, {
      grid: { left: 48, right: 16, top: 30, bottom: 30 },
      tooltip: { ...tip(P), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => { const x = items[ps[0].dataIndex];
        return `<b>${U.esc(labelFmt(x[labelKey]))}</b><br/>${m.label}: <b>${U.fmtByUnit(x[measure], m.unit)}</b><br/>Visits: ${U.fmtNum(x.visits)} · avg wait ${U.fmtMin(x.avg_wait)} · over target ${U.fmtPct(x.pct_over)}`; } },
      xAxis: { type: 'category', data: items.map((x) => labelFmt(x[labelKey])), ...axisCommon(P), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisCommon(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axisFmt(m.unit) } },
      series: [{ type: 'bar', barMaxWidth: 36, data: vals.map((v) => ({ value: v === null ? null : +v.toFixed(3), itemStyle: { color: highlightMax && v === max ? P.series[0] : P.other, borderRadius: [4, 4, 0, 0] } })),
        markLine: U.isNum(overall) ? avgLine(P, overall, `overall ${U.fmtByUnit(overall, m.unit)}`) : undefined }],
    });
  }

  // ---------------------------------------------------------------- weekday x hour heatmap (sequential, one hue)
  function heatmap(el, grid) {
    const P = palette(el);
    const data = []; let max = 0;
    grid.forEach((row, d) => row.forEach((v, h) => { if (U.isNum(v)) { data.push([h, d, +v.toFixed(3)]); max = Math.max(max, v); } }));
    if (!data.length || !max) return empty(el, 'No data for the current filters');
    render(el, {
      grid: { left: 84, right: 16, top: 8, bottom: 60 },
      tooltip: { ...tip(P), formatter: (p) => `<b>${DAYS[p.value[1]]} ${U.hourLabel(p.value[0])}</b><br/>${p.value[2].toFixed(2)} visits on an average ${DAYS[p.value[1]]}` },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), ...axisCommon(P), splitLine: { show: false } },
      yAxis: { type: 'category', data: DAYS, inverse: true, ...axisCommon(P), splitLine: { show: false }, axisLabel: { color: P.text, fontSize: 11 } },
      visualMap: { min: 0, max: +max.toFixed(2), calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 10, text: [`${max.toFixed(2)} visits`, '0'], textStyle: { color: P.text2, fontSize: 10 },
        inRange: { color: [P.seqLo, P.seqHi] } },
      series: [{ type: 'heatmap', data, itemStyle: { borderColor: P.surface, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: P.text, borderWidth: 1 } } }],
    });
  }

  // ---------------------------------------------------------------- daily visits with surge threshold
  function dailyLine(el, day) {
    const P = palette(el);
    if (!day.series.length) return empty(el, 'No data for the current filters');
    const peakIdx = new Set(day.peaks.map((p) => p.date));
    render(el, {
      grid: { left: 44, right: 24, top: 28, bottom: 56 },
      legend: { top: 0, left: 0, textStyle: { color: P.text2, fontSize: 11 }, itemWidth: 14, itemHeight: 8, data: ['Visits per day', 'Surge day'] },
      tooltip: { ...tip(P), trigger: 'axis', formatter: (ps) => { const s = day.series[ps[0].dataIndex]; return `<b>${s.date}</b><br/>${s.visits} visits${peakIdx.has(s.date) ? ' <b>(surge day)</b>' : ''}<br/><span style="color:${P.muted}">Threshold ${U.isNum(day.threshold) ? day.threshold.toFixed(1) : 'n/a'}</span>`; } },
      xAxis: { type: 'category', data: day.series.map((s) => s.date), boundaryGap: false, ...axisCommon(P), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisCommon(P) },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8, borderColor: P.grid, textStyle: { color: P.text2, fontSize: 10 } }],
      series: [
        { name: 'Visits per day', type: 'line', data: day.series.map((s) => s.visits), symbol: 'none', lineStyle: { width: 1.2, color: P.series[0] }, itemStyle: { color: P.series[0] },
          markLine: U.isNum(day.threshold) ? { silent: true, symbol: 'none', lineStyle: { color: P.series[1], type: 'dashed' }, label: { color: P.text2, fontSize: 10, formatter: `surge threshold ${day.threshold.toFixed(1)}`, position: 'insideEndTop' }, data: [{ yAxis: +day.threshold.toFixed(2) }] } : undefined },
        { name: 'Surge day', type: 'scatter', data: day.series.map((s) => (peakIdx.has(s.date) ? s.visits : null)), symbolSize: 8, itemStyle: { color: P.series[1], borderColor: P.surface, borderWidth: 1.5 } },
      ],
    });
  }

  // ---------------------------------------------------------------- waiting-time distribution, coloured by target
  function waitHist(el, bins, target) {
    const P = palette(el);
    if (!bins.length) return empty(el, 'No data for the current filters');
    const total = bins.reduce((s, b) => s + b.count, 0);
    render(el, {
      grid: { left: 52, right: 16, top: 32, bottom: 40 },
      legend: { top: 0, left: 0, textStyle: { color: P.text2, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      tooltip: { ...tip(P), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => { const b = bins[ps[0].dataIndex]; return `<b>${b.label} min</b><br/>${U.fmtNum(b.count)} visits (${U.fmtPct(b.count / total * 100)})<br/>${b.over ? `Over the ${target}-min target` : `Within the ${target}-min target`}`; } },
      xAxis: { type: 'category', data: bins.map((b) => b.label), name: 'minutes', nameLocation: 'middle', nameGap: 26, ...axisCommon(P), splitLine: { show: false }, axisLabel: { color: P.text2, fontSize: 10 } },
      yAxis: { type: 'value', ...axisCommon(P) },
      series: [
        { name: `Within target (${target} min or less)`, type: 'bar', stack: 'w', barCategoryGap: '12%', data: bins.map((b) => (b.over ? null : b.count)), itemStyle: { color: P.series[0], borderRadius: [4, 4, 0, 0] } },
        { name: `Over target (more than ${target} min)`, type: 'bar', stack: 'w', data: bins.map((b) => (b.over ? b.count : null)), itemStyle: { color: P.series[1], borderRadius: [4, 4, 0, 0] } },
      ],
    });
  }

  // ---------------------------------------------------------------- box plot of waits by referral department
  function referralBox(el, refs, target, onClick) {
    const P = palette(el);
    if (!refs.length) return empty(el, 'No data for the current filters');
    const items = refs.slice().sort((a, b) => a.median_wait - b.median_wait || a.avg_wait - b.avg_wait);
    render(el, {
      grid: { left: 118, right: 24, top: 16, bottom: 36 },
      tooltip: { ...tip(P), trigger: 'item', formatter: (p) => { const r = items[p.dataIndex]; if (!r) return '';
        return `<b>${U.esc(r.referral)}</b> (${U.fmtNum(r.visits)} visits)<br/>Median ${U.fmtMin(r.median_wait, 0)} · mean ${U.fmtMin(r.avg_wait)}<br/>Middle 50%: ${U.fmtMin(r.q1, 0)} to ${U.fmtMin(r.q3, 0)}<br/>Range ${U.fmtMin(r.min, 0)} to ${U.fmtMin(r.max, 0)}<br/>Over target: ${U.fmtPct(r.pct_over)}`; } },
      xAxis: { type: 'value', name: 'minutes', nameLocation: 'middle', nameGap: 24, min: 0, ...axisCommon(P) },
      yAxis: { type: 'category', data: items.map((r) => r.referral), ...axisCommon(P), splitLine: { show: false }, axisLabel: { color: P.text, fontSize: 11 } },
      series: [{ type: 'boxplot', data: items.map((r) => [r.min, r.q1, r.median_wait, r.q3, r.max]), itemStyle: { color: P.seqLo, borderColor: P.series[0], borderWidth: 1.5 }, boxWidth: [8, 22],
        markLine: { silent: true, symbol: 'none', lineStyle: { color: P.series[1], type: 'dashed' }, label: { color: P.text2, fontSize: 10, formatter: `target ${target} min` }, data: [{ xAxis: target }] } }],
    }, onClick && ((p) => items[p.dataIndex] && onClick(items[p.dataIndex].referral)));
  }

  // ---------------------------------------------------------------- referral volumes split by admission
  function referralVolume(el, refs, onClick) {
    const P = palette(el);
    if (!refs.length) return empty(el, 'No data for the current filters');
    const items = refs.slice().sort((a, b) => a.visits - b.visits);
    render(el, {
      grid: { left: 118, right: 48, top: 30, bottom: 24 },
      legend: { top: 0, left: 0, textStyle: { color: P.text2, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      tooltip: { ...tip(P), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => { const r = items[ps[0].dataIndex];
        return `<b>${U.esc(r.referral)}</b><br/>${U.fmtNum(r.visits)} visits (${U.fmtPct(r.share_pct)} of all)<br/>Admitted: ${U.fmtNum(r.admissions)} (${U.fmtPct(r.adm_rate)})<br/>Share of all admissions: ${U.fmtPct(r.share_of_admissions_pct)}`; } },
      xAxis: { type: 'value', ...axisCommon(P) },
      yAxis: { type: 'category', data: items.map((r) => r.referral), ...axisCommon(P), splitLine: { show: false }, axisLabel: { color: P.text, fontSize: 11 } },
      series: [
        { name: 'Admitted', type: 'bar', stack: 'v', barMaxWidth: 20, data: items.map((r) => r.admissions), itemStyle: { color: P.series[0], borderColor: P.surface, borderWidth: 1 } },
        { name: 'Not admitted', type: 'bar', stack: 'v', barMaxWidth: 20, data: items.map((r) => r.visits - r.admissions), itemStyle: { color: P.other, borderRadius: [0, 4, 4, 0], borderColor: P.surface, borderWidth: 1 },
          label: { show: true, position: 'right', color: P.text2, fontSize: 10, formatter: (p) => U.fmtNum(items[p.dataIndex].visits) } },
      ],
    }, onClick && ((p) => onClick(items[p.dataIndex].referral)));
  }

  // ---------------------------------------------------------------- horizontal bars of a rate by group, with overall line
  function rateBars(el, items, { labelKey = 'group', valueKey, unit = 'pct', overall, nKey = 'visits', nLabel = 'visits', onClick, sort = false }) {
    const P = palette(el);
    let data = items.filter((d) => U.isNum(d[valueKey]));
    if (sort) data = data.slice().sort((a, b) => a[valueKey] - b[valueKey]); else data = data.slice().reverse();
    if (!data.length) return empty(el, 'No data for the current filters');
    render(el, {
      grid: { left: 130, right: 64, top: 16, bottom: 24 },
      tooltip: { ...tip(P), trigger: 'item', formatter: (p) => { const d = data[p.dataIndex]; return `<b>${U.esc(d[labelKey])}</b><br/>${U.fmtByUnit(d[valueKey], unit)}<br/>${U.fmtNum(d[nKey])} ${nLabel}${d.small ? `<br/><i>Small group (under 30): treat with caution</i>` : ''}`; } },
      xAxis: { type: 'value', ...axisCommon(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axisFmt(unit) }, max: unit === 'pct' ? 100 : undefined },
      yAxis: { type: 'category', data: data.map((d) => d[labelKey]), ...axisCommon(P), splitLine: { show: false }, axisLabel: { color: P.text, fontSize: 11 } },
      series: [{ type: 'bar', barMaxWidth: 18, data: data.map((d) => ({ value: +d[valueKey].toFixed(3), itemStyle: { color: P.series[0], opacity: d.small ? 0.45 : 1, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: P.text2, fontSize: 10, formatter: (p) => `${U.fmtByUnit(p.value, unit)}  n=${U.fmtNum(data[p.dataIndex][nKey])}` },
        markLine: U.isNum(overall) ? { silent: true, symbol: 'none', lineStyle: { color: P.text2, type: 'dashed' }, label: { color: P.text2, fontSize: 10, formatter: `all ${U.fmtByUnit(overall, unit)}` }, data: [{ xAxis: +overall.toFixed(3) }] } : undefined }],
    }, onClick && ((p) => onClick(data[p.dataIndex][labelKey], data[p.dataIndex])));
  }

  // ---------------------------------------------------------------- mean satisfaction with 95% confidence intervals
  function satBars(el, groups, overall) {
    const P = palette(el);
    const data = groups.filter((g) => U.isNum(g.mean)).slice().reverse();
    if (!data.length) return empty(el, 'No survey responses for the current filters');
    render(el, {
      grid: { left: 130, right: 70, top: 16, bottom: 24 },
      tooltip: { ...tip(P), trigger: 'item', formatter: (p) => { const d = data[p.dataIndex]; return `<b>${U.esc(d.group)}</b><br/>Average ${d.mean.toFixed(2)} / 10${U.isNum(d.lo) ? `<br/>95% CI ${d.lo.toFixed(2)} to ${d.hi.toFixed(2)}` : ''}<br/>${U.fmtNum(d.n)} responses (${U.fmtPct(d.resp_rate)} response rate)<br/>Scoring 8-10: ${U.fmtPct(d.pct_satisfied)}${d.small ? '<br/><i>Fewer than 30 responses: treat with caution</i>' : ''}`; } },
      xAxis: { type: 'value', min: 0, max: 10, ...axisCommon(P) },
      yAxis: { type: 'category', data: data.map((d) => d.group), ...axisCommon(P), splitLine: { show: false }, axisLabel: { color: P.text, fontSize: 11 } },
      series: [
        { type: 'bar', barMaxWidth: 16, data: data.map((d) => ({ value: +d.mean.toFixed(3), itemStyle: { color: P.series[0], opacity: d.small ? 0.45 : 1, borderRadius: [0, 4, 4, 0] } })),
          markLine: U.isNum(overall) ? { silent: true, symbol: 'none', lineStyle: { color: P.text2, type: 'dashed' }, label: { color: P.text2, fontSize: 10, formatter: `all ${overall.toFixed(2)}` }, data: [{ xAxis: +overall.toFixed(3) }] } : undefined },
        { type: 'scatter', silent: true, symbolSize: 0, z: 11, data: data.map((d, i) => [Math.max(d.mean, U.isNum(d.hi) ? d.hi : d.mean), i]),
          label: { show: true, position: 'right', distance: 6, color: P.text2, fontSize: 10, formatter: (p) => `${data[p.dataIndex].mean.toFixed(2)}  n=${data[p.dataIndex].n}` } },
        { type: 'custom', silent: true, z: 10, data: data.map((d, i) => [i, d.lo, d.hi]).filter((d) => U.isNum(d[1])),
          renderItem: (params, api) => { const i = api.value(0); const a = api.coord([api.value(1), i]); const b = api.coord([api.value(2), i]); const h = 5;
            const st = { stroke: P.text, lineWidth: 1.4 };
            return { type: 'group', children: [{ type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: st }, { type: 'line', shape: { x1: a[0], y1: a[1] - h, x2: a[0], y2: a[1] + h }, style: st }, { type: 'line', shape: { x1: b[0], y1: b[1] - h, x2: b[0], y2: b[1] + h }, style: st }] }; } },
      ],
    });
  }

  // ---------------------------------------------------------------- satisfaction mix by wait band (100% stacked, diverging)
  function satMix(el, mix) {
    const P = palette(el);
    if (!mix.length) return empty(el, 'No survey responses for the current filters');
    const ser = (name, key, color, radius) => ({ name, type: 'bar', stack: 'm', barMaxWidth: 22, data: mix.map((m) => +(m[key] || 0).toFixed(2)), itemStyle: { color, borderColor: P.surface, borderWidth: 1, borderRadius: radius } });
    render(el, {
      grid: { left: 64, right: 24, top: 30, bottom: 30 },
      legend: { top: 0, left: 0, textStyle: { color: P.text2, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      tooltip: { ...tip(P), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => { const m = mix[ps[0].dataIndex];
        return `<b>Waited ${m.band} min</b> (${m.n} responses)<br/>Low 0-4: ${U.fmtPct(m.low)}<br/>Medium 5-7: ${U.fmtPct(m.medium)}<br/>High 8-10: ${U.fmtPct(m.high)}`; } },
      xAxis: { type: 'value', max: 100, ...axisCommon(P), axisLabel: { color: P.text2, fontSize: 11, formatter: '{value}%' } },
      yAxis: { type: 'category', data: mix.map((m) => `${m.band} min`), inverse: true, ...axisCommon(P), splitLine: { show: false }, axisLabel: { color: P.text, fontSize: 11 } },
      series: [ser('Low (0-4)', 'low', P.neg, [4, 0, 0, 4]), ser('Medium (5-7)', 'medium', P.other, 0), ser('High (8-10)', 'high', P.pos, [0, 4, 4, 0])],
    });
  }

  // ---------------------------------------------------------------- distribution of satisfaction scores
  function satDist(el, dist) {
    const P = palette(el);
    if (!dist.some((d) => d.n)) return empty(el, 'No survey responses for the current filters');
    render(el, {
      grid: { left: 48, right: 16, top: 16, bottom: 36 },
      tooltip: { ...tip(P), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => { const d = dist[ps[0].dataIndex]; return `<b>Score ${d.score}</b><br/>${U.fmtNum(d.n)} responses (${U.fmtPct(d.pct)})`; } },
      xAxis: { type: 'category', data: dist.map((d) => d.score), name: 'score', nameLocation: 'middle', nameGap: 24, ...axisCommon(P), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisCommon(P) },
      series: [{ type: 'bar', barCategoryGap: '20%', data: dist.map((d) => ({ value: d.n, itemStyle: { color: d.score < 5 ? P.neg : d.score < 8 ? P.other : P.pos, borderRadius: [4, 4, 0, 0] } })) }],
    });
  }

  function resizeAll() { instances.forEach((c) => { if (!c.isDisposed()) c.resize(); }); }
  function image(el) { const c = instances.get(el); return c && !c.isDisposed() ? c.getDataURL({ type: 'jpeg', pixelRatio: 2, backgroundColor: '#ffffff' }) : null; }

  window.ErCharts = { monthTrend, profileBars, heatmap, dailyLine, waitHist, referralBox, referralVolume, rateBars, satBars, satMix, satDist, resizeAll, image, palette, setAnimation };
})();
