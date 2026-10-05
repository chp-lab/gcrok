"""End-to-end API tests against a real server bound to a random port (temp DB + temp KB)."""
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

TMP = tempfile.mkdtemp(prefix="offroad-test-")
os.environ["OFFROAD_DATA"] = os.path.join(TMP, "data")
os.environ["OFFROAD_KB"] = os.path.join(TMP, "kb")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from offroad import config, db, kb, server, services  # noqa: E402


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.makedirs(config.KB_DIR / "sanitation")
        (config.KB_DIR / "sanitation" / "latrine.md").write_text(
            "# ส้วมแห้ง\n\nใช้ปูนขาวโรยทุกครั้ง ปิดถุงสองชั้น\n", encoding="utf-8")
        (config.KB_DIR / "notes.txt").write_text("water boil 1 minute", encoding="utf-8")
        (config.KB_DIR / "x.html").write_text("<title>แผนที่</title><p>ทางหนี</p>", encoding="utf-8")
        db.init_db()
        conn = db.connect()
        kb.reindex(conn)
        cls.pin = services.get_setting(conn, "lan_pin")
        conn.close()
        cls.srv = server.make_server("127.0.0.1", 0)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        shutil.rmtree(TMP, ignore_errors=True)

    def call(self, method, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, method=method, headers=headers or {},
                                     data=None if body is None else json.dumps(body).encode())
        try:
            with urllib.request.urlopen(req) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if r.headers["Content-Type"].startswith("application/json") else raw)
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    # --- seed & dashboard
    def test_seed_counts(self):
        _, dev = self.call("GET", "/api/devices")
        self.assertEqual(dev["total"], 11)
        self.assertEqual(dev["by_kind"], {"phone": 4, "tablet": 2, "laptop": 3, "pc": 2})
        _, sims = self.call("GET", "/api/sims")
        self.assertEqual(sorted(s["carrier"] for s in sims["sims"]).count("AIS"), 3)
        self.assertEqual(sorted(s["carrier"] for s in sims["sims"]).count("True"), 3)

    def test_dashboard_shape(self):
        status, d = self.call("GET", "/api/dashboard")
        self.assertEqual(status, 200)
        for k in ("phase", "supplies", "power", "fleet", "sims", "water", "events"):
            self.assertIn(k, d)
        self.assertEqual(d["phase"]["level"], 1)
        self.assertEqual(len(d["power"]["days"]), 7)

    # --- supplies
    def test_supply_adjust_clamps_at_zero_and_logs(self):
        _, cats = self.call("GET", "/api/supplies")
        sid = cats[0]["items"][0]["id"]
        _, r = self.call("POST", f"/api/supplies/{sid}/adjust", {"delta": -1e9})
        self.assertEqual(r["qty_remaining"], 0)
        status, _ = self.call("PUT", f"/api/supplies/{sid}", {"qty_remaining": -5})
        self.assertEqual(status, 400)          # CHECK constraint -> 400, not 500

    # --- power
    def test_power_soc_update_changes_days_remaining(self):
        self.call("PUT", "/api/power/station", {"soc_pct": 100, "default_condition": "storm"})
        _, hi = self.call("GET", "/api/power")
        self.call("PUT", "/api/power/station", {"soc_pct": 50})
        _, lo = self.call("GET", "/api/power")
        self.assertGreater(hi["days_remaining"], lo["days_remaining"])
        self.assertEqual(self.call("PUT", "/api/power/station", {"soc_pct": 150})[0], 400)

    def test_forecast_override(self):
        _, p = self.call("GET", "/api/power")
        day = p["days"][2]["day"]
        self.call("PUT", "/api/power/forecast", {"day": day, "condition": "rain"})
        _, p = self.call("GET", "/api/power")
        self.assertEqual(p["days"][2]["condition"], "rain")
        self.assertEqual(self.call("PUT", "/api/power/forecast", {"day": "nope", "condition": "rain"})[0], 400)

    # --- sims / schedules
    def test_schedule_validation(self):
        bad = {"kind": "sim_power", "sim_id": 1, "start_hhmm": "7:00", "end_hhmm": "08:00"}
        self.assertEqual(self.call("POST", "/api/schedules", bad)[0], 400)
        orphan = {"kind": "sim_power", "start_hhmm": "07:00", "end_hhmm": "08:00"}
        self.assertEqual(self.call("POST", "/api/schedules", orphan)[0], 400)
        ok = {"kind": "hotspot", "device_id": 2, "start_hhmm": "07:00", "end_hhmm": "08:00"}
        self.assertEqual(self.call("POST", "/api/schedules", ok)[0], 200)

    # --- events & checklists
    def test_event_roundtrip_and_phase_change(self):
        self.call("POST", "/api/events", {"kind": "water_gate", "value": "42", "unit": "cm", "text": "หน้าบ้าน"})
        _, d = self.call("GET", "/api/dashboard")
        self.assertEqual(d["water"]["gate"]["value"], 42)
        self.assertEqual(self.call("PUT", "/api/phase", {"level": 9})[0], 400)
        self.call("PUT", "/api/phase", {"level": 2})
        _, d = self.call("GET", "/api/dashboard")
        self.assertEqual(d["phase"]["flag"], "orange")
        self.call("PUT", "/api/phase", {"level": 1})

    def test_checklist_toggle_and_reset(self):
        _, chk = self.call("GET", "/api/checklists")
        item = chk["phases"][0]["items"][0]["id"]
        self.assertEqual(self.call("POST", f"/api/checklists/items/{item}/toggle", {})[1]["done"], 1)
        _, chk = self.call("GET", "/api/checklists")
        self.assertEqual(chk["phases"][0]["done"], 1)
        self.call("POST", "/api/checklists/1/reset", {})
        _, chk = self.call("GET", "/api/checklists")
        self.assertEqual(chk["phases"][0]["done"], 0)

    # --- knowledge base
    def test_kb_search_thai_and_short_terms(self):
        _, r = self.call("GET", "/api/kb/search?q=" + urllib.request.quote("ปูนขาว"))
        self.assertEqual([x["path"] for x in r], ["sanitation/latrine.md"])
        self.assertIn("\x02", r[0]["snip"])
        _, r = self.call("GET", "/api/kb/search?q=" + urllib.request.quote("ปู"))   # < 3 chars -> LIKE fallback
        self.assertEqual(len(r), 1)
        _, r = self.call("GET", "/api/kb/search?q=" + urllib.request.quote('boil "1'))  # quote-injection safe
        self.assertEqual(self.call("GET", "/api/kb/search?q=%22%22%22")[0], 200)

    def test_kb_reindex_picks_up_new_and_removed_files(self):
        f = config.KB_DIR / "new.md"
        f.write_text("# ใหม่\nฟิลเตอร์น้ำ", encoding="utf-8")
        _, st = self.call("POST", "/api/kb/reindex", {})
        self.assertEqual(st["added"], 1)
        f.unlink()
        _, st = self.call("POST", "/api/kb/reindex", {})
        self.assertEqual(st["removed"], 1)

    def test_kb_path_traversal_blocked(self):
        for p in ("../data/offroad.db", "..%2Fdata%2Foffroad.db", "%2e%2e/data/offroad.db"):
            self.assertEqual(self.call("GET", "/kb-files/" + p)[0], 404, p)
        self.assertEqual(self.call("GET", "/api/kb/doc?path=../data/offroad.db")[0], 404)
        self.assertEqual(self.call("GET", "/kb-files/x.html")[0], 200)

    # --- static & security
    def test_static_and_traversal(self):
        status, body = self.call("GET", "/")
        self.assertEqual(status, 200)
        self.assertEqual(self.call("GET", "/../offroad/db.py")[0], 404)
        self.assertEqual(self.call("GET", "/%2e%2e/offroad/db.py")[0], 404)

    def test_cross_origin_write_rejected(self):
        status, body = self.call("POST", "/api/events", {"kind": "note", "text": "x"},
                                 {"Origin": "http://evil.example"})
        self.assertEqual((status, body["error"]), (403, "bad_origin"))

    def test_remote_write_requires_pin(self):
        class FakeHandler(server.Handler):
            def __init__(self, ip, pin):
                self.client_address, self.headers = (ip, 1), {"Host": "h", "X-Offroad-Pin": pin}

        conn = db.connect()
        try:
            with self.assertRaises(server.ApiError):
                FakeHandler("192.168.137.5", "wrong")._check_write_allowed(conn)
            FakeHandler("192.168.137.5", self.pin)._check_write_allowed(conn)
            FakeHandler("127.0.0.1", "")._check_write_allowed(conn)
        finally:
            conn.close()

    def test_bad_json_and_unknown_route(self):
        req = urllib.request.Request(self.base + "/api/events", method="POST", data=b"{nope")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req)
        self.assertEqual(cm.exception.code, 400)
        self.assertEqual(self.call("GET", "/api/nothing")[0], 404)
        self.assertEqual(self.call("DELETE", "/api/dashboard")[0], 405)


if __name__ == "__main__":
    unittest.main()
