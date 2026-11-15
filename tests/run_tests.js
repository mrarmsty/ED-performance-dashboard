/* End-to-end tests for the dashboard (Playwright + Chromium).
   Usage (from the repository root, with a static server running on port 8765):
     python -m http.server 8765 &   then   node tests/run_tests.js
   Expected values come from scripts/prepare_data.py (pandas/SciPy) and from the data files themselves, never from
   the dashboard. Results are written to tests/results.json; README screenshots to assets/images/. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const URL = process.env.DASH_URL || 'http://localhost:8765/index.html';
const DATA = (f) => path.join(ROOT, 'tests', 'data', f);
const IMG = (f) => path.join(ROOT, 'assets', 'images', f);
const DL = path.join(ROOT, 'tests', 'downloads'); fs.mkdirSync(DL, { recursive: true }); fs.mkdirSync(path.join(ROOT, 'assets', 'images'), { recursive: true });
const results = []; let current = '';
const check = (name, ok, detail = '') => { results.push({ test: current, check: name, pass: !!ok, detail: String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${current}] ${name}${detail ? ' - ' + String(detail).slice(0, 160) : ''}`); };
const close = (a, b, tol = 1e-6) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---------------- independent expectations
const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/processed/reference_values.json')));
const readCsv = (f) => { const l = fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/); const h = l[0].split(','); return l.slice(1).map((x) => { const v = x.split(','); return Object.fromEntries(h.map((k, i) => [k, v[i]])); }); };
const deid = readCsv(path.join(ROOT, 'data/er_visits_deidentified.csv'));
const pyRows = readCsv(path.join(ROOT, 'data/processed/er_visits_analysis.csv'));
const isoOf = (s) => `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
const fromApr2024 = deid.filter((r) => isoOf(r['Patient Admission Date']) >= '2024-04-01').length;
const over45 = deid.filter((r) => +r['Patient Waittime'] > 45).length / deid.length * 100;
const nGP = deid.filter((r) => r['Department Referral'] === 'General Practice').length, nF = deid.filter((r) => r['Patient Gender'] === 'F').length;
const nAdm = deid.filter((r) => r['Patient Admission Flag'] === 'TRUE').length;
const RAW = path.join(ROOT, 'data/raw/Hospital_ER_Data.csv');      // not in the public repository (contains names)

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; let alerts = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', async (d) => { alerts++; await d.dismiss(); });
  const S = (fn, arg) => page.evaluate(fn, arg);
  const st = () => S(() => { const s = window.ErApp.state; return { n: s.all.length, filtered: s.filtered.length, k: s.ctx.k, batches: s.batches.length, target: s.target }; });
  const upload = async (file, mode = 'append') => { await page.click(`input[name="mode"][value="${mode}"]`); await page.setInputFiles('#fileInput', file.includes('/') ? file : DATA(file)); await page.waitForTimeout(900); };
  const statText = () => page.$$eval('#uploadPanel .stat', (els) => Object.fromEntries(els.map((e) => [e.querySelector('span').textContent, +e.querySelector('b').textContent.replace(/,/g, '')])));
  const tab = async (t) => { await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(600); };
  const download = async (trigger) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), trigger()]); const p = path.join(DL, d.suggestedFilename()); await d.saveAs(p); return p; };
  const shot = async (name, full = true) => { await page.mouse.move(5, 5); await page.evaluate(() => document.getElementById('toast').classList.remove('show')); await page.waitForTimeout(350); await page.screenshot({ path: IMG(name), fullPage: full }); };

  // ------------------------------------------------------------ 1 load and accuracy vs pandas/SciPy
  current = 'T01 load and KPI accuracy';
  await page.goto(URL); await page.waitForFunction(() => window.ErApp && window.ErApp.state.ctx, null, { timeout: 20000 });
  await page.evaluate(() => indexedDB.deleteDatabase('er-dashboard')); await page.reload(); await page.waitForFunction(() => window.ErApp && window.ErApp.state.ctx);
  let s = await st();
  check('9,216 visits loaded over 579 calendar days', s.n === ref.visits && s.k.days === ref.calendar_days, `${s.n} visits, ${s.k.days} days`);
  [['per_day', 'avg_visits_per_day'], ['avg_wait', 'avg_wait'], ['median_wait', 'median_wait'], ['p90_wait', 'p90_wait'], ['pct_over', 'pct_over_target'], ['adm_rate', 'admission_rate'],
    ['ref_rate', 'referral_rate'], ['resp_rate', 'response_rate'], ['avg_sat', 'avg_satisfaction'], ['pct_satisfied', 'pct_satisfied_8plus']]
    .forEach(([js, p]) => check(`KPI ${js} matches pandas`, close(s.k[js], ref[p], 1e-9), `dashboard ${s.k[js]} vs python ${ref[p]}`));
  check('busiest weekday, hour and month match pandas', s.k.busiest_day.weekday === ref.busiest_weekday && s.k.busiest_hour.hour === ref.busiest_hour && s.k.busiest_month.month === ref.busiest_month,
    `${s.k.busiest_day.weekday}, ${s.k.busiest_hour.hour}, ${s.k.busiest_month.month}`);
  const c = await S(() => { const x = window.ErApp.state.ctx; return { peaks: x.day.peaks.map((p) => p.date), thr: x.day.threshold, t: x.t, months: x.months, weekdays: x.weekdays, hours: x.hours, refs: x.refs }; });
  check('surge days (mean + 2 SD) identical to pandas', JSON.stringify(c.peaks) === JSON.stringify(ref.peak_days) && close(c.thr, ref.peak_threshold, 1e-9), `${c.peaks.length} days, threshold ${c.thr}`);
  check('visits by month identical', c.months.every((m) => ref.month_visits[m.month] === m.visits), '19 months');
  check('average visits per weekday identical', c.weekdays.every((w) => close(w.visits_per_day, ref.weekday_avg_visits[w.weekday], 1e-5)));
  check('visits by hour identical', c.hours.every((h) => ref.hour_visits[String(h.hour)] === h.visits));
  check('admissions and average wait by referral identical', c.refs.every((r) => ref.admissions_by_referral[r.referral] === r.admissions && close(r.avg_wait, ref.avg_wait_by_referral[r.referral], 1e-5)));
  const kw = (a, b) => close(a.H, b.H, 1e-6) && close(a.p, b.p, 1e-6);
  check('Kruskal-Wallis wait by referral matches SciPy', kw(c.t.waitByReferral, ref.kw_wait_by_referral), `H ${c.t.waitByReferral.H}, p ${c.t.waitByReferral.p}`);
  check('Kruskal-Wallis wait by weekday matches SciPy', kw(c.t.waitByWeekday, ref.kw_wait_by_weekday));
  check('Kruskal-Wallis wait by hour matches SciPy', kw(c.t.waitByHour, ref.kw_wait_by_hour));
  check('Kruskal-Wallis wait by age group matches SciPy', kw(c.t.waitByAge, ref.kw_wait_by_age_group));
  check('chi-square admission by referral matches SciPy', close(c.t.admByReferral.chi2, ref.chi2_admission_by_referral.chi2) && close(c.t.admByReferral.p, ref.chi2_admission_by_referral.p) && close(c.t.admByReferral.cramers_v, ref.chi2_admission_by_referral.cramers_v), `p ${c.t.admByReferral.p}`);
  check('chi-square admission by age group matches SciPy', close(c.t.admByAge.chi2, ref.chi2_admission_by_age_group.chi2) && close(c.t.admByAge.p, ref.chi2_admission_by_age_group.p));
  check('Spearman wait vs satisfaction matches SciPy', close(c.t.waitSatSpearman.r, ref.spearman_wait_satisfaction.rho, 1e-9) && close(c.t.waitSatSpearman.p, ref.spearman_wait_satisfaction.p, 1e-6) && c.t.waitSatSpearman.n === ref.spearman_wait_satisfaction.n);
  check('Pearson wait vs satisfaction matches SciPy', close(c.t.waitSatPearson.r, ref.pearson_wait_satisfaction.r, 1e-9) && close(c.t.waitSatPearson.p, ref.pearson_wait_satisfaction.p, 1e-6));
  const gmap = { gender: 'gender', race: 'race', age_group: 'age_group', admitted_label: 'admitted', referral: 'referral' };
  check('Kruskal-Wallis satisfaction tests (5 groupings) match SciPy', Object.entries(gmap).every(([js, p]) => kw(c.t.satBy[js], ref.kw_satisfaction[p])));
  if (fs.existsSync(RAW)) {
    const raw = fs.readFileSync(RAW, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1, 201).map((l) => l.split(',')[0]);
    const ok = await S((ids) => ids.map((id) => window.ErData.pseudonymise(id)), raw);
    check('browser pseudonymisation of 200 raw IDs equals the Python keys', ok.every((k, i) => k === deid[i]['Patient Id']), ok[0]);
  } else check('browser pseudonymisation test skipped: raw file not present', true, 'raw file is excluded from the repository');
  const kpiText = await page.textContent('#kpis');
  check('KPI cards show formatted values', kpiText.includes('9,216') && kpiText.includes('35.3 min') && kpiText.includes('59.3%') && kpiText.includes('4.99'), kpiText.slice(0, 120));
  await shot('dashboard-overview.png');

  // ------------------------------------------------------------ 2 charts render on every tab
  current = 'T02 charts render';
  const chartIds = { overview: ['cMonth', 'cWaitHistOv'], flow: ['cDaily', 'cWeekday', 'cHour', 'cHeat'], wait: ['cWaitHist', 'cWaitRef', 'cWaitHour', 'cWaitDay', 'cWaitMonth'],
    admit: ['cRefVol', 'cAdmRef', 'cAdmAge', 'cAdmMonth'], experience: ['cSatWait', 'cSatMix', 'cSatGroup', 'cSatDist'] };
  for (const [t, ids] of Object.entries(chartIds)) {
    await tab(t);
    for (const id of ids) { const n = await page.evaluate((i) => { const ch = window.echarts.getInstanceByDom(document.getElementById(i)); if (!ch) return 0; const o = ch.getOption(); return (o.series || []).filter((x) => (x.data || []).length).length; }, id);
      check(`${t}: ${id} has data`, n > 0, `${n} series with data`); }
    if (t !== 'overview') await shot(`dashboard-${t}.png`);
  }
  const testRows = await page.$$eval('#satTests tbody tr', (r) => r.length);
  check('satisfaction test table lists 6 groupings', testRows === 6, testRows);
  for (const g of ['gender', 'race', 'age_group', 'admitted_label']) { await page.selectOption('#satGroup', g); await page.waitForTimeout(200); }
  await tab('wait'); for (const m of ['median_wait', 'pct_over', 'avg_wait']) { await page.selectOption('#waitMeasure', m); await page.waitForTimeout(250); }
  await tab('overview'); for (const m of ['avg_wait', 'pct_over', 'adm_rate', 'avg_sat', 'resp_rate', 'visits_per_day']) { await page.selectOption('#monthMeasure', m); await page.waitForTimeout(150); }
  check('measure and grouping selectors switch without errors', errors.length === 0, errors.join('; '));

  // ------------------------------------------------------------ 3 filters and wait target
  current = 'T03 filters';
  await page.selectOption('#fFrom', '2024-04'); await page.waitForTimeout(400);
  s = await st(); check('month filter Apr 2024 to Oct 2024 keeps exactly the matching visits in the file', s.filtered === fromApr2024, `${s.filtered} vs ${fromApr2024}`);
  check('calendar days recomputed for the period (2024-04-01 to 2024-10-30 = 213)', s.k.days === 213, s.k.days);
  await page.click('#btnReset'); await page.waitForTimeout(400);
  await page.click('#fRefBox summary'); await page.click('#fRef [data-none]'); await page.waitForTimeout(200); await page.check('#fRef input[value="General Practice"]'); await page.waitForTimeout(400); await page.click('body', { position: { x: 5, y: 700 } });
  s = await st(); check('referral filter: General Practice only', s.filtered === nGP, `${s.filtered} vs ${nGP}`);
  let chips = await page.textContent('#activeFilters'); check('active filter chip shown', chips.includes('Referral: General Practice'), chips);
  await page.click('#activeFilters [data-chip="referrals"]'); await page.waitForTimeout(300);
  s = await st(); check('removing a chip removes that filter', s.filtered === ref.visits, s.filtered);
  await page.click('#fGenderBox summary'); await page.click('#fGender [data-none]'); await page.check('#fGender input[value="F"]'); await page.waitForTimeout(400); await page.click('body', { position: { x: 5, y: 700 } });
  await page.selectOption('#fAdm', '1'); await page.waitForTimeout(400);
  s = await st();
  const expFA = deid.filter((r) => r['Patient Gender'] === 'F' && r['Patient Admission Flag'] === 'TRUE').length;
  check('gender + admission filters combine (female and admitted)', s.filtered === expFA && s.k.adm_rate === 100, `${s.filtered} vs ${expFA}`);
  await tab('explorer'); const cnt = await page.textContent('#tCount'); check('data explorer reflects filters', cnt.includes(`(${expFA.toLocaleString('en-US')} after filters`), cnt);
  await page.click('#btnReset'); await page.waitForTimeout(400);
  await page.fill('#tSearch', 'Renal'); await page.waitForTimeout(500);
  const renalCount = await page.textContent('#tCount'); check('explorer search narrows rows (Renal = 86)', renalCount.startsWith('86 of'), renalCount);
  await page.fill('#tSearch', ''); await page.waitForTimeout(400);
  await page.click('#explorer th[data-k="wait_min"]'); await page.waitForTimeout(200);
  const wAsc = await page.$eval('#explorer tbody tr td:nth-child(6)', (td) => td.textContent);
  await page.click('#explorer th[data-k="wait_min"]'); await page.waitForTimeout(200);
  const wDesc = await page.$eval('#explorer tbody tr td:nth-child(6)', (td) => td.textContent);
  check('explorer sorting toggles ascending/descending', wAsc === '10' && wDesc === '60', `${wAsc} / ${wDesc}`);
  const pages = await page.$$eval('#pager button[data-p]', (b) => b.length); check('pagination controls rendered', pages >= 3, pages);
  await shot('dashboard-explorer.png', false);
  await page.selectOption('#fTarget', '45'); await page.waitForTimeout(500);
  s = await st(); check('wait target 45 min: share over target recalculated', close(s.k.pct_over, over45, 1e-9), `${s.k.pct_over} vs ${over45}`);
  chips = await page.textContent('#activeFilters'); check('non-default target shown as a chip', chips.includes('Wait target 45 min'));
  await page.click('#activeFilters [data-chip="target"]'); await page.waitForTimeout(400);
  s = await st(); check('removing target chip returns to 30 min', s.target === 30 && close(s.k.pct_over, ref.pct_over_target, 1e-9));
  await tab('admit');
  const vol = await page.evaluate(() => { const ch = window.echarts.getInstanceByDom(document.getElementById('cRefVol')); return ch.getOption().yAxis[0].data; });
  await page.evaluate((i) => { const ch = window.echarts.getInstanceByDom(document.getElementById('cRefVol')); ch.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: i }); }, vol.indexOf('Orthopedics'));
  const box = await page.$eval('#cRefVol', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const pos = await page.evaluate((i) => { const ch = window.echarts.getInstanceByDom(document.getElementById('cRefVol')); return ch.convertToPixel({ seriesIndex: 0 }, [100, i]); }, vol.indexOf('Orthopedics'));
  await page.mouse.click(box.x + pos[0], box.y + pos[1]); await page.waitForTimeout(500);
  s = await st(); check('clicking a department bar filters the dashboard to it (Orthopedics = 995)', s.filtered === 995, s.filtered);
  await page.click('#btnReset'); await page.waitForTimeout(400);

  // ------------------------------------------------------------ 4 invalid uploads
  current = 'T04 invalid files';
  await tab('data');
  await upload('02_missing_required_column.csv');
  let panel = await page.textContent('#uploadPanel');
  check('missing required column rejected with explanation', panel.includes('required columns missing') && panel.includes('Patient Waittime'), panel.slice(0, 160));
  await upload('10_wrong_type.txt'); panel = await page.textContent('#uploadPanel');
  check('wrong file type rejected', panel.includes('.txt file'), panel.slice(0, 120));
  const big = path.join(DL, 'too_big.csv'); fs.writeFileSync(big, 'Patient Id,x\n' + 'a,'.padEnd(1000, 'x').concat('\n').repeat(11000));
  await upload(big); panel = await page.textContent('#uploadPanel');
  check('file over 10 MB rejected', panel.includes('The limit is 10 MB'), panel.slice(0, 120));
  s = await st(); check('dataset unchanged after rejected files', s.n === ref.visits);

  // ------------------------------------------------------------ 5 valid append with duplicate and invalid rows
  current = 'T05 append upload';
  await upload('01_append_valid_with_duplicate_and_invalid.csv', 'append');
  let stats = await statText();
  check('preview: 12 rows, 11 valid, 1 invalid, 1 duplicate, 10 new', stats['rows in file'] === 12 && stats['passed validation'] === 11 && stats['invalid (rejected)'] === 1 && stats.duplicates === 1 && stats['new visits to add'] === 10, JSON.stringify(stats));
  panel = await page.textContent('#uploadPanel');
  check('rejection reasons listed (impossible date, bad flag, bad wait)', panel.includes('not a real calendar date') && panel.includes('not TRUE/FALSE') && panel.includes('not a number') && panel.includes('identical values'));
  check('name columns reported as dropped', panel.includes('"Patient First Inital", "Patient Last Name" dropped'));
  const vfile = await download(() => page.click('#btnValidation'));
  const vtxt = fs.readFileSync(vfile, 'utf8'); check('validation results downloadable', vtxt.includes('rejected') && vtxt.includes('duplicate'), path.basename(vfile));
  await page.click('#btnApply'); await page.waitForTimeout(1200);
  const okMsg = await page.textContent('#uploadPanel');
  check('confirmation sentence uses actual counts', okMsg.includes('12 records were processed, 10 were accepted (10 added), 1 duplicate was detected and 1 record was rejected'), okMsg.slice(0, 200));
  s = await st(); check('dataset grows to 9,226 visits', s.n === 9226, s.n);
  const priv = await S(() => { const r = window.ErApp.state.records; const keys = new Set(r.flatMap((x) => Object.keys(x)));
    return { keys: [...keys].sort().join(','), allPseudo: r.every((x) => /^P[0-9a-f]{12}$/.test(x.visit_key)), names: JSON.stringify(r).includes('Testperson'), testIds: JSON.stringify(r).includes('TEST-0001') }; });
  check('stored records hold no names and no original IDs', !priv.names && !priv.testIds && priv.allPseudo && !priv.keys.includes('name'), priv.keys);
  const nov = await S(() => window.ErApp.state.all.filter((r) => r.month === '2024-11').map((r) => r.arrival).sort()[0]);
  check('day-first dates parsed correctly (14-11-2024 07:11 -> 2024-11-14 07:11)', nov === '2024-11-14 07:11', nov);
  const months = await page.$$eval('#fTo option', (o) => o.map((x) => x.value)); check('month filter gains Nov 2024', months.includes('2024-11'));
  await tab('overview'); const st2 = await page.textContent('#datasetStatus'); check('header shows working dataset status', st2.includes('Working dataset: 9,226'), st2);
  await tab('data'); await shot('dashboard-data-upload.png');

  // ------------------------------------------------------------ 6 persistence
  current = 'T06 local persistence';
  await page.reload(); await page.waitForFunction(() => window.ErApp && window.ErApp.state.ctx);
  s = await st(); check('after reload the working dataset (9,226 visits, 1 upload) is restored from IndexedDB', s.n === 9226 && s.batches === 1, `${s.n}, ${s.batches}`);

  // ------------------------------------------------------------ 7 duplicates
  current = 'T07 duplicate handling';
  await tab('data');
  await upload('01_append_valid_with_duplicate_and_invalid.csv', 'append'); stats = await statText();
  check('re-uploading the same file adds nothing and reports 11 duplicates', stats['new visits to add'] === 0 && stats.duplicates === 11, JSON.stringify(stats));
  check('apply button disabled when nothing to add', await page.$eval('#btnApply', (b) => b.disabled));
  await page.click('#btnCancel');
  await upload('05_duplicate_rows_in_file.csv', 'append'); stats = await statText();
  check('duplicate rows inside one file detected', stats.duplicates === 1 && stats['new visits to add'] === 2, JSON.stringify(stats));
  await page.click('#btnCancel');

  // ------------------------------------------------------------ 8 merge
  current = 'T08 update or add (merge)';
  await upload('03_merge_update_and_insert.csv', 'append'); stats = await statText();
  check('append mode flags the changed existing visit as a conflict', stats['existing visits with different values'] === 1 && stats['new visits to add'] === 1, JSON.stringify(stats));
  await page.click('input[name="mode"][value="merge"]'); await page.waitForTimeout(400);
  stats = await statText(); check('merge mode: 1 update, 1 insert', stats['visits to update'] === 1 && stats['new visits to add'] === 1, JSON.stringify(stats));
  const updKey = fs.readFileSync(DATA('03_merge_update_and_insert.csv'), 'utf8').split('\n')[1].split(',')[0];
  const before = await S((k) => window.ErApp.state.ctx.k.n_resp, updKey);
  await page.click('#btnApply'); await page.waitForTimeout(1000);
  const v = await S((k) => window.ErApp.state.all.find((r) => r.visit_key === k), updKey);
  const after = await S(() => window.ErApp.state.ctx.k.n_resp);
  check('late satisfaction score merged into the existing visit and response count recalculated', v.satisfaction === 9 && v.responded === 1 && after === before + 1, `${v.satisfaction}, responses ${before} -> ${after}`);
  s = await st(); check('dataset now 9,227 visits', s.n === 9227, s.n);

  // ------------------------------------------------------------ 9 other formats and column mapping
  current = 'T09 JSON, XLSX and alternative headers';
  await upload('08_valid.json'); stats = await statText(); check('JSON: 4 visits accepted', stats['new visits to add'] === 4, JSON.stringify(stats)); await page.click('#btnApply'); await page.waitForTimeout(900);
  await upload('09_valid.xlsx'); stats = await statText(); check('XLSX: 5 visits accepted', stats['new visits to add'] === 5, JSON.stringify(stats)); await page.click('#btnApply'); await page.waitForTimeout(900);
  const xl1 = await S(() => window.ErApp.state.all.filter((r) => r.month === '2024-12' && r.year === 2024 && r.arrival.startsWith('2024-12-20')).map((r) => `${r.arrival}|${r.admitted}`));
  check('Excel date-time and boolean cells read correctly', xl1.includes('2024-12-20 09:30|0'), xl1.join(';'));
  await upload('04_alias_headers.csv'); panel = await page.textContent('#uploadPanel');
  check('alternative names mapped and reported', panel.includes('"Visit ID" → Patient Id') && panel.includes('"Wait Time" → Patient Waittime') && panel.includes('recognised alternative name'));
  await page.click('#btnApply'); await page.waitForTimeout(900);
  const al = await S(() => window.ErApp.state.all.filter((r) => r.arrival.startsWith('2024-11-02')).map((r) => `${r.arrival}|${r.gender}|${r.admitted}|${r.referral}`).sort());
  check('ISO dates, Female/Male and Yes/No normalised', al.includes('2024-11-02 08:15|F|1|Neurology') && al.includes('2024-11-02 09:40|M|0|None'), al.join(';'));
  s = await st(); check('dataset now 9,239 visits', s.n === 9239, s.n);

  // ------------------------------------------------------------ 10 security
  current = 'T10 security';
  await upload('07_security_formula_and_html.csv'); await page.click('#btnApply'); await page.waitForTimeout(900);
  await tab('experience'); await page.selectOption('#satGroup', 'race'); await page.waitForTimeout(300);
  await tab('explorer'); await page.fill('#tSearch', 'img'); await page.waitForTimeout(500);
  const imgs = await page.$$eval('#main img', (i) => i.length);
  const shown = await page.textContent('#explorer tbody');
  check('HTML in uploaded text is shown as text, not executed', imgs === 0 && alerts === 0 && shown.includes('<img src=x'), `img elements ${imgs}, alerts ${alerts}`);
  await page.fill('#tSearch', ''); await page.waitForTimeout(300);
  const csvFile = await download(async () => { await page.click('#btnData'); await page.click('#dlgData button[value="ok"]'); });
  const csvTxt = fs.readFileSync(csvFile, 'utf8');
  check('exported CSV neutralises formula text', csvTxt.includes("'=HYPERLINK") && !/,=HYPERLINK/.test(csvTxt) && !/,"=HYPERLINK/.test(csvTxt));

  // ------------------------------------------------------------ 11 data export
  current = 'T11 data export';
  const exp = readCsv(csvFile);
  s = await st();
  check('full CSV export has every analysed visit', exp.length === s.n, `${exp.length} rows vs ${s.n}`);
  check('export has no names or original IDs', !csvTxt.includes('Testperson') && !csvTxt.includes('TEST-0001') && !/\d{3}-\d{2}-\d{4}/.test(csvTxt));
  check('export includes uploaded visits and the source column', csvTxt.includes('upload ') && csvTxt.includes('base dataset'));
  const byKey = new Map(exp.map((r) => [`${r.visit_key}|${r.arrival}`, r]));
  const cols = ['date', 'month', 'weekday', 'hour', 'gender', 'age', 'age_group', 'race', 'referral', 'referred', 'admitted', 'wait_min', 'wait_band', 'satisfaction', 'responded', 'cm_flag'];
  const mergedKey = `${updKey}|`;
  let mism = []; pyRows.forEach((p) => { const e = byKey.get(`${p.visit_key}|${p.arrival}`); if (!e) { mism.push(`${p.visit_key} missing`); return; }
    cols.forEach((k) => { if (['satisfaction', 'responded'].includes(k) && `${p.visit_key}|`.startsWith(mergedKey)) return; const a = e[k], b = p[k]; if (!(a === b || (a !== '' && b !== '' && +a === +b))) mism.push(`${p.visit_key}.${k}: ${a} vs ${b}`); });
    if (+e.over_target !== +p.over_target_30) mism.push(`${p.visit_key}.over_target`); });
  check('all 9,216 base visits in the export match the pandas analysis file (17 fields each)', !mism.length, mism.slice(0, 4).join('; '));
  await page.selectOption('#fFrom', '2024-06'); await page.waitForTimeout(400);
  s = await st();
  const fCsv = await download(async () => { await page.click('#btnData'); await page.check('input[name="dscope"][value="filtered"]'); await page.click('#dlgData button[value="ok"]'); });
  const fl = readCsv(fCsv).length;
  check('filtered CSV export matches filtered view', fl === s.filtered && path.basename(fCsv).includes('filtered'), `${fl} vs ${s.filtered}; ${path.basename(fCsv)}`);
  const xFile = await download(async () => { await page.click('#btnData'); await page.check('input[name="dscope"][value="full"]'); await page.check('input[name="dfmt"][value="xlsx"]'); await page.click('#dlgData button[value="ok"]'); });
  const xl = execSync(`python3 -c "import openpyxl,sys; wb=openpyxl.load_workbook(sys.argv[1]); print(wb.sheetnames, wb['Visits'].max_row-1, wb['By month'].max_row-1)" "${xFile}"`).toString().trim();
  s = await st();
  check('XLSX export opens with visits, 4 summary sheets and About', xl.includes("'Visits', 'By month', 'By weekday', 'By hour', 'By referral', 'About'") && xl.includes(` ${s.n} `), xl);
  const sumF = await download(async () => { await tab('data'); await page.click('#btnSummaryCsv'); });
  check('department summary CSV downloads', readCsv(sumF).length >= 8, path.basename(sumF));

  // ------------------------------------------------------------ 12 PDF report
  current = 'T12 PDF report';
  const pdfF = await download(async () => { await page.click('#btnReport'); await page.click('#dlgReportGo'); });
  const pdfTxt = execSync(`pdftotext -layout "${pdfF}" -`).toString();
  const pagesN = +execSync(`pdfinfo "${pdfF}" | grep Pages | awk '{print $2}'`).toString().trim();
  check('filtered report downloads as a valid PDF', pagesN >= 8, `${pagesN} pages, ${path.basename(pdfF)}`);
  check('report states scope and filters', pdfTxt.includes('Current filtered view') && pdfTxt.includes('months Jun 2024 to'), '');
  ['1. Business context', '2. Purpose and objectives', '3. Dataset overview', '4. Data preparation and privacy', '5. Analytical methods', '6. KPI definitions', '7. Results by objective',
    '8. Key findings', '9. Areas requiring management attention', '11. Recommendations', '12. Limitations'].forEach((h) => check(`report has section "${h}"`, pdfTxt.includes(h)));
  check('report reflects uploaded data (upload history)', pdfTxt.includes('Data added during use') && pdfTxt.includes('01_append_valid_with_duplicate'), '');
  await page.click('#btnReset'); await page.waitForTimeout(400);
  const pdfFull = await download(async () => { await page.click('#btnReport'); await page.check('input[name="rscope"][value="full"]'); await page.click('#dlgReportGo'); });
  const fullTxt = execSync(`pdftotext -layout "${pdfFull}" -`).toString();
  s = await st();
  check('full-dataset report covers every visit', fullTxt.includes('Entire available dataset') && fullTxt.includes(`${s.n.toLocaleString('en-US')} visits`), `${s.n} visits`);
  check('report has 8 embedded chart images', +execSync(`pdfimages -list "${pdfFull}" | tail -n +3 | wc -l`).toString().trim() >= 8);
  check('report text is plain ASCII (no broken glyphs)', !/[^\x00-\x7F]/.test(fullTxt.replace(/\f/g, '')), '');

  // ------------------------------------------------------------ 13 undo, replace and reset
  current = 'T13 undo and reset';
  await tab('data');
  await page.click('#btnUndo'); await page.click('#dlgConfirmGo'); await page.waitForTimeout(900);
  s = await st(); check('undo removes the last upload (security file)', s.n === 9239 && s.batches === 5, `${s.n}, ${s.batches}`);
  await upload('06_replace_sixty_visits.csv', 'replace'); await page.click('#btnApply'); await page.waitForTimeout(300);
  check('replace asks for confirmation', await page.isVisible('#dlgConfirm'));
  await page.click('#dlgConfirmGo'); await page.waitForTimeout(900);
  s = await st(); check('replace leaves only the 60 visits in the file', s.n === 60 && s.k.days === 46, `${s.n} visits, ${s.k.days} days`);
  await page.click('#btnUndo'); await page.click('#dlgConfirmGo'); await page.waitForTimeout(900);
  s = await st(); check('undoing a replace restores the previous dataset', s.n === 9239, s.n);
  await page.click('#btnClear'); await page.click('#dlgConfirmGo'); await page.waitForTimeout(1000);
  s = await st(); check('reset returns to the original 9,216 visits', s.n === 9216 && s.batches === 0);
  await page.reload(); await page.waitForFunction(() => window.ErApp && window.ErApp.state.ctx);
  s = await st(); check('after reset and reload, local data is gone', s.n === 9216 && s.batches === 0);
  const pdfBase = await download(async () => { await page.click('#btnReport'); await page.check('input[name="rscope"][value="full"]'); await page.click('#dlgReportGo'); });
  fs.copyFileSync(pdfBase, path.join(ROOT, 'tests', 'sample_generated_report.pdf'));

  // ------------------------------------------------------------ 14 dark mode, keyboard, responsive
  current = 'T14 layout and accessibility';
  await page.click('#btnTheme'); await page.waitForTimeout(700);
  check('dark mode applied', (await S(() => getComputedStyle(document.documentElement).colorScheme)) === 'dark');
  await shot('dashboard-dark-mode.png', false);
  await page.click('#btnTheme'); await page.waitForTimeout(300);
  await page.focus('[data-tab="overview"]'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
  check('arrow keys move between tabs', await S(() => window.ErApp.state.view.tab) === 'flow');
  const labelled = await page.$$eval('.chart[role="img"]', (e) => e.filter((x) => !x.closest('[hidden]')).every((x) => (x.getAttribute('aria-label') || '').length > 10));
  check('visible charts have text alternatives (aria-label)', labelled);
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mob.newPage(); await mp.goto(URL); await mp.waitForFunction(() => window.ErApp && window.ErApp.state.ctx); await mp.waitForTimeout(900);
  for (const t of ['overview', 'flow', 'wait', 'experience', 'data']) {
    await mp.click(`[data-tab="${t}"]`); await mp.waitForTimeout(600);
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`mobile 390px: no horizontal page scroll on ${t}`, over <= 0, `overflow ${over}px`);
  }
  await mp.click('[data-tab="overview"]'); await mp.waitForTimeout(500); await mp.screenshot({ path: IMG('dashboard-mobile.png') });
  await mob.close();
  const tabCtx = await browser.newContext({ viewport: { width: 820, height: 1180 } }); const tp = await tabCtx.newPage(); await tp.goto(URL); await tp.waitForFunction(() => window.ErApp && window.ErApp.state.ctx);
  check('tablet 820px: no horizontal page scroll', (await tp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0); await tabCtx.close();

  // ------------------------------------------------------------ 15 deployment paths and file:// use
  current = 'T15 deployment';
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
  check('all asset references are relative', refs.every((u) => !/^(\/|https?:)/.test(u)), refs.filter((u) => /^(\/|https?:)/.test(u)).join(', '));
  check('every referenced file exists', refs.every((u) => fs.existsSync(path.join(ROOT, u))), refs.filter((u) => !fs.existsSync(path.join(ROOT, u))).join(', '));
  const fctx = await browser.newContext(); const fp = await fctx.newPage(); const ferr = []; fp.on('pageerror', (e) => ferr.push(e.message));
  const net = []; fp.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) net.push(r.url()); });
  await fp.goto('file://' + path.join(ROOT, 'index.html')); await fp.waitForFunction(() => window.ErApp && window.ErApp.state.ctx, null, { timeout: 20000 }).catch(() => {});
  const fn = await fp.evaluate(() => (window.ErApp && window.ErApp.state.all.length) || 0);
  check('dashboard also works opened directly from disk (file://)', fn === 9216 && !ferr.length, `${fn} visits; ${ferr.join('; ')}`);
  check('no network requests to external hosts', net.length === 0, net.join(', ')); await fctx.close();
  const deidHead = fs.readFileSync(path.join(ROOT, 'data/base-data.js'), 'utf8');
  check('embedded base data has no name columns and no SSN-style IDs', !deidHead.includes('Last Name') && !/\d{3}-\d{2}-\d{4}/.test(deidHead));

  current = 'T16 console';
  check('no JavaScript errors during the whole run', errors.length === 0, errors.join(' | '));
  await browser.close();
  const pass = results.filter((r) => r.pass).length;
  fs.writeFileSync(path.join(ROOT, 'tests', 'results.json'), JSON.stringify({ run: new Date().toISOString(), browser: 'Chromium (Playwright)', passed: pass, failed: results.length - pass, results }, null, 1));
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
