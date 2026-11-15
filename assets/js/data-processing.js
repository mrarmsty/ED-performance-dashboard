/* data-processing.js - reading files, mapping columns, de-identifying, validating rows, applying upload batches and
   deriving analysis fields. The base dataset and every upload go through exactly the same functions. */
(function () {
  'use strict';
  const { FIELDS, DROP_ALIASES, AGE_BANDS, WAIT_BANDS, DAYS, GENDER_LABEL, RULES } = window.ErConfig;
  const U = window.ErUtils;
  const { isNum } = U;
  const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
  // stored record fields (patient_id is stored only as its pseudonymous key)
  const INPUT_KEYS = ['visit_key', 'arrival', 'gender', 'age', 'race', 'referral', 'admitted', 'satisfaction', 'wait_min', 'cm_flag'];
  const storedKey = (fieldKey) => (fieldKey === 'patient_id' ? 'visit_key' : fieldKey);
  const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Business key: pseudonymous visit key + arrival date-time. A patient cannot arrive twice in the same minute, and
  // repeat visits of the same patient (same ID, different time) stay separate records.
  const keyOf = (r) => `${r.visit_key}|${r.arrival}`;
  const PSEUDO = /^P[0-9a-f]{12}$/;
  const pseudonymise = (id) => { const s = String(id).trim(); return PSEUDO.test(s) ? s : 'P' + U.sha256Hex(s).slice(0, 12); };

  // ---------------------------------------------------------------- reading files
  async function readFile(file) {
    const name = file.name || 'upload';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!['csv', 'xlsx', 'json'].includes(ext)) throw new UserError(`"${name}" is a .${ext} file. Please upload a CSV, Excel (.xlsx) or JSON file.`);
    if (file.size > RULES.maxFileBytes) throw new UserError(`The file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${RULES.maxFileBytes / 1048576} MB.`);
    if (file.size === 0) throw new UserError('The file is empty.');
    if (ext === 'csv') return readCsvText(await file.text());
    if (ext === 'json') return readJson(await file.text());
    return readXlsx(await file.arrayBuffer());
  }
  function readCsvText(text) {
    const res = window.Papa.parse(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', dynamicTyping: false, transformHeader: (h) => h });
    const fatal = res.errors.filter((e) => e.type === 'Delimiter' || e.type === 'Quotes');
    if (fatal.length && !res.data.length) throw new UserError(`The CSV could not be read: ${fatal[0].message}.`);
    return { headers: res.meta.fields || [], rows: res.data, parseWarnings: res.errors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`) };
  }
  function readJson(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new UserError('The JSON file is not valid JSON.'); }
    const arr = Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : Array.isArray(data?.data) ? data.data : null;
    if (!arr) throw new UserError('The JSON must be an array of records, or an object with a "records" array.');
    if (arr.some((r) => r === null || typeof r !== 'object' || Array.isArray(r))) throw new UserError('Every JSON record must be an object of field: value pairs.');
    const headers = [...new Set(arr.flatMap((r) => Object.keys(r)))];
    return { headers, rows: arr, parseWarnings: [] };
  }
  async function readXlsx(buffer) {
    const wb = new window.ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch (e) { throw new UserError('The Excel file could not be opened. Save it as .xlsx and try again.'); }
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) throw new UserError('The first worksheet has no data rows.');
    const cellValue = (v) => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v;                       // kept as a Date; parsed by parseDateTime
      if (typeof v === 'object') {
        if ('result' in v) return cellValue(v.result);          // formula cell
        if ('richText' in v) return v.richText.map((t) => t.text).join('');
        if ('text' in v) return v.text;
        if ('error' in v) return '';
      }
      return v;
    };
    const headers = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = String(cellValue(c.value)); });
    const rows = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r); if (!row.hasValues) continue;
      const o = {}; headers.forEach((h, i) => { o[h] = cellValue(row.getCell(i + 1).value); }); rows.push(o);
    }
    return { headers, rows, parseWarnings: [] };
  }

  // ---------------------------------------------------------------- column mapping
  function mapColumns(headers) {
    const mapping = {}, notes = [], unknown = [], clashes = [], dropped = [];
    const used = {};
    headers.forEach((h) => {
      const n = norm(h); if (!n) return;
      if (DROP_ALIASES.includes(n)) { dropped.push(h); return; }
      const f = FIELDS.find((x) => x.aliases.includes(n));
      if (!f) { unknown.push(h); return; }
      if (used[f.key]) { clashes.push(`"${h}" and "${used[f.key]}" both map to ${f.label}; "${h}" was ignored`); return; }
      used[f.key] = h; mapping[h] = f.key;
      notes.push({ header: h, field: f.label, method: n === f.aliases[0] ? 'standard name' : 'recognised alternative name' });
    });
    const missingRequired = FIELDS.filter((f) => f.required && !used[f.key]).map((f) => f.label);
    const missingOptional = FIELDS.filter((f) => !f.required && !used[f.key]).map((f) => f.label);
    return { mapping, notes, unknown, clashes, dropped, missingRequired, missingOptional, present: Object.keys(used).map(storedKey) };
  }

  // ---------------------------------------------------------------- value parsing
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && /^\s*$/.test(v));
  function parseNumber(v) {
    if (blank(v)) return { value: null, ok: true };
    if (typeof v === 'number') return Number.isFinite(v) ? { value: v, ok: true } : { value: null, ok: false };
    const s = String(v).trim().replace(/,/g, '');
    if (/^(na|n\/a|nan|null|-|--)$/i.test(s)) return { value: null, ok: true };
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return { value: null, ok: false };
    return { value: Number(s), ok: true };
  }
  const pad = (x) => String(x).padStart(2, '0');
  function validDate(y, mo, d, h, mi) {
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;     // e.g. 31-02-2024
    return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}`;
  }
  // Returns { value: 'YYYY-MM-DD HH:MM' } or { error }. Text dates without a 4-digit leading year are read DAY FIRST
  // (dd-mm-yyyy), as in the source file.
  function parseDateTime(v) {
    if (blank(v)) return { error: 'is missing' };
    if (v instanceof Date) {
      if (Number.isNaN(v.getTime())) return { error: 'is not a valid date' };
      const out = validDate(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes());
      return out ? { value: out } : { error: 'is outside 2000-2100' };
    }
    if (typeof v === 'number') {                                              // Excel serial date
      if (v < 36526 || v > 73051) return { error: 'is not a date' };
      return parseDateTime(new Date(Math.round((v - 25569) * 86400000 / 60000) * 60000));
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z)?$/);
    let out = null;
    if (m) out = validDate(+m[1], +m[2], +m[3], +m[4], +m[5]);
    else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/))) out = validDate(+m[3], +m[2], +m[1], +m[4], +m[5]);
    else if (/^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(s)) return { error: 'has no time (HH:MM is needed for hour-of-day analysis)' };
    else return { error: 'is not in a recognised format (dd-mm-yyyy HH:MM or yyyy-mm-dd HH:MM)' };
    return out ? { value: out } : { error: 'is not a real calendar date and time between 2000 and 2100' };
  }
  function parseBool(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v === 1 ? 1 : v === 0 ? 0 : null;
    const s = String(v ?? '').trim().toLowerCase();
    if (['true', 't', 'yes', 'y', '1', 'admitted'].includes(s)) return 1;
    if (['false', 'f', 'no', 'n', '0', 'not admitted'].includes(s)) return 0;
    return null;
  }
  function parseGender(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return { value: null };
    if (['m', 'male', 'man'].includes(s)) return { value: 'M' };
    if (['f', 'female', 'woman'].includes(s)) return { value: 'F' };
    if (['nc', 'not specified', 'unknown', 'u', 'not stated'].includes(s)) return { value: 'NC' };
    return { value: 'NC', warn: `"${String(v).trim()}" is not a recognised gender code; stored as NC (not specified)` };
  }
  const cleanText = (v) => (blank(v) ? null : String(v).trim().replace(/\s+/g, ' ').slice(0, 80));

  // ---------------------------------------------------------------- row validation
  function validateRows(rows, colMap) {
    const accepted = [], rejected = [], warnings = [];
    const seen = new Map();
    if (rows.length > RULES.maxRows) throw new UserError(`The file has ${rows.length.toLocaleString()} rows. The limit is ${RULES.maxRows.toLocaleString()}.`);
    const colOf = (key) => Object.keys(colMap.mapping).find((h) => colMap.mapping[h] === key);
    const cols = Object.fromEntries(FIELDS.map((f) => [f.key, colOf(f.key)]));
    rows.forEach((raw, i) => {
      const rowNo = i + 2;                                   // spreadsheet row number (header is row 1)
      const rec = {}; const reasons = [];
      const get = (k) => (cols[k] === undefined ? undefined : raw[cols[k]]);
      // identifier -> pseudonymous key (the raw ID is not kept anywhere)
      const id = get('patient_id');
      if (blank(id)) reasons.push('Patient Id is missing');
      else rec.visit_key = pseudonymise(id);
      // arrival
      const dt = parseDateTime(get('arrival'));
      if (dt.error) reasons.push(`Admission date "${blank(get('arrival')) ? '' : String(get('arrival')).slice(0, 30)}" ${dt.error}`); else rec.arrival = dt.value;
      // wait time
      const w = parseNumber(get('wait_min'));
      if (!w.ok || w.value === null) reasons.push(`Wait time "${String(get('wait_min') ?? '').slice(0, 20)}" is ${w.ok ? 'missing' : 'not a number'}`);
      else if (w.value < 0 || w.value > 1440) reasons.push(`Wait time ${w.value} is outside 0-1440 minutes`);
      else rec.wait_min = w.value;
      // admission flag
      const a = parseBool(get('admitted'));
      if (a === null) reasons.push(`Admission flag "${String(get('admitted') ?? '').slice(0, 20)}" is not TRUE/FALSE`); else rec.admitted = a;
      // optional fields
      if (cols.gender !== undefined) { const g = parseGender(get('gender')); rec.gender = g.value; if (g.warn) warnings.push({ row: rowNo, field: 'Gender', message: g.warn }); }
      if (cols.age !== undefined) {
        const p = parseNumber(get('age'));
        if (!p.ok || (p.value !== null && (!Number.isInteger(p.value) || p.value < 0 || p.value > 120))) { rec.age = null; warnings.push({ row: rowNo, field: 'Age', message: `"${get('age')}" is not a whole number between 0 and 120; stored as missing` }); }
        else rec.age = p.value;
      }
      if (cols.race !== undefined) rec.race = cleanText(get('race'));
      if (cols.referral !== undefined) rec.referral = cleanText(get('referral'));
      if (cols.satisfaction !== undefined) {
        const p = parseNumber(get('satisfaction'));
        if (!p.ok || (p.value !== null && (p.value < 0 || p.value > 10))) { rec.satisfaction = null; warnings.push({ row: rowNo, field: 'Satisfaction', message: `"${get('satisfaction')}" is not a score between 0 and 10; stored as no response` }); }
        else rec.satisfaction = p.value;
      }
      if (cols.cm_flag !== undefined) {
        const raw2 = get('cm_flag'); const c = blank(raw2) ? null : parseBool(raw2);
        if (!blank(raw2) && c === null) warnings.push({ row: rowNo, field: 'Patients CM', message: `"${raw2}" is not 0/1; stored as missing` });
        rec.cm_flag = c;
      }
      INPUT_KEYS.forEach((k) => { if (!(k in rec)) rec[k] = null; });
      const label = `${rec.visit_key || '?'} ${rec.arrival || '?'}`;
      if (reasons.length) { rejected.push({ row: rowNo, key: label, reason: reasons.join('; '), type: 'invalid' }); return; }
      const k = keyOf(rec);
      if (seen.has(k)) { rejected.push({ row: rowNo, key: label, reason: `Duplicate of row ${seen.get(k)} in the same file (same patient and arrival time)`, type: 'duplicate_in_file' }); return; }
      seen.set(k, rowNo);
      rec._row = rowNo;
      accepted.push(rec);
    });
    return { accepted, rejected, warnings };
  }

  // ---------------------------------------------------------------- applying a batch
  const sameValues = (a, b, keys) => keys.every((k) => (a[k] ?? null) === (b[k] ?? null) || (isNum(a[k]) && isNum(b[k]) && Math.abs(a[k] - b[k]) < 1e-9));
  function stripInternal(r) { const o = {}; INPUT_KEYS.forEach((k) => { o[k] = r[k] ?? null; }); return o; }

  // current: stored records; accepted: validated records; present: stored keys present in the file.
  function applyBatch(current, accepted, mode, present, batchId) {
    const s = { inserted: 0, updated: 0, unchanged: 0, duplicatesExisting: 0, conflicts: 0, removed: 0 };
    const skipped = [];
    if (mode === 'replace') {
      s.removed = current.length;
      const next = accepted.map((r) => ({ ...stripInternal(r), _batch: batchId }));
      s.inserted = next.length;
      return { next, summary: s, skipped };
    }
    const byKey = new Map(current.map((r, i) => [keyOf(r), i]));
    const next = current.slice();
    const compareKeys = present.filter((k) => INPUT_KEYS.includes(k));
    for (const rec of accepted) {
      const k = keyOf(rec); const i = byKey.get(k); const clean = stripInternal(rec);
      if (i === undefined) { byKey.set(k, next.length); next.push({ ...clean, _batch: batchId }); s.inserted++; continue; }
      const old = next[i]; const label = `${rec.visit_key} ${rec.arrival}`;
      if (mode === 'append') {
        if (sameValues(old, clean, compareKeys)) { s.duplicatesExisting++; skipped.push({ row: rec._row, key: label, reason: 'Already in the dataset with identical values (not added again)', type: 'duplicate_existing' }); }
        else { s.conflicts++; skipped.push({ row: rec._row, key: label, reason: 'This visit (same patient and arrival time) already exists with different values. Use "Update or add" to overwrite it', type: 'conflict' }); }
        continue;
      }
      // merge: overwrite the columns present in the file; blank cells keep the existing value
      const merged = { ...old };
      compareKeys.forEach((c) => { if (clean[c] !== null && clean[c] !== undefined) merged[c] = clean[c]; });
      if (sameValues(old, merged, INPUT_KEYS)) { s.unchanged++; continue; }
      merged._batch = batchId; next[i] = merged; s.updated++;
    }
    return { next, summary: s, skipped };
  }

  // ---------------------------------------------------------------- derived analysis fields
  const band = (v, bands) => { if (!isNum(v)) return null; const b = bands.find(([lo, hi]) => v >= lo && v <= hi); return b ? b[2] : null; };
  function derive(records, target) {
    const rows = records.map((r) => {
      const o = { ...r };
      const y = +r.arrival.slice(0, 4), mo = +r.arrival.slice(5, 7), d = +r.arrival.slice(8, 10);
      o.date = r.arrival.slice(0, 10); o.month = r.arrival.slice(0, 7); o.year = y;
      const wd = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;           // Monday = 0
      o.weekday = DAYS[wd]; o.weekday_num = wd + 1; o.hour = +r.arrival.slice(11, 13);
      o.gender = r.gender || 'NC'; o.gender_label = GENDER_LABEL[o.gender];
      o.race = r.race || 'Not recorded';
      o.referral = r.referral && r.referral.toLowerCase() !== 'none' ? r.referral : 'None';
      o.referred = o.referral === 'None' ? 0 : 1;
      o.admitted_label = r.admitted ? 'Admitted' : 'Not admitted';
      o.age_group = band(r.age, AGE_BANDS) || 'Not recorded';
      o.wait_band = band(r.wait_min, WAIT_BANDS);
      o.over_target = r.wait_min > target ? 1 : 0;
      o.responded = isNum(r.satisfaction) ? 1 : 0;
      o.sat_group = !o.responded ? null : r.satisfaction < 5 ? 'Low (0-4)' : r.satisfaction < RULES.satisfiedMin ? 'Medium (5-7)' : 'High (8-10)';
      o.satisfied = o.responded ? (r.satisfaction >= RULES.satisfiedMin ? 1 : 0) : null;
      return o;
    });
    rows.sort((a, b) => (a.arrival < b.arrival ? -1 : a.arrival > b.arrival ? 1 : a.visit_key < b.visit_key ? -1 : 1));
    return rows;
  }

  class UserError extends Error {}

  window.ErData = { readFile, readCsvText, mapColumns, validateRows, applyBatch, derive, parseNumber, parseDateTime, pseudonymise, keyOf, INPUT_KEYS, FIELD_BY_KEY, UserError };
})();
