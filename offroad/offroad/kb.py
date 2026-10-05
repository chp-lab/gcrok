"""Knowledge base: scan knowledge/ folder, index into SQLite FTS5, search."""
import re
from html.parser import HTMLParser

from . import config
from .db import now_iso

MARK_OPEN, MARK_CLOSE = "\x02", "\x03"   # ตัวคั่นไฮไลต์ (ฝั่งเว็บ escape แล้วค่อยแทนเป็น <mark>)


class _Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.skip, self.title = [], 0, ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        self._in_title = tag == "title"

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data.strip()
        elif not self.skip:
            self.parts.append(data)


def _read_text(path):
    for enc in ("utf-8-sig", "cp874", "latin-1"):   # cp874 = ไฟล์ไทยเก่าจาก Windows
        try:
            return path.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
    return ""


def _extract(path, kind):
    """คืน (title, body)"""
    if kind == "pdf":
        return path.stem.replace("_", " "), ""     # ไม่มี lib อ่าน PDF: ค้นได้เฉพาะชื่อไฟล์
    text = _read_text(path)
    if kind == "html":
        p = _Text()
        p.feed(text)
        return p.title or path.stem.replace("_", " "), " ".join(" ".join(p.parts).split())
    m = re.search(r"^#\s+(.+)$", text, re.M) if kind == "md" else None
    return (m.group(1).strip() if m else path.stem.replace("_", " ")), text


def reindex(conn, force=False):
    """สแกนโฟลเดอร์ความรู้ อัปเดตเฉพาะไฟล์ที่เปลี่ยน ลบรายการไฟล์ที่หายไป"""
    config.KB_DIR.mkdir(parents=True, exist_ok=True)
    known = {r["path"]: r for r in conn.execute("SELECT id, path, mtime FROM kb_docs")}
    seen, added, updated = set(), 0, 0
    for f in sorted(config.KB_DIR.rglob("*")):
        kind = config.KB_EXTENSIONS.get(f.suffix.lower())
        if not kind or not f.is_file():
            continue
        rel = f.relative_to(config.KB_DIR).as_posix()
        seen.add(rel)
        st = f.stat()
        old = known.get(rel)
        if old and not force and abs(old["mtime"] - st.st_mtime) < 1e-6:
            continue
        title, body = _extract(f, kind)
        category = rel.split("/")[0] if "/" in rel else ""
        if old:
            conn.execute("UPDATE kb_docs SET title=?,kind=?,category=?,size=?,mtime=?,indexed_at=? WHERE id=?",
                         (title, kind, category, st.st_size, st.st_mtime, now_iso(), old["id"]))
            conn.execute("DELETE FROM kb_fts WHERE rowid=?", (old["id"],))
            doc_id, updated = old["id"], updated + 1
        else:
            doc_id = conn.execute(
                "INSERT INTO kb_docs(path,title,kind,category,size,mtime,indexed_at) VALUES (?,?,?,?,?,?,?)",
                (rel, title, kind, category, st.st_size, st.st_mtime, now_iso())).lastrowid
            added += 1
        conn.execute("INSERT INTO kb_fts(rowid,title,body) VALUES (?,?,?)", (doc_id, title, body))
    removed = 0
    for rel, row in known.items():
        if rel not in seen:
            conn.execute("DELETE FROM kb_docs WHERE id=?", (row["id"],))
            conn.execute("DELETE FROM kb_fts WHERE rowid=?", (row["id"],))
            removed += 1
    conn.commit()
    return {"added": added, "updated": updated, "removed": removed, "total": len(seen)}


def list_docs(conn):
    return [dict(r) for r in conn.execute(
        "SELECT id, path, title, kind, category, size FROM kb_docs ORDER BY category, title")]


def _snippet(body, terms, width=60):
    low = body.lower()
    pos = min((p for p in (low.find(t.lower()) for t in terms) if p >= 0), default=-1)
    if pos < 0:
        return body[: width * 2].replace("\n", " ")
    s = body[max(0, pos - width): pos + width * 2].replace("\n", " ")
    for t in terms:
        s = re.sub(re.escape(t), lambda m: MARK_OPEN + m.group(0) + MARK_CLOSE, s, flags=re.I)
    return ("…" if pos > width else "") + s + "…"


def search(conn, query, limit=30):
    terms = [t for t in re.split(r"\s+", query.strip()) if t]
    if not terms:
        return []
    tokenizer = conn.execute("SELECT value FROM settings WHERE key='fts_tokenizer'").fetchone()
    use_fts = tokenizer and tokenizer["value"] == "trigram" and all(len(t) >= 3 for t in terms)
    if use_fts:   # ทุกคำต้องปรากฏ (AND) — ใส่เครื่องหมายคำพูดเพื่อกัน syntax ของ FTS
        match = " AND ".join('"' + t.replace('"', '""') + '"' for t in terms)
        rows = conn.execute(
            "SELECT d.id, d.path, d.title, d.kind, d.category, "
            f"snippet(kb_fts, 1, '{MARK_OPEN}', '{MARK_CLOSE}', '…', 16) AS snip "
            "FROM kb_fts JOIN kb_docs d ON d.id = kb_fts.rowid WHERE kb_fts MATCH ? ORDER BY rank LIMIT ?",
            (match, limit)).fetchall()
        return [dict(r) for r in rows]
    # ทางสำรอง: คำสั้น (<3 ตัวอักษร) หรือ SQLite เก่า — สแกนด้วย LIKE
    like = " AND ".join(["(f.title LIKE ? ESCAPE '\\' OR f.body LIKE ? ESCAPE '\\')"] * len(terms))
    args = []
    for t in terms:
        p = "%" + t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        args += [p, p]
    rows = conn.execute(
        "SELECT d.id, d.path, d.title, d.kind, d.category, f.body FROM kb_fts f "
        f"JOIN kb_docs d ON d.id = f.rowid WHERE {like} LIMIT ?", (*args, limit)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["snip"] = _snippet(d.pop("body") or "", terms)
        out.append(d)
    return out
