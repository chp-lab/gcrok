# Off Road — สถาปัตยกรรม

## 1. ทำไมเลือก Python (stdlib) + SQLite + Web UI ในเครื่อง

| เกณฑ์ | Electron/Tauri + React | **Python + Web UI (เลือก)** | C# WPF (.NET) |
|---|---|---|---|
| RAM ตอนว่าง | 150–300 MB (Electron) / ~50 MB (Tauri) | **~25–40 MB** | ~40–60 MB |
| ต้องติดตั้งอะไรเพิ่ม | Node/Rust toolchain, npm packages | **ไม่มี (stdlib ล้วน)** | .NET SDK/Runtime |
| Module 5 (LAN เว็บ) | ต้องเขียนเซิร์ฟเวอร์เพิ่ม | **ได้ฟรี — UI ตัวเดียวกัน** | ต้องเขียน UI ซ้ำเป็นเว็บ |
| แก้ไขเองตอนวิกฤต | build ซับซ้อน | **แก้ไฟล์ .py/.js แล้วรันได้เลย** | ต้อง build |
| แพ็กเป็น .exe | ได้ | ได้ (PyInstaller) | ได้ |

หลักคิด: **หน้าเว็บเดียว ใช้ได้ทั้งเดสก์ท็อปและแท็บเล็ต/มือถือผ่าน Wi-Fi Hotspot** และไม่มีการเรียกเครือข่ายภายนอกเลย
(ไม่มี CDN/ฟอนต์ออนไลน์ — ตรวจแล้วด้วย Playwright ว่า external requests = 0)

```
 เบราว์เซอร์/หน้าต่างแอป ──HTTP/JSON──▶  offroad.server (ThreadingHTTPServer)
 (เครื่องนี้ + LAN)                         │ routes → services/calc/kb
                                           ▼
                                   SQLite (WAL) + FTS5 trigram     knowledge/*.md|html|txt|pdf
```

## 2. การประหยัดพลังงาน
- ไม่มี polling ฝั่งเซิร์ฟเวอร์ / ไม่มี background thread: ตอนว่าง CPU ≈ 0%
- ไม่เขียน access log ลงดิสก์; SQLite `journal_mode=WAL`, `synchronous=NORMAL`
- หน้าเว็บรีเฟรชแดชบอร์ดทุก 30 วิ **เฉพาะเมื่อแท็บมองเห็นอยู่และไม่ได้กำลังพิมพ์**
- Dark mode พื้นดำสนิท (#000), ไม่มี animation (เคารพ prefers-reduced-motion)

## 3. โครงสร้างโฟลเดอร์
```
offroad/
├─ run.py                  # ตัวเปิดโปรแกรม (--port --local-only --no-browser --window)
├─ offroad/
│  ├─ schema.sql           # โครงสร้างฐานข้อมูล v1
│  ├─ config.py            # path (พกพาได้: data/ และ knowledge/ อยู่ข้างโปรแกรม)
│  ├─ db.py  seed.py       # เชื่อมต่อ/สร้างฐานข้อมูลครั้งแรก + ข้อมูลตัวอย่าง
│  ├─ calc.py              # ตรรกะล้วน: burn-rate, จำลองแบต/โซลาร์, ตารางเวลา SIM
│  ├─ services.py          # รวมข้อมูลสำหรับแดชบอร์ด
│  ├─ kb.py                # สแกน/ทำดัชนี/ค้นหาเอกสาร (FTS5)
│  └─ server.py            # HTTP + JSON API + ความปลอดภัย LAN
├─ web/                    # index.html · style.css · app.js (vanilla, ไม่มี build step)
├─ knowledge/              # วางเอกสารที่นี่ (แบ่งโฟลเดอร์ย่อย = หมวด)
├─ data/                   # offroad.db (สร้างอัตโนมัติ, อยู่ใน .gitignore) → สำรองทั้งโฟลเดอร์นี้
├─ tests/                  # unittest (calc + API จริงบนพอร์ตสุ่ม)
└─ scripts/build_windows.bat
```

## 4. Database Schema (ย่อ — ดูรายละเอียด/CHECK ใน `offroad/schema.sql`)
```
settings(key,value)                     active_phase, warn_days, crit_days, solar_default_condition, lan_pin
── Module 1
supplies(category[water|food|gas|fuel], name, unit, qty_initial, qty_remaining, daily_use)
supply_log(supply_id→supplies, ts, delta)
power_station(id=1, capacity_wh, soc_pct, reserve_pct, inverter_eff, solar_peak_w, solar_derate, peak_sun_hours)
power_loads(name, watts, hours_per_day, enabled)
solar_forecast(day PK, condition[sunny|partly|cloudy|rain|storm])
power_log(ts, soc_pct)
── Module 2
devices(name, kind[phone|tablet|laptop|pc], battery_pct, battery_health_pct, power_state, role)
sims(carrier[AIS|True], label, device_id→devices, actual_state, expires_on)
schedules(kind[sim_power|hotspot], sim_id|device_id, start_hhmm, end_hhmm, days '1111111', enabled)
── Module 3
kb_docs(path UNIQUE, title, kind[md|html|txt|pdf], category, mtime)    kb_fts(title, body)  -- FTS5 trigram, rowid = kb_docs.id
── Module 4
events(ts, kind[water_gate|water_indoor|breaker|solar|power|supply|health|comms|note], value, unit, text)
phases(level 1..3, name, flag[yellow|orange|red])   checklist_items(level→phases, seq, text, done, done_at)
```

### สูตรสำคัญ
- **เสบียง:** `daily_use` = ปริมาณใช้/วัน *ถ้าใช้ชนิดนี้อย่างเดียว* → วันของหมวด = Σ `remaining / daily_use`
  (น้ำถังหลังคา + น้ำขวด, อาหารหลายชนิด ฯลฯ ทดแทนกันได้)
- **พลังงาน:** ทุกวัน `E ← min(ความจุ, E + โซลาร์ − โหลด/ประสิทธิภาพอินเวอร์เตอร์)`,
  โซลาร์ = `solar_peak_w × derate × peak_sun_hours × ตัวคูณสภาพอากาศ (1.0/0.6/0.3/0.15/0.05)`;
  วันคงเหลือ = จุดที่ E แตะ reserve (ประมาณค่าเป็นทศนิยม). ค่าตั้งต้นเป็น *ค่าประมาณ* — ปรับให้ตรงกับของจริงจากการวัดหน้างาน
- **ตารางซิม/Hotspot:** รองรับช่วงข้ามเที่ยงคืน, หน้ากากวัน (จ→อา), ช่วงซ้อนกันรวมเป็นช่วงเดียว; แจ้งเตือนเมื่อสถานะจริงไม่ตรงตาราง
- **ค้นหา:** FTS5 `trigram` ค้นภาษาไทยแบบ substring ได้ (ไทยไม่มีช่องว่างคั่นคำ) · คำสั้นกว่า 3 ตัวอักษรใช้ LIKE สำรอง · PDF ค้นได้เฉพาะชื่อไฟล์ (ไม่มีไลบรารีอ่าน PDF แบบออฟไลน์ใน stdlib)

## 5. ความปลอดภัยของ LAN Server
- เครื่องหลัก (127.0.0.1): อ่าน/เขียนได้เต็มที่
- อุปกรณ์อื่นใน LAN: **อ่านได้ แก้ไขต้องมี PIN** (สุ่ม 6 หลักตอนติดตั้ง แสดงในคอนโซล เก็บใน `settings.lan_pin`)
- คำขอเขียนที่ `Origin` ไม่ตรง `Host` ถูกปฏิเสธ; เอกสาร HTML ใน KB เปิดใน iframe sandbox
- ป้องกัน path traversal ทั้งไฟล์เว็บและ `knowledge/`
- ใช้ `--local-only` เพื่อปิดการเข้าถึงจาก LAN ทั้งหมด

## 6. Roadmap ที่แนะนำ
1. **ผูกเสบียงกับบันทึกเหตุการณ์** (ใช้น้ำ/แก๊ส → สร้าง event อัตโนมัติ) และกราฟแนวโน้ม SoC จาก `power_log`
2. เฟสอัตโนมัติจากระดับน้ำ (ตั้งเกณฑ์ cm → แนะนำเลื่อนเฟส)
3. นำเข้า/ส่งออกข้อมูล (JSON) + สำรองอัตโนมัติไป USB
4. อ่าน PDF แบบออฟไลน์ (เพิ่ม `pypdf` ที่เป็นทางเลือก) และ OCR แผนที่
5. แจ้งเตือนเสียง/ป๊อปอัปเมื่อถึงเวลาเปิดซิม/ฮอตสปอต (ตอนนี้แสดงบนแดชบอร์ด)
6. หน้าต่างแอปแบบ native (`python run.py --window` ใช้ pywebview ถ้าติดตั้งไว้)
