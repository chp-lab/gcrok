#!/usr/bin/env python3
"""Off Road launcher.  python run.py [--port 8765] [--local-only] [--no-browser] [--window]"""
import argparse
import sys
import threading
import webbrowser

from offroad import config, db, kb, server, services


def main():
    ap = argparse.ArgumentParser(description="Off Road — offline emergency command center")
    ap.add_argument("--port", type=int, default=config.DEFAULT_PORT)
    ap.add_argument("--local-only", action="store_true", help="ไม่เปิดให้อุปกรณ์อื่นใน LAN เข้าถึง")
    ap.add_argument("--no-browser", action="store_true", help="ไม่เปิดเบราว์เซอร์อัตโนมัติ")
    ap.add_argument("--window", action="store_true", help="เปิดเป็นหน้าต่างแอป (ต้องมี pywebview; ไม่มีจะใช้เบราว์เซอร์)")
    args = ap.parse_args()

    db.init_db()
    conn = db.connect()
    stats = kb.reindex(conn)
    pin = services.get_setting(conn, "lan_pin")
    conn.close()

    host = "127.0.0.1" if args.local_only else "0.0.0.0"
    try:
        srv = server.make_server(host, args.port)
    except OSError as e:
        sys.exit(f"เปิดพอร์ต {args.port} ไม่ได้: {e}\nลอง: python run.py --port {args.port + 1}")

    local_url = f"http://127.0.0.1:{args.port}/"
    print("Off Road พร้อมทำงาน (ออฟไลน์ 100%)")
    print(f"  เครื่องนี้ : {local_url}")
    if not args.local_only:
        for ip in server.lan_addresses():
            print(f"  อุปกรณ์อื่น: http://{ip}:{args.port}/   (อ่านได้ทันที, แก้ไขต้องใช้ PIN {pin})")
    print(f"  คลังความรู้: {stats['total']} ไฟล์  |  ข้อมูล: {config.DB_PATH}")
    print("  กด Ctrl+C เพื่อปิด")

    if args.window:
        try:
            import webview   # pip install pywebview  (ไม่บังคับ)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            webview.create_window("Off Road", local_url, width=1280, height=800, background_color="#000000")
            webview.start()
            return
        except ImportError:
            print("  (ไม่พบ pywebview — เปิดด้วยเบราว์เซอร์แทน)")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(local_url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nปิดระบบ")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
