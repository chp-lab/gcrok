"""Paths & constants. Resolved relative to the app so the folder can be copied to a USB stick."""
import os
import sys
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
# โค้ด/ไฟล์เว็บ: โฟลเดอร์โปรเจกต์ (หรือ _internal ของ PyInstaller)
PKG_DIR = Path(__file__).resolve().parent
APP_DIR = PKG_DIR.parent
WEB_DIR = APP_DIR / "web"
SCHEMA_PATH = PKG_DIR / "schema.sql"

# ข้อมูลผู้ใช้: วางไว้ข้าง .exe / ข้างโปรเจกต์ เพื่อให้สำรองได้ทั้งโฟลเดอร์
USER_DIR = Path(sys.executable).resolve().parent if FROZEN else APP_DIR
DATA_DIR = Path(os.environ.get("OFFROAD_DATA", USER_DIR / "data"))
KB_DIR = Path(os.environ.get("OFFROAD_KB", USER_DIR / "knowledge"))
DB_PATH = DATA_DIR / "offroad.db"

DEFAULT_PORT = 8765
KB_EXTENSIONS = {".md": "md", ".markdown": "md", ".txt": "txt",
                 ".html": "html", ".htm": "html", ".pdf": "pdf"}
