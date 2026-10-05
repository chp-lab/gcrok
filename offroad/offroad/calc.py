"""Pure calculation helpers (no I/O) so they are trivial to unit-test."""
from datetime import datetime, timedelta

# ตัวคูณผลผลิตโซลาร์เทียบกับวันแดดจัด
CONDITION_FACTOR = {"sunny": 1.0, "partly": 0.6, "cloudy": 0.3, "rain": 0.15, "storm": 0.05}


# ───────────── เสบียง ─────────────
def summarize_supplies(rows, warn_days, crit_days):
    """รวมรายการเสบียงเป็นรายหมวด. rows: dict ที่มี category, qty_remaining, daily_use"""
    cats = {}
    for r in rows:
        c = cats.setdefault(r["category"], {"category": r["category"], "items": [], "days": None})
        item = dict(r)
        item["days"] = r["qty_remaining"] / r["daily_use"] if r["daily_use"] > 0 else None
        item["pct"] = (min(100.0, 100.0 * r["qty_remaining"] / r["qty_initial"])
                       if r["qty_initial"] > 0 else None)
        c["items"].append(item)
        if item["days"] is not None:
            c["days"] = (c["days"] or 0.0) + item["days"]
    for c in cats.values():
        d = c["days"]
        c["status"] = ("unknown" if d is None else "crit" if d < crit_days
                       else "warn" if d < warn_days else "ok")
    return list(cats.values())


# ───────────── พลังงาน ─────────────
def solar_wh(station, condition):
    return (station["solar_peak_w"] * station["solar_derate"] * station["peak_sun_hours"]
            * CONDITION_FACTOR.get(condition, CONDITION_FACTOR["cloudy"]))


def daily_load_wh(loads):
    return sum(l["watts"] * l["hours_per_day"] for l in loads if l["enabled"])


def simulate_power(station, loads, forecast, today, default_condition, horizon=14):
    """จำลองพลังงานรายวัน. forecast: {'YYYY-MM-DD': condition}. today: date.

    พลังงานแบตลดลงด้วย load/ประสิทธิภาพอินเวอร์เตอร์ และเพิ่มด้วยโซลาร์ (ไม่เกินความจุ)
    days_remaining = จำนวนวัน (ทศนิยม) จนแบตแตะ reserve; None = อยู่ได้ตลอด horizon
    """
    cap = station["capacity_wh"]
    reserve = cap * station["reserve_pct"] / 100.0
    stored = cap * station["soc_pct"] / 100.0
    load = daily_load_wh(loads)
    burn = load / station["inverter_eff"]

    energy, remaining, days = stored, None, []
    for i in range(horizon):
        d = today + timedelta(days=i)
        cond = forecast.get(d.isoformat(), default_condition)
        sol = solar_wh(station, cond)
        start = energy
        energy = min(cap, energy + sol - burn)
        days.append({"day": d.isoformat(), "condition": cond, "solar_wh": round(sol),
                     "burn_wh": round(burn), "end_wh": round(max(energy, 0)),
                     "end_pct": round(max(energy, 0) / cap * 100, 1)})
        if remaining is None and energy <= reserve:
            net = sol - burn
            frac = (start - reserve) / -net if net < 0 and start > reserve else 0.0
            remaining = i + max(0.0, min(1.0, frac))
            energy = max(energy, 0)
    return {"stored_wh": round(stored), "reserve_wh": round(reserve),
            "load_wh_day": round(load), "burn_wh_day": round(burn),
            "days": days, "days_remaining": remaining, "sustainable": remaining is None}


# ───────────── ตารางเวลา SIM / Hotspot ─────────────
def _minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _merged_intervals(windows, now, span_days=8):
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    spans = []
    for off in range(-1, span_days):
        day = day0 + timedelta(days=off)
        for w in windows:
            if not w["enabled"] or w["days"][day.weekday()] != "1":
                continue
            s = day + timedelta(minutes=_minutes(w["start_hhmm"]))
            e = day + timedelta(minutes=_minutes(w["end_hhmm"]))
            if e <= s:
                e += timedelta(days=1)
            spans.append((s, e))
    spans.sort()
    merged = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def window_state(windows, now=None):
    """windows: รายการ schedules (dict). คืน {active, next_change(datetime|None), has_schedule}"""
    now = now or datetime.now()
    enabled = [w for w in windows if w["enabled"]]
    merged = _merged_intervals(enabled, now)
    for s, e in merged:
        if s <= now < e:
            return {"active": True, "next_change": e, "has_schedule": True}
    future = [s for s, _ in merged if s > now]
    return {"active": False, "next_change": min(future) if future else None,
            "has_schedule": bool(enabled)}
