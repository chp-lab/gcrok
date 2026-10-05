"""Embedded HTTP server: static web UI + JSON API (stdlib only).

Security model (เซิร์ฟเวอร์เปิดให้ LAN/Wi-Fi Hotspot):
  * เครื่องนี้ (loopback) อ่าน/เขียนได้เต็มที่
  * อุปกรณ์อื่นใน LAN อ่านได้ แต่ต้องใส่ PIN (header X-Offroad-Pin) จึงจะแก้ไขข้อมูลได้
  * คำขอเขียนที่มี Origin ไม่ตรงกับ Host ถูกปฏิเสธ (กันหน้าเว็บอื่น/เอกสารใน KB ยิงมาที่ API)
"""
import json
import math
import mimetypes
import re
import socket
import sqlite3
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import config, db, kb, services
from .db import now_iso

LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}
MAX_BODY = 1_000_000


class ApiError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


class Ctx:
    def __init__(self, conn, m, q, body):
        self.conn, self.m, self.q, self.body = conn, m, q, body

    def id(self, n=1):
        return int(self.m.group(n))


ROUTES = []


def route(method, pattern):
    rx = re.compile("^" + pattern + "$")

    def deco(fn):
        ROUTES.append((method, rx, fn))
        return fn
    return deco


# ───────────── helpers: validation / CRUD ─────────────
def _coerce(kind, v):
    if kind == "str":
        return str(v).strip()
    if kind in ("int?", "str?") and (v is None or v == ""):
        return None
    if kind == "str?":
        return str(v).strip()
    if kind == "bool":
        return 1 if v in (True, 1, "1", "true") else 0
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise ApiError(400, "bad_number")
    if not math.isfinite(n):
        raise ApiError(400, "bad_number")
    return int(n) if kind in ("int", "int?") else n


def pick(body, spec):
    return {k: _coerce(t, body[k]) for k, t in spec.items() if k in body}


def update(conn, table, rid, body, spec, touch=False):
    vals = pick(body, spec)
    if not vals:
        raise ApiError(400, "no_fields")
    if touch:
        vals["updated_at"] = now_iso()
    cur = conn.execute(f"UPDATE {table} SET " + ",".join(f"{k}=?" for k in vals) + " WHERE id=?",
                       (*vals.values(), rid))
    if cur.rowcount == 0:
        raise ApiError(404, "not_found")


def insert(conn, table, body, spec, required=(), touch=False):
    vals = pick(body, spec)
    for k in required:
        if vals.get(k) in (None, ""):
            raise ApiError(400, f"missing_{k}")
    if touch:
        vals["updated_at"] = now_iso()
    cur = conn.execute(f"INSERT INTO {table}({','.join(vals)}) VALUES ({','.join('?' * len(vals))})",
                       tuple(vals.values()))
    return cur.lastrowid


def delete(conn, table, rid):
    if conn.execute(f"DELETE FROM {table} WHERE id=?", (rid,)).rowcount == 0:
        raise ApiError(404, "not_found")
    return {"ok": True}


# ───────────── meta / dashboard ─────────────
def lan_addresses():
    ips = set()
    try:
        ips.update(i[4][0] for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    try:   # UDP connect ไม่ส่งแพ็กเก็ตจริง ใช้หา IP ของ interface หลัก (ใช้ได้แม้ออฟไลน์)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


@route("GET", "/api/meta")
def meta(c):
    port = c.q.get("port") or config.DEFAULT_PORT
    return {"now": datetime.now().isoformat(timespec="seconds"),
            "fts_tokenizer": services.get_setting(c.conn, "fts_tokenizer"),
            "lan_urls": [f"http://{ip}:{port}/" for ip in lan_addresses()]}


@route("GET", "/api/dashboard")
def dashboard(c):
    return services.dashboard(c.conn)


@route("GET", "/api/settings")
def get_settings(c):
    return {r["key"]: r["value"] for r in c.conn.execute("SELECT * FROM settings")
            if r["key"] not in ("lan_pin",)}


# ───────────── supplies ─────────────
SUPPLY = {"category": "str", "name": "str", "unit": "str", "qty_initial": "float",
          "qty_remaining": "float", "daily_use": "float", "note": "str?"}


@route("GET", "/api/supplies")
def supplies(c):
    return services.supplies_overview(c.conn)


@route("POST", "/api/supplies")
def supply_add(c):
    b = dict(c.body)
    b.setdefault("qty_remaining", b.get("qty_initial", 0))
    return {"id": insert(c.conn, "supplies", b, SUPPLY, ("name", "category", "unit"), touch=True)}


@route("PUT", r"/api/supplies/(\d+)")
def supply_edit(c):
    update(c.conn, "supplies", c.id(), c.body, SUPPLY, touch=True)
    return {"ok": True}


@route("DELETE", r"/api/supplies/(\d+)")
def supply_del(c):
    return delete(c.conn, "supplies", c.id())


@route("POST", r"/api/supplies/(\d+)/adjust")
def supply_adjust(c):
    delta = _coerce("float_any", c.body.get("delta"))
    row = c.conn.execute("SELECT qty_remaining FROM supplies WHERE id=?", (c.id(),)).fetchone()
    if not row:
        raise ApiError(404, "not_found")
    new = max(0.0, row["qty_remaining"] + delta)
    c.conn.execute("UPDATE supplies SET qty_remaining=?, updated_at=? WHERE id=?", (new, now_iso(), c.id()))
    c.conn.execute("INSERT INTO supply_log(supply_id,ts,delta,note) VALUES (?,?,?,?)",
                   (c.id(), now_iso(), new - row["qty_remaining"], str(c.body.get("note", ""))[:200]))
    return {"qty_remaining": new}


# ───────────── power ─────────────
STATION = {"name": "str", "capacity_wh": "float", "soc_pct": "float", "reserve_pct": "float",
           "inverter_eff": "float", "solar_peak_w": "float", "solar_derate": "float",
           "peak_sun_hours": "float"}
LOAD = {"name": "str", "watts": "float", "hours_per_day": "float", "enabled": "bool", "note": "str?"}


@route("GET", "/api/power")
def power(c):
    return services.power_overview(c.conn)


@route("PUT", "/api/power/station")
def station_edit(c):
    vals = pick(c.body, STATION)
    if "default_condition" in c.body:
        if c.body["default_condition"] not in ("sunny", "partly", "cloudy", "rain", "storm"):
            raise ApiError(400, "bad_condition")
        services.set_setting(c.conn, "solar_default_condition", c.body["default_condition"])
    if vals:
        vals["updated_at"] = now_iso()
        c.conn.execute("UPDATE power_station SET " + ",".join(f"{k}=?" for k in vals) + " WHERE id=1",
                       tuple(vals.values()))
        if "soc_pct" in vals:
            c.conn.execute("INSERT INTO power_log(ts,soc_pct,note) VALUES (?,?,?)",
                           (now_iso(), vals["soc_pct"], str(c.body.get("note", ""))[:200]))
    return {"ok": True}


@route("POST", "/api/power/loads")
def load_add(c):
    return {"id": insert(c.conn, "power_loads", c.body, LOAD, ("name",))}


@route("PUT", r"/api/power/loads/(\d+)")
def load_edit(c):
    update(c.conn, "power_loads", c.id(), c.body, LOAD)
    return {"ok": True}


@route("DELETE", r"/api/power/loads/(\d+)")
def load_del(c):
    return delete(c.conn, "power_loads", c.id())


@route("PUT", "/api/power/forecast")
def forecast_set(c):
    day, cond = str(c.body.get("day", "")), c.body.get("condition")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise ApiError(400, "bad_day")
    if cond in (None, "", "default"):
        c.conn.execute("DELETE FROM solar_forecast WHERE day=?", (day,))
    else:
        c.conn.execute("INSERT OR REPLACE INTO solar_forecast(day, condition) VALUES (?,?)", (day, cond))
    return {"ok": True}


# ───────────── fleet & SIM ─────────────
DEVICE = {"name": "str", "kind": "str", "model": "str?", "role": "str?", "battery_pct": "int?",
          "battery_health_pct": "int?", "power_state": "str", "note": "str?"}
SIM = {"carrier": "str", "label": "str", "msisdn": "str?", "device_id": "int?", "actual_state": "str",
       "expires_on": "str?", "note": "str?"}
SCHED = {"kind": "str", "sim_id": "int?", "device_id": "int?", "start_hhmm": "str", "end_hhmm": "str",
         "days": "str", "enabled": "bool"}


@route("GET", "/api/devices")
def devices(c):
    return services.fleet_overview(c.conn)


@route("POST", "/api/devices")
def device_add(c):
    return {"id": insert(c.conn, "devices", c.body, DEVICE, ("name", "kind"), touch=True)}


@route("PUT", r"/api/devices/(\d+)")
def device_edit(c):
    update(c.conn, "devices", c.id(), c.body, DEVICE, touch=True)
    return {"ok": True}


@route("DELETE", r"/api/devices/(\d+)")
def device_del(c):
    return delete(c.conn, "devices", c.id())


@route("GET", "/api/sims")
def sims(c):
    return services.sims_overview(c.conn)


@route("POST", "/api/sims")
def sim_add(c):
    return {"id": insert(c.conn, "sims", c.body, SIM, ("label", "carrier"))}


@route("PUT", r"/api/sims/(\d+)")
def sim_edit(c):
    update(c.conn, "sims", c.id(), c.body, SIM)
    return {"ok": True}


@route("DELETE", r"/api/sims/(\d+)")
def sim_del(c):
    return delete(c.conn, "sims", c.id())


@route("POST", "/api/schedules")
def sched_add(c):
    return {"id": insert(c.conn, "schedules", c.body, SCHED, ("kind", "start_hhmm", "end_hhmm"))}


@route("PUT", r"/api/schedules/(\d+)")
def sched_edit(c):
    update(c.conn, "schedules", c.id(), c.body, SCHED)
    return {"ok": True}


@route("DELETE", r"/api/schedules/(\d+)")
def sched_del(c):
    return delete(c.conn, "schedules", c.id())


# ───────────── knowledge base ─────────────
@route("GET", "/api/kb")
def kb_list(c):
    return kb.list_docs(c.conn)


@route("GET", "/api/kb/search")
def kb_search(c):
    return kb.search(c.conn, c.q.get("q", ""))


@route("POST", "/api/kb/reindex")
def kb_reindex(c):
    return kb.reindex(c.conn, force=bool(c.body.get("force")))


def safe_kb_path(rel):
    base = config.KB_DIR.resolve()
    p = (base / rel).resolve()
    if base not in p.parents or not p.is_file():
        raise ApiError(404, "not_found")
    return p


@route("GET", "/api/kb/doc")
def kb_doc(c):
    p = safe_kb_path(c.q.get("path", ""))
    kind = config.KB_EXTENSIONS.get(p.suffix.lower())
    out = {"path": c.q["path"], "kind": kind, "title": p.stem.replace("_", " ")}
    if kind in ("md", "txt"):
        out["content"] = kb._read_text(p)
        if kind == "md":
            out["title"] = kb._extract(p, "md")[0]
    return out


# ───────────── events ─────────────
EVENT = {"kind": "str", "value": "float_any?", "unit": "str?", "text": "str?", "author": "str?"}


@route("GET", "/api/events")
def events(c):
    limit = min(int(c.q.get("limit", 100)), 1000)
    if c.q.get("kind"):
        return services.rows(c.conn, "SELECT * FROM events WHERE kind=? ORDER BY ts DESC, id DESC LIMIT ?",
                             (c.q["kind"], limit))
    return services.rows(c.conn, "SELECT * FROM events ORDER BY ts DESC, id DESC LIMIT ?", (limit,))


@route("POST", "/api/events")
def event_add(c):
    b = dict(c.body)
    if b.get("value") in ("", None):
        b.pop("value", None)
    vals = {"ts": str(b.get("ts") or now_iso()), "kind": str(b.get("kind", "note"))}
    if "value" in b:
        vals["value"] = _coerce("float_any", b["value"])
    for k in ("unit", "text", "author"):
        if b.get(k):
            vals[k] = str(b[k])[:500]
    cur = c.conn.execute(f"INSERT INTO events({','.join(vals)}) VALUES ({','.join('?' * len(vals))})",
                         tuple(vals.values()))
    return {"id": cur.lastrowid}


@route("DELETE", r"/api/events/(\d+)")
def event_del(c):
    return delete(c.conn, "events", c.id())


# ───────────── checklists ─────────────
@route("GET", "/api/checklists")
def checklists(c):
    return services.checklists_overview(c.conn)


@route("PUT", "/api/phase")
def phase_set(c):
    level = int(c.body.get("level", 0))
    p = c.conn.execute("SELECT name FROM phases WHERE level=?", (level,)).fetchone()
    if not p:
        raise ApiError(400, "bad_level")
    services.set_setting(c.conn, "active_phase", level)
    c.conn.execute("INSERT INTO events(ts,kind,text,author) VALUES (?, 'note', ?, 'system')",
                   (now_iso(), f"เปลี่ยนเฟสเป็น {p['name']}"))
    return {"ok": True}


@route("POST", r"/api/checklists/items/(\d+)/toggle")
def item_toggle(c):
    row = c.conn.execute("SELECT done FROM checklist_items WHERE id=?", (c.id(),)).fetchone()
    if not row:
        raise ApiError(404, "not_found")
    done = 0 if row["done"] else 1
    c.conn.execute("UPDATE checklist_items SET done=?, done_at=? WHERE id=?",
                   (done, now_iso() if done else None, c.id()))
    return {"done": done}


@route("POST", "/api/checklists/items")
def item_add(c):
    level, text = int(c.body.get("level", 0)), str(c.body.get("text", "")).strip()
    if not text:
        raise ApiError(400, "missing_text")
    seq = c.conn.execute("SELECT COALESCE(MAX(seq),0)+1 FROM checklist_items WHERE level=?", (level,)).fetchone()[0]
    try:
        cur = c.conn.execute("INSERT INTO checklist_items(level,seq,text) VALUES (?,?,?)", (level, seq, text))
    except sqlite3.IntegrityError:
        raise ApiError(400, "bad_level")
    return {"id": cur.lastrowid}


@route("DELETE", r"/api/checklists/items/(\d+)")
def item_del(c):
    return delete(c.conn, "checklist_items", c.id())


@route("POST", r"/api/checklists/(\d)/reset")
def checklist_reset(c):
    c.conn.execute("UPDATE checklist_items SET done=0, done_at=NULL WHERE level=?", (c.id(),))
    return {"ok": True}


# ───────────── HTTP handler ─────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "OffRoad/0.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):   # ไม่เขียน log ลงดิสก์/คอนโซล (ประหยัดไฟ)
        pass

    # --- plumbing
    def _send(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    def _is_local(self):
        return self.client_address[0] in LOOPBACK

    def _check_write_allowed(self, conn):
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host"):
            raise ApiError(403, "bad_origin")
        if not self._is_local():
            pin = services.get_setting(conn, "lan_pin")
            if not pin or self.headers.get("X-Offroad-Pin") != pin:
                raise ApiError(403, "pin_required")

    # --- verbs
    def do_GET(self):
        self._dispatch()

    do_HEAD = do_GET

    def do_POST(self):
        self._dispatch()

    do_PUT = do_POST
    do_DELETE = do_POST

    def _dispatch(self):
        url = urlparse(self.path)
        path = unquote(url.path)
        try:
            if path.startswith("/api/"):
                return self._api(path, url)
            if path.startswith("/kb-files/"):
                return self._kb_file(path[len("/kb-files/"):])
            if self.command not in ("GET", "HEAD"):
                raise ApiError(405, "method_not_allowed")
            return self._static(path)
        except ApiError as e:
            self._json(e.status, {"error": e.code})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _api(self, path, url):
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        body = {}
        if self.command in ("POST", "PUT", "DELETE"):
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise ApiError(413, "too_large")
            raw = self.rfile.read(n) if n else b""
            if raw:
                try:
                    body = json.loads(raw)
                    if not isinstance(body, dict):
                        raise ValueError
                except ValueError:
                    raise ApiError(400, "bad_json")
        conn = db.connect()
        try:
            if self.command in ("POST", "PUT", "DELETE"):
                self._check_write_allowed(conn)
            matched_path = False
            for method, rx, fn in ROUTES:
                m = rx.match(path)
                if not m:
                    continue
                matched_path = True
                if method != self.command:
                    continue
                try:
                    result = fn(Ctx(conn, m, q, body))
                    conn.commit()
                except sqlite3.IntegrityError:
                    conn.rollback()
                    raise ApiError(400, "constraint_failed")
                return self._json(200, result)
            raise ApiError(405 if matched_path else 404, "method_not_allowed" if matched_path else "not_found")
        finally:
            conn.close()

    def _kb_file(self, rel):
        p = safe_kb_path(rel)
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        extra = {"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}
        if p.suffix.lower() in (".html", ".htm"):
            # เอกสาร HTML ใน KB รันใน sandbox (origin แยก) — เรียก API ของแอปไม่ได้
            extra["Content-Security-Policy"] = "sandbox allow-popups; default-src 'self' 'unsafe-inline' data:"
            ctype = "text/html; charset=utf-8"
        elif p.suffix.lower() in (".md", ".txt"):
            ctype = "text/plain; charset=utf-8"
        self._send(200, p.read_bytes(), ctype, extra)

    def _static(self, path):
        base = config.WEB_DIR.resolve()
        p = (base / ("index.html" if path in ("", "/") else path.lstrip("/"))).resolve()
        if base not in p.parents or not p.is_file():
            raise ApiError(404, "not_found")
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, p.read_bytes(), ctype, {"Cache-Control": "no-cache"})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):   # เงียบไว้ ไม่พ่น traceback เวลาไคลเอนต์หลุด
        pass


def make_server(host, port):
    return Server((host, port), Handler)
