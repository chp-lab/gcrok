@echo off
REM สร้างโฟลเดอร์โปรแกรมพร้อมใช้ (dist\OffRoad\OffRoad.exe) — รันครั้งเดียวขณะมีอินเทอร์เน็ต แล้วคัดลอกโฟลเดอร์ไปใช้ออฟไลน์
REM ต้องมี Python 3.11+ ; ไม่มี dependency ตอนรันโปรแกรม (PyInstaller ใช้ตอน build เท่านั้น)
cd /d "%~dp0\.."
python -m pip install --upgrade pyinstaller || exit /b 1
python -m PyInstaller --noconfirm --name OffRoad --onedir --console ^
  --add-data "web;web" --add-data "offroad\schema.sql;offroad" run.py || exit /b 1
xcopy /E /I /Y knowledge dist\OffRoad\knowledge >nul
echo.
echo เสร็จแล้ว: dist\OffRoad\OffRoad.exe  (ข้อมูลจะถูกสร้างที่ dist\OffRoad\data)
