import os
import sys
import unittest
from datetime import date, datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from offroad import calc  # noqa: E402

STATION = {"capacity_wh": 2000, "soc_pct": 100, "reserve_pct": 10, "inverter_eff": 1.0,
           "solar_peak_w": 650, "solar_derate": 0.75, "peak_sun_hours": 4.5}


class SupplyTests(unittest.TestCase):
    def test_days_are_summed_across_items(self):
        rows = [{"category": "water", "qty_remaining": 100, "qty_initial": 200, "daily_use": 10},
                {"category": "water", "qty_remaining": 50, "qty_initial": 50, "daily_use": 10}]
        (cat,) = calc.summarize_supplies(rows, warn_days=7, crit_days=3)
        self.assertAlmostEqual(cat["days"], 15)
        self.assertEqual(cat["status"], "ok")
        self.assertEqual(cat["items"][0]["pct"], 50)

    def test_status_thresholds_and_unknown(self):
        mk = lambda q, u: [{"category": "gas", "qty_remaining": q, "qty_initial": 10, "daily_use": u}]
        self.assertEqual(calc.summarize_supplies(mk(2, 1), 7, 3)[0]["status"], "crit")
        self.assertEqual(calc.summarize_supplies(mk(5, 1), 7, 3)[0]["status"], "warn")
        self.assertEqual(calc.summarize_supplies(mk(5, 0), 7, 3)[0]["status"], "unknown")


class PowerTests(unittest.TestCase):
    def test_no_load_is_sustainable(self):
        r = calc.simulate_power(STATION, [], {}, date(2026, 10, 5), "sunny")
        self.assertTrue(r["sustainable"])
        self.assertIsNone(r["days_remaining"])

    def test_deficit_interpolates_days_remaining(self):
        loads = [{"watts": 100, "hours_per_day": 24, "enabled": 1}]       # 2400 Wh/day
        r = calc.simulate_power(STATION, loads, {}, date(2026, 10, 5), "storm", horizon=10)
        sol = calc.solar_wh(STATION, "storm")
        expected = (2000 - 200) / (2400 - sol)                            # usable / net burn
        self.assertAlmostEqual(r["days_remaining"], expected, places=3)

    def test_disabled_loads_ignored_and_forecast_overrides_default(self):
        loads = [{"watts": 1000, "hours_per_day": 24, "enabled": 0}]
        self.assertEqual(calc.daily_load_wh(loads), 0)
        r = calc.simulate_power(STATION, [], {"2026-10-06": "rain"}, date(2026, 10, 5), "sunny", horizon=2)
        self.assertEqual(r["days"][1]["condition"], "rain")

    def test_already_below_reserve_is_zero_days(self):
        st = dict(STATION, soc_pct=5)
        loads = [{"watts": 100, "hours_per_day": 24, "enabled": 1}]
        r = calc.simulate_power(st, loads, {}, date(2026, 10, 5), "storm")
        self.assertEqual(r["days_remaining"], 0)


class WindowTests(unittest.TestCase):
    def w(self, s, e, days="1111111", enabled=1):
        return {"start_hhmm": s, "end_hhmm": e, "days": days, "enabled": enabled}

    def test_active_and_next_change(self):
        ws = [self.w("07:00", "07:30"), self.w("13:00", "13:30")]
        st = calc.window_state(ws, datetime(2026, 10, 5, 7, 10))
        self.assertTrue(st["active"])
        self.assertEqual(st["next_change"], datetime(2026, 10, 5, 7, 30))
        st = calc.window_state(ws, datetime(2026, 10, 5, 8, 0))
        self.assertFalse(st["active"])
        self.assertEqual(st["next_change"], datetime(2026, 10, 5, 13, 0))

    def test_overnight_window_and_wraparound(self):
        ws = [self.w("22:00", "02:00")]
        self.assertTrue(calc.window_state(ws, datetime(2026, 10, 6, 1, 0))["active"])
        st = calc.window_state(ws, datetime(2026, 10, 5, 23, 0))
        self.assertEqual(st["next_change"], datetime(2026, 10, 6, 2, 0))

    def test_overlapping_windows_merge(self):
        ws = [self.w("07:00", "07:30"), self.w("07:20", "07:50")]
        st = calc.window_state(ws, datetime(2026, 10, 5, 7, 25))
        self.assertEqual(st["next_change"], datetime(2026, 10, 5, 7, 50))

    def test_day_mask_and_disabled(self):
        mon_only = [self.w("07:00", "08:00", days="1000000")]     # 2026-10-05 = Monday
        self.assertTrue(calc.window_state(mon_only, datetime(2026, 10, 5, 7, 30))["active"])
        self.assertFalse(calc.window_state(mon_only, datetime(2026, 10, 6, 7, 30))["active"])
        off = [self.w("07:00", "08:00", enabled=0)]
        st = calc.window_state(off, datetime(2026, 10, 5, 7, 30))
        self.assertFalse(st["active"])
        self.assertFalse(st["has_schedule"])


if __name__ == "__main__":
    unittest.main()
