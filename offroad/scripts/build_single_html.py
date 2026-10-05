#!/usr/bin/env python3
"""สร้าง OffRoad.html — ไฟล์เดียวที่ดับเบิลคลิกเปิดได้ (ไม่ต้องมี Python/เซิร์ฟเวอร์/อินเทอร์เน็ต)

ข้อมูลตั้งต้นดึงจาก offroad/seed.py + เอกสารใน knowledge/ เพื่อให้เป็นแหล่งเดียวกับเวอร์ชันเซิร์ฟเวอร์
ใช้:  python scripts/build_single_html.py   ->  OffRoad.html
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
KB_KINDS = {".md": "md", ".markdown": "md", ".txt": "txt", ".html": "html", ".htm": "html"}   # PDF ฝังไม่ได้


def build_seed():
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["OFFROAD_DATA"] = tmp
        from offroad import db   # import หลังตั้ง env เพื่อไม่แตะ data/ จริง
        db.init_db()
        conn = sqlite3.connect(Path(tmp) / "offroad.db")
        conn.row_factory = sqlite3.Row
        rows = lambda sql: [dict(r) for r in conn.execute(sql)]
        s = {
            "v": 1,
            "settings": {r["key"]: r["value"] for r in conn.execute("SELECT * FROM settings")
                         if r["key"] not in ("lan_pin", "fts_tokenizer")},
            "supplies": rows("SELECT * FROM supplies ORDER BY id"), "supply_log": [],
            "station": dict(conn.execute("SELECT * FROM power_station WHERE id=1").fetchone()),
            "loads": rows("SELECT * FROM power_loads ORDER BY id"), "forecast": {}, "power_log": [],
            "devices": rows("SELECT * FROM devices ORDER BY id"),
            "sims": rows("SELECT * FROM sims ORDER BY id"),
            "schedules": rows("SELECT * FROM schedules ORDER BY id"),
            "phases": rows("SELECT * FROM phases ORDER BY level"),
            "items": rows("SELECT * FROM checklist_items ORDER BY id"),
            "events": rows("SELECT * FROM events ORDER BY id"),
        }
        conn.close()
    kb_dir = ROOT / "knowledge"
    docs, n = [], 0
    for f in sorted(kb_dir.rglob("*")):
        kind = KB_KINDS.get(f.suffix.lower())
        if not kind or not f.is_file():
            continue
        n += 1
        rel = f.relative_to(kb_dir).as_posix()
        text = f.read_text(encoding="utf-8-sig")
        title = f.stem.replace("_", " ")
        if kind == "md":
            for line in text.splitlines():
                if line.startswith("# "):
                    title = line[2:].strip()
                    break
        docs.append({"id": n, "path": rel, "title": title, "kind": kind,
                     "category": rel.split("/")[0] if "/" in rel else "", "content": text})
    s["kb"] = docs
    # ตัวนับ id ถัดไปของแต่ละตาราง (ชื่อ key ตรงกับ nid() ใน local_backend.js)
    s["next"] = {k: max([r["id"] for r in s[k]] or [0]) for k in
                 ("supplies", "loads", "devices", "sims", "schedules", "items", "events", "kb")}
    s["next"].update(supply_log=0, power_log=0)
    return s


def inline_js(text):
    """กัน </script> และ <!-- ในข้อมูลฝังไม่ให้ปิดแท็กก่อนเวลา"""
    return text.replace("</", "<\\/").replace("<!--", "<\\u0021--")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--artifact", action="store_true",
                    help="สร้างแบบไม่มี <html>/<head>/<body> สำหรับเผยแพร่เป็น Artifact (ระบบห่อโครงเอกสารให้เอง)")
    ap.add_argument("-o", "--output", type=Path, default=None)
    args = ap.parse_args()

    web = ROOT / "web"
    html = (web / "index.html").read_text(encoding="utf-8")
    css = (web / "style.css").read_text(encoding="utf-8")
    seed = json.dumps(build_seed(), ensure_ascii=False, separators=(",", ":"))
    scripts = "\n".join(f"<script>\n{inline_js(body)}\n</script>" for body in (
        "window.OFFROAD_SEED = " + seed + ";",
        (web / "local_backend.js").read_text(encoding="utf-8"),
        (web / "app.js").read_text(encoding="utf-8"),
    ))
    link, tag = '<link rel="stylesheet" href="/style.css">', '<script src="/app.js"></script>'
    assert link in html and tag in html
    if args.artifact:
        body = re.search(r"<body>(.*)</body>", html, re.S).group(1).replace(tag, scripts)
        html = f"<title>Off Road</title>\n<style>\n{css}\n</style>\n{body}\n"
        default = ROOT / "dist" / "OffRoad.artifact.html"
    else:
        html = html.replace(link, f"<style>\n{css}\n</style>").replace(tag, scripts)
        default = ROOT / "OffRoad.html"
    out = args.output or default
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"สร้าง {out} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
