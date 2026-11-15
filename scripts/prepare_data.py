"""Reference data pipeline for the Emergency Department dashboard.

1. De-identifies the raw file: patient names are dropped and the patient ID is replaced by a pseudonymous key
   (SHA-256 of the ID, first 12 hex characters, prefixed "P"). The dashboard applies the identical rule in the
   browser (assets/js/data-processing.js), so uploads of raw-format files match these keys.
2. Cleans and derives the analysis fields with the same rules as the dashboard.
3. Writes the processed datasets and the reference values that the automated tests compare the dashboard against.

Run from the repository root:  python scripts/prepare_data.py
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "Hospital_ER_Data.csv"
OUT = ROOT / "data" / "processed"
TARGET = 30                       # default waiting-time target in minutes (configurable in the dashboard)
AGE_BANDS = [(0, 4, "0-4"), (5, 12, "5-12"), (13, 17, "13-17"), (18, 29, "18-29"), (30, 44, "30-44"), (45, 64, "45-64"), (65, 200, "65+")]
WAIT_BANDS = [(0, 15, "0-15"), (16, 30, "16-30"), (31, 45, "31-45"), (46, 60, "46-60"), (61, 10 ** 6, "61+")]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def pseudo(pid: str) -> str:
    return "P" + hashlib.sha256(pid.strip().encode("utf-8")).hexdigest()[:12]


def band(v, bands):
    for lo, hi, lab in bands:
        if lo <= v <= hi:
            return lab
    return None


def load():
    raw = pd.read_csv(RAW, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    log = [("C1", "Patient First Inital, Patient Last Name", "Dropped: personal names are not needed for any analysis (data minimisation)", len(raw)),
           ("C2", "Patient Id", "Replaced by a pseudonymous key P + first 12 hex of SHA-256(ID); the original ID is not kept", len(raw))]
    d = pd.DataFrame({
        "visit_key": raw["Patient Id"].map(pseudo),
        "arrival": pd.to_datetime(raw["Patient Admission Date"], format="%d-%m-%Y %H:%M"),
        "gender": raw["Patient Gender"].str.strip(),
        "age": raw["Patient Age"].astype(int),
        "race": raw["Patient Race"].str.strip(),
        "referral": raw["Department Referral"].str.strip().replace({"": "None"}),
        "admitted": raw["Patient Admission Flag"].str.upper().map({"TRUE": 1, "FALSE": 0}),
        "satisfaction": pd.to_numeric(raw["Patient Satisfaction Score"], errors="coerce"),
        "wait_min": raw["Patient Waittime"].astype(int),
        "cm_flag": raw["Patients CM"].astype(int),
    })
    log.append(("C3", "Patient Admission Date", "Parsed from day-first text (dd-mm-yyyy HH:MM) to a date-time; all 9,216 parsed", len(d)))
    log.append(("C4", "Department Referral", "'None' kept as a category meaning no referral to a specialty department", int((d.referral == "None").sum())))
    log.append(("C5", "Patient Satisfaction Score", "Blank = no survey response; kept missing (not imputed); satisfaction metrics use respondents only", int(d.satisfaction.isna().sum())))
    log.append(("C6", "Patient Gender", "'NC' kept as its own category (meaning not documented; shown as 'NC - not specified')", int((d.gender == "NC").sum())))
    log.append(("C7", "Patient Admission Flag", "TRUE/FALSE text converted to 1/0", len(d)))
    assert d.visit_key.is_unique
    # the de-identified upload-format file: same columns as the raw file, minus names, with the pseudonymous key
    deid = raw.drop(columns=["Patient First Inital", "Patient Last Name"]).copy()
    deid["Patient Id"] = d["visit_key"]
    return d, deid, log


def derive(d):
    d = d.copy()
    d["date"] = d.arrival.dt.strftime("%Y-%m-%d")
    d["month"] = d.arrival.dt.strftime("%Y-%m")
    d["weekday"] = d.arrival.dt.day_name()
    d["weekday_num"] = d.arrival.dt.dayofweek + 1
    d["hour"] = d.arrival.dt.hour
    d["age_group"] = d.age.map(lambda a: band(a, AGE_BANDS))
    d["wait_band"] = d.wait_min.map(lambda w: band(w, WAIT_BANDS))
    d["referred"] = (d.referral != "None").astype(int)
    d["responded"] = d.satisfaction.notna().astype(int)
    d["over_target_30"] = (d.wait_min > TARGET).astype(int)
    return d.sort_values(["arrival", "visit_key"]).reset_index(drop=True)


def calendar_counts(d):
    days = pd.date_range(d.arrival.min().normalize(), d.arrival.max().normalize(), freq="D")
    per_wd = pd.Series(days.day_name()).value_counts()
    return days, per_wd


def kruskal(groups):
    groups = [g for g in groups if len(g) > 0]
    h, p = stats.kruskal(*groups)
    n = sum(len(g) for g in groups); k = len(groups)
    eps2 = (h - k + 1) / (n - k)          # epsilon-squared effect size
    return {"H": float(h), "p": float(p), "df": k - 1, "n": n, "epsilon_sq": float(eps2)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    d, deid, log = load()
    d = derive(d)
    deid.to_csv(ROOT / "data" / "er_visits_deidentified.csv", index=False)
    cols = ["visit_key", "arrival", "date", "month", "weekday", "weekday_num", "hour", "gender", "age", "age_group", "race", "referral",
            "referred", "admitted", "wait_min", "wait_band", "over_target_30", "satisfaction", "responded", "cm_flag"]
    d[cols].assign(arrival=d.arrival.dt.strftime("%Y-%m-%d %H:%M")).to_csv(OUT / "er_visits_analysis.csv", index=False)
    pd.DataFrame(log, columns=["rule", "field", "action", "rows_affected"]).to_csv(OUT / "cleaning_log.csv", index=False)

    days, per_wd = calendar_counts(d)
    daily = d.groupby(d.arrival.dt.normalize()).size().reindex(days, fill_value=0)
    resp = d[d.responded == 1]
    month = d.groupby("month").agg(visits=("visit_key", "size"), avg_wait=("wait_min", "mean"), pct_over_target=("over_target_30", "mean"),
                                   admission_rate=("admitted", "mean"), avg_satisfaction=("satisfaction", "mean"))
    month.to_csv(OUT / "summary_by_month.csv")
    wd = d.groupby("weekday").agg(visits=("visit_key", "size"), avg_wait=("wait_min", "mean"), pct_over_target=("over_target_30", "mean")).reindex(DAYS)
    wd["avg_visits_per_day"] = wd.visits / per_wd.reindex(DAYS)
    wd.to_csv(OUT / "summary_by_weekday.csv")
    hr = d.groupby("hour").agg(visits=("visit_key", "size"), avg_wait=("wait_min", "mean"), pct_over_target=("over_target_30", "mean"))
    hr["avg_visits_per_day"] = hr.visits / len(days)
    hr.to_csv(OUT / "summary_by_hour.csv")
    dep = d.groupby("referral").agg(visits=("visit_key", "size"), admissions=("admitted", "sum"), admission_rate=("admitted", "mean"),
                                    avg_wait=("wait_min", "mean"), median_wait=("wait_min", "median"), pct_over_target=("over_target_30", "mean"),
                                    avg_satisfaction=("satisfaction", "mean"), respondents=("responded", "sum"))
    dep.to_csv(OUT / "summary_by_referral.csv")

    ct = pd.crosstab(d.referral, d.admitted)
    chi2, p_chi, dof, _ = stats.chi2_contingency(ct, correction=False)
    cramer = float(np.sqrt(chi2 / (len(d) * (min(ct.shape) - 1))))
    sp = stats.spearmanr(resp.wait_min, resp.satisfaction)
    pe = stats.pearsonr(resp.wait_min, resp.satisfaction)
    sat_band = resp.groupby("wait_band").satisfaction.agg(["mean", "count", "std"])
    groups_sat = {g: kruskal([x.satisfaction.values for _, x in resp.groupby(g)]) for g in ["gender", "race", "age_group", "admitted", "referral"]}
    mean_d, sd_d = daily.mean(), daily.std(ddof=1)
    peaks = daily[daily > mean_d + 2 * sd_d]
    last, prev = month.index[-1], month.index[-2]
    ref = {
        "target_min": TARGET, "visits": len(d), "first_arrival": str(d.arrival.min()), "last_arrival": str(d.arrival.max()),
        "calendar_days": len(days), "avg_visits_per_day": float(len(d) / len(days)),
        "avg_wait": float(d.wait_min.mean()), "median_wait": float(d.wait_min.median()), "pct_over_target": float(d.over_target_30.mean() * 100),
        "p90_wait": float(np.percentile(d.wait_min, 90, method="linear")),
        "admission_rate": float(d.admitted.mean() * 100), "referral_rate": float(d.referred.mean() * 100),
        "response_rate": float(d.responded.mean() * 100), "avg_satisfaction": float(resp.satisfaction.mean()),
        "pct_satisfied_8plus": float((resp.satisfaction >= 8).mean() * 100),
        "latest_month": last, "latest_month_visits": int(month.loc[last, "visits"]), "prev_month_visits": int(month.loc[prev, "visits"]),
        "busiest_weekday": wd.avg_visits_per_day.idxmax(), "busiest_weekday_avg": float(wd.avg_visits_per_day.max()),
        "quietest_weekday": wd.avg_visits_per_day.idxmin(), "busiest_hour": int(hr.visits.idxmax()), "busiest_hour_avg": float(hr.avg_visits_per_day.max()),
        "busiest_month": month.visits.idxmax(), "busiest_month_visits": int(month.visits.max()),
        "daily_mean": float(mean_d), "daily_sd": float(sd_d), "peak_days": [str(x.date()) for x in peaks.index], "peak_threshold": float(mean_d + 2 * sd_d),
        "kw_wait_by_referral": kruskal([x.wait_min.values for _, x in d.groupby("referral")]),
        "kw_wait_by_weekday": kruskal([x.wait_min.values for _, x in d.groupby("weekday")]),
        "kw_wait_by_hour": kruskal([x.wait_min.values for _, x in d.groupby("hour")]),
        "kw_wait_by_age_group": kruskal([x.wait_min.values for _, x in d.groupby("age_group")]),
        "chi2_admission_by_age_group": dict(zip(["chi2", "p", "df"], map(float, stats.chi2_contingency(pd.crosstab(d.age_group, d.admitted), correction=False)[:3]))),
        "chi2_admission_by_referral": {"chi2": float(chi2), "p": float(p_chi), "df": int(dof), "cramers_v": cramer},
        "spearman_wait_satisfaction": {"rho": float(sp.statistic), "p": float(sp.pvalue), "n": int(len(resp))},
        "pearson_wait_satisfaction": {"r": float(pe.statistic), "p": float(pe.pvalue)},
        "satisfaction_by_wait_band": {k: {"mean": float(v["mean"]), "n": int(v["count"])} for k, v in sat_band.iterrows()},
        "kw_satisfaction": groups_sat,
        "admissions_by_referral": dep.admissions.astype(int).to_dict(), "admission_rate_by_referral": (dep.admission_rate * 100).round(6).to_dict(),
        "avg_wait_by_referral": dep.avg_wait.round(6).to_dict(), "weekday_avg_visits": wd.avg_visits_per_day.round(6).to_dict(),
        "hour_visits": hr.visits.astype(int).to_dict(), "month_visits": month.visits.astype(int).to_dict(),
        "max_hour_avg_wait": {"hour": int(hr.avg_wait.idxmax()), "avg": float(hr.avg_wait.max())},
        "max_weekday_avg_wait": {"weekday": wd.avg_wait.idxmax(), "avg": float(wd.avg_wait.max())},
        "response_rate_by_admitted": (d.groupby("admitted").responded.mean() * 100).to_dict(),
        "mw_wait_responders_vs_not": dict(zip(["U", "p"], map(float, stats.mannwhitneyu(d[d.responded == 1].wait_min, d[d.responded == 0].wait_min)))),
    }
    (OUT / "reference_values.json").write_text(json.dumps(ref, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    print(json.dumps({k: v for k, v in ref.items() if not isinstance(v, dict) or k.startswith(("kw", "chi", "spear", "pear"))}, indent=1, default=str))


if __name__ == "__main__":
    main()
