"""SQLite connection + first-run initialisation."""
import sqlite3
from datetime import datetime

from . import config

SCHEMA_VERSION = 1


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def connect():
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _create_fts(conn):
    # trigram = ค้นข้อความไทย (ไม่มีช่องว่างคั่นคำ) ได้แบบ substring; ต้องมี SQLite >= 3.34
    try:
        conn.execute("CREATE VIRTUAL TABLE kb_fts USING fts5(title, body, tokenize='trigram')")
        tok = "trigram"
    except sqlite3.OperationalError:
        conn.execute("CREATE VIRTUAL TABLE kb_fts USING fts5(title, body)")
        tok = "unicode61"
    conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES ('fts_tokenizer', ?)", (tok,))


def init_db():
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")      # อ่าน/เขียนพร้อมกันได้ (LAN หลายเครื่อง)
        conn.execute("PRAGMA synchronous = NORMAL")    # ลด fsync -> ประหยัดไฟ/ดิสก์
        if conn.execute("PRAGMA user_version").fetchone()[0] < SCHEMA_VERSION:
            conn.executescript(config.SCHEMA_PATH.read_text(encoding="utf-8"))
            _create_fts(conn)
            from . import seed
            seed.seed(conn)
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    finally:
        conn.close()
