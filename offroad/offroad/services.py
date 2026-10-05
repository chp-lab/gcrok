"""Read-side aggregation used by the dashboard and per-module endpoints."""
from datetime import date, datetime

from . import calc

LOW_BATTERY_PCT = 30


def rows(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args)]


def get_setting(conn, key, default=None):
    r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


def set_setting(conn, key, value):
    conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (key, str(value)))


def _iso(dt):
    return dt.isoformat(timespec="minutes") if dt else None


def supplies_overview(conn):
    items = rows(conn, "SELECT * FROM supplies ORDER BY CASE category WHEN 'water' THEN 0 WHEN 'food' THEN 1 "
                       "WHEN 'gas' THEN 2 ELSE 3 END, id")
    return calc.summarize_supplies(items, float(get_setting(conn, "warn_days", 7)),
                                   float(get_setting(conn, "crit_days", 3)))


def power_overview(conn, horizon=14):
    station = dict(conn.execute("SELECT * FROM power_station WHERE id=1").fetchone())
    loads = rows(conn, "SELECT * FROM power_loads ORDER BY id")
    today = date.today()
    forecast = {r["day"]: r["condition"] for r in conn.execute(
        "SELECT day, condition FROM solar_forecast WHERE day >= ?", (today.isoformat(),))}
    default = get_setting(conn, "solar_default_condition", "partly")
    out = calc.simulate_power(station, loads, forecast, today, default, horizon)
    out.update(station=station, loads=loads, default_condition=default,
               forecast_days={d: c for d, c in forecast.items()})
    return out


def fleet_overview(conn):
    devices = rows(conn, "SELECT * FROM devices ORDER BY id")
    sims = rows(conn, "SELECT id, label, device_id FROM sims")
    for d in devices:
        d["sims"] = [s["label"] for s in sims if s["device_id"] == d["id"]]
    kinds = {}
    for d in devices:
        kinds[d["kind"]] = kinds.get(d["kind"], 0) + 1
    low = [d for d in devices if d["battery_pct"] is not None
           and d["battery_pct"] < LOW_BATTERY_PCT and d["power_state"] != "charging"]
    return {"devices": devices, "total": len(devices), "by_kind": kinds,
            "low_battery": low, "powered_on": sum(d["power_state"] in ("on", "charging") for d in devices)}


def sims_overview(conn, now=None):
    now = now or datetime.now()
    sims = rows(conn, "SELECT s.*, d.name AS device_name FROM sims s "
                      "LEFT JOIN devices d ON d.id = s.device_id ORDER BY s.id")
    scheds = rows(conn, "SELECT * FROM schedules ORDER BY start_hhmm, id")
    for s in sims:
        ws = [w for w in scheds if w["kind"] == "sim_power" and w["sim_id"] == s["id"]]
        st = calc.window_state(ws, now)
        s.update(schedule_count=len(ws), scheduled_on=st["active"],
                 next_change=_iso(st["next_change"]), has_schedule=st["has_schedule"],
                 mismatch=st["has_schedule"] and st["active"] != (s["actual_state"] == "on"))
    hotspots = []
    for dev in rows(conn, "SELECT id, name FROM devices ORDER BY id"):
        ws = [w for w in scheds if w["kind"] == "hotspot" and w["device_id"] == dev["id"]]
        if ws:
            st = calc.window_state(ws, now)
            hotspots.append({"device_id": dev["id"], "device_name": dev["name"], "active": st["active"],
                             "next_change": _iso(st["next_change"])})
    return {"sims": sims, "hotspots": hotspots, "schedules": scheds}


def checklists_overview(conn):
    phases = rows(conn, "SELECT * FROM phases ORDER BY level")
    items = rows(conn, "SELECT * FROM checklist_items ORDER BY level, seq, id")
    for p in phases:
        p["items"] = [i for i in items if i["level"] == p["level"]]
        p["done"] = sum(i["done"] for i in p["items"])
        p["total"] = len(p["items"])
    return {"active": int(get_setting(conn, "active_phase", 1)), "phases": phases}


def latest_event(conn, kind):
    r = conn.execute("SELECT ts, value, unit, text FROM events WHERE kind=? AND value IS NOT NULL "
                     "ORDER BY ts DESC, id DESC LIMIT 1", (kind,)).fetchone()
    return dict(r) if r else None


def dashboard(conn):
    chk = checklists_overview(conn)
    active = next(p for p in chk["phases"] if p["level"] == chk["active"])
    power = power_overview(conn, horizon=7)
    fleet = fleet_overview(conn)
    simo = sims_overview(conn)
    return {
        "now": datetime.now().isoformat(timespec="seconds"),
        "phase": {k: active[k] for k in ("level", "name", "flag", "summary", "done", "total")},
        "supplies": supplies_overview(conn),
        "power": {k: power[k] for k in ("stored_wh", "load_wh_day", "burn_wh_day", "days",
                                         "days_remaining", "sustainable")}
                 | {"soc_pct": power["station"]["soc_pct"], "capacity_wh": power["station"]["capacity_wh"]},
        "fleet": {k: fleet[k] for k in ("total", "by_kind", "low_battery", "powered_on")},
        "sims": {"on_now": [s["label"] for s in simo["sims"] if s["scheduled_on"]],
                 "actual_on": [s["label"] for s in simo["sims"] if s["actual_state"] == "on"],
                 "mismatch": [s["label"] for s in simo["sims"] if s["mismatch"]],
                 "next_change": min((s["next_change"] for s in simo["sims"] if s["next_change"]), default=None),
                 "hotspots": simo["hotspots"]},
        "water": {"gate": latest_event(conn, "water_gate"), "indoor": latest_event(conn, "water_indoor")},
        "events": rows(conn, "SELECT * FROM events ORDER BY ts DESC, id DESC LIMIT 8"),
    }
