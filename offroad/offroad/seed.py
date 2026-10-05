"""ข้อมูลตั้งต้น (ตัวอย่าง) — ปริมาณเสบียง/กำลังไฟเป็นค่าสมมติ ให้แก้ให้ตรงกับบ้านจริงในแอป."""
import secrets

from .db import now_iso

SAMPLE = "ตัวอย่าง — แก้ไขตามจริง"

SUPPLIES = [  # category, name, unit, initial, remaining, daily_use
    ("water", "ถังน้ำดาดฟ้า (gravity-feed)", "ลิตร", 1000, 1000, 40),
    ("water", "น้ำดื่มขวด", "ลิตร", 90, 90, 8),
    ("food", "อาหารสำเร็จรูป MRE", "ซอง", 30, 30, 9),
    ("food", "อาหารกระป๋อง", "กระป๋อง", 40, 40, 12),
    ("food", "อาหารแห้ง (ข้าวสาร/เส้น)", "กก.", 15, 15, 2),
    ("gas", "แก๊สกระป๋องปิกนิก", "กระป๋อง", 12, 12, 1),
    ("fuel", "ไฟแช็ก / เชื้อเพลิงสำรอง", "ชิ้น", 10, 10, 0),
]

LOADS = [  # name, watts, hours, enabled
    ("ชาร์จสมาร์ทโฟน (4 เครื่อง)", 40, 2, 1),
    ("ชาร์จแท็บเล็ต (2 เครื่อง)", 20, 2, 1),
    ("แล็ปท็อป (3 เครื่อง)", 180, 3, 1),
    ("ไฟ LED", 20, 6, 1),
    ("พัดลม", 30, 6, 1),
    ("เราเตอร์ / ฮอตสปอตพกพา", 10, 6, 1),
    ("PC ตั้งโต๊ะ (2 เครื่อง) — ปิดไว้เพื่อประหยัดไฟ", 400, 1, 0),
]

DEVICES = (
    [(f"สมาร์ทโฟน {i}", "phone", 100) for i in range(1, 5)]
    + [(f"แท็บเล็ต {i}", "tablet", 100) for i in range(1, 3)]
    + [(f"แล็ปท็อป {i}", "laptop", 100) for i in range(1, 4)]
    + [(f"PC {i}", "pc", None) for i in range(1, 3)]
)

# (label, carrier, device index (1-based) ในลิสต์ DEVICES) — 6 ซิมกระจายบน 4 สมาร์ทโฟน
SIMS = [("AIS-1", "AIS", 1), ("True-1", "True", 1), ("AIS-2", "AIS", 2),
        ("True-2", "True", 2), ("AIS-3", "AIS", 3), ("True-3", "True", 4)]

PHASES = [
    (1, "ระดับ 1 เฝ้าระวัง", "yellow", "ติดตามสถานการณ์ เตรียมของ ชาร์จพลังงานให้เต็ม"),
    (2, "ระดับ 2 ปฏิบัติการ / ตัดระบบ", "orange", "ตัดไฟ-น้ำชั้น 1 ย้ายของขึ้นชั้น 2"),
    (3, "ระดับ 3 อยู่กับที่ (Lockdown)", "red", "ปฏิบัติการทั้งหมดบนชั้น 2 และระเบียง"),
]

CHECKLISTS = {
    1: [
        "ติดตามประกาศเตือนภัย/พยากรณ์ (วิทยุ, SMS, แอปที่แคชไว้) ทุก 3 ชม.",
        "อ่านระดับน้ำหน้าบ้านและบันทึกลงบันทึกเหตุการณ์ทุก 1–2 ชม.",
        "ชาร์จ Power Station และอุปกรณ์ทั้ง 11 ชิ้นให้เต็ม",
        "เติมถังน้ำดาดฟ้าให้เต็ม และสำรองน้ำดื่ม",
        "ย้ายเอกสารสำคัญ ยา อาหาร ไฟฉาย/ถ่าน ขึ้นชั้น 2",
        "นับเสบียง (น้ำ อาหาร แก๊ส) แล้วอัปเดตในแอป",
        "เตรียมกระสอบทราย/แผ่นกั้นน้ำ และตรวจตำแหน่งเบรกเกอร์/วาล์วน้ำ",
        "แจ้งญาติ/เพื่อนบ้านถึงแผนติดต่อ (ตารางเปิดซิม)",
    ],
    2: [
        "ปิดเบรกเกอร์วงจรชั้น 1 ก่อนน้ำถึงปลั๊ก — ห้ามแตะเมื่อมือเปียกหรือยืนในน้ำ",
        "ถอดปลั๊กอุปกรณ์ชั้น 1 และยกของขึ้นที่สูง",
        "ปิดวาล์วประปาเข้าบ้าน/ชั้น 1 และเปลี่ยนไปใช้น้ำจากถังดาดฟ้า",
        "ย้ายถังแก๊สและเตาขึ้นชั้น 2/ระเบียง",
        "ย้ายคน สัตว์เลี้ยง ยา เอกสาร ขึ้นชั้น 2",
        "เปิดใช้ตารางหมุนเวียนเปิด-ปิดซิม และตารางฮอตสปอต",
        "ติดตั้งส้วมแห้งและเตรียมปูนขาว/ขี้เลื่อย/ถุงหนา",
        "บันทึกเวลาที่ตัดไฟ/ตัดน้ำลงบันทึกเหตุการณ์",
    ],
    3: [
        "ย้ายปฏิบัติการทั้งหมดไปชั้น 2 และระเบียง",
        "เข้าโหมดประหยัดพลังงาน: ปิด PC ใช้แล็ปท็อป/มือถือเท่านั้น",
        "ครัวระเบียง: ใช้เตาแก๊สในที่โล่ง ระบายอากาศดี ห้ามใช้ในห้องปิด",
        "ใช้ส้วมแห้ง + ปูนขาว/ขี้เลื่อย ปิดถุงสองชั้นทุกครั้ง",
        "ต้ม/กรอง/ฆ่าเชื้อน้ำก่อนดื่มทุกครั้ง",
        "ตรวจสุขภาพสมาชิกและยาประจำตัว เช้า–เย็น",
        "ติดต่อสื่อสารตามรอบซิม แจ้งพิกัดและสถานะ",
        "เฝ้าระวังระดับน้ำ เตรียมแผนฉุกเฉิน (1669 / 1784) หากสถานการณ์เลวลง",
    ],
}


def seed(conn):
    ts = now_iso()
    s = conn.execute
    for k, v in {
        "active_phase": "1", "warn_days": "7", "crit_days": "3",
        "solar_default_condition": "partly",
        "lan_pin": f"{secrets.randbelow(10**6):06d}",   # PIN สำหรับเขียนข้อมูลจากอุปกรณ์ใน LAN
    }.items():
        s("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (k, v))

    for cat, name, unit, init, rem, use in SUPPLIES:
        s("INSERT INTO supplies(category,name,unit,qty_initial,qty_remaining,daily_use,note,updated_at)"
          " VALUES (?,?,?,?,?,?,?,?)", (cat, name, unit, init, rem, use, SAMPLE, ts))

    s("INSERT INTO power_station(id,name,capacity_wh,soc_pct,reserve_pct,inverter_eff,solar_peak_w,"
      "solar_derate,peak_sun_hours,updated_at) VALUES (1,'Lithium Power Station',2000,100,10,0.9,650,0.75,4.5,?)",
      (ts,))
    for name, w, h, en in LOADS:
        s("INSERT INTO power_loads(name,watts,hours_per_day,enabled,note) VALUES (?,?,?,?,?)",
          (name, w, h, en, SAMPLE))

    ids = []
    for name, kind, batt in DEVICES:
        cur = s("INSERT INTO devices(name,kind,battery_pct,battery_health_pct,power_state,updated_at)"
                " VALUES (?,?,?,?,?,?)",
                (name, kind, batt, None if batt is None else 100, "off", ts))
        ids.append(cur.lastrowid)
    for i, (label, carrier, dev_idx) in enumerate(SIMS):
        cur = s("INSERT INTO sims(carrier,label,device_id) VALUES (?,?,?)", (carrier, label, ids[dev_idx - 1]))
        # ค่าเริ่มต้น: เปิดซิมครั้งละ 30 นาที วันละ 3 รอบ สลับเหลื่อมกันซิมละ 10 นาที (แก้ไขได้)
        for hh in (7, 13, 19):
            start = hh * 60 + i * 10
            end = start + 30
            s("INSERT INTO schedules(kind,sim_id,start_hhmm,end_hhmm) VALUES ('sim_power',?,?,?)",
              (cur.lastrowid, f"{start // 60:02d}:{start % 60:02d}", f"{end // 60:02d}:{end % 60:02d}"))
    for hh in (7, 13, 19):  # ฮอตสปอตจากสมาร์ทโฟน 1 ตรงกับรอบซิม AIS-1
        s("INSERT INTO schedules(kind,device_id,start_hhmm,end_hhmm) VALUES ('hotspot',?,?,?)",
          (ids[0], f"{hh:02d}:00", f"{hh:02d}:30"))

    for level, name, flag, summary in PHASES:
        s("INSERT INTO phases(level,name,flag,summary) VALUES (?,?,?,?)", (level, name, flag, summary))
        for seq, text in enumerate(CHECKLISTS[level], 1):
            s("INSERT INTO checklist_items(level,seq,text) VALUES (?,?,?)", (level, seq, text))
    s("INSERT INTO events(ts,kind,text,author) VALUES (?, 'note', 'เริ่มใช้งาน Off Road', 'system')", (ts,))
