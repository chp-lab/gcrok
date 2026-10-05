-- Off Road : SQLite schema v1
-- เวลาทุกคอลัมน์เก็บเป็น ISO-8601 ตามเวลาท้องถิ่นของเครื่อง (เช่น 2026-10-05T14:30:00+07:00)
-- ตาราง FTS (kb_fts) สร้างจาก db.py เพราะต้องเลือก tokenizer ตามเวอร์ชัน SQLite

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ───────────────────────── Module 1 : เสบียง & พลังงาน ─────────────────────────
-- daily_use = ปริมาณที่ใช้ต่อวัน "ถ้าใช้ชนิดนี้เพียงอย่างเดียว"
-- จำนวนวันของหมวด = Σ (qty_remaining / daily_use) ของทุกรายการในหมวด (สินค้าทดแทนกันได้)
CREATE TABLE supplies (
    id            INTEGER PRIMARY KEY,
    category      TEXT NOT NULL CHECK (category IN ('water','food','gas','fuel')),
    name          TEXT NOT NULL,
    unit          TEXT NOT NULL,
    qty_initial   REAL NOT NULL DEFAULT 0 CHECK (qty_initial   >= 0),
    qty_remaining REAL NOT NULL DEFAULT 0 CHECK (qty_remaining >= 0),
    daily_use     REAL NOT NULL DEFAULT 0 CHECK (daily_use     >= 0),
    note          TEXT,
    updated_at    TEXT NOT NULL
);

CREATE TABLE supply_log (
    id        INTEGER PRIMARY KEY,
    supply_id INTEGER NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
    ts        TEXT NOT NULL,
    delta     REAL NOT NULL,           -- ลบ = ใช้ไป, บวก = เติม
    note      TEXT
);

-- Power Station เครื่องเดียว (id = 1)
CREATE TABLE power_station (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    name           TEXT NOT NULL,
    capacity_wh    REAL NOT NULL CHECK (capacity_wh > 0),
    soc_pct        REAL NOT NULL CHECK (soc_pct BETWEEN 0 AND 100),
    reserve_pct    REAL NOT NULL DEFAULT 10 CHECK (reserve_pct BETWEEN 0 AND 100),
    inverter_eff   REAL NOT NULL DEFAULT 0.9 CHECK (inverter_eff BETWEEN 0.3 AND 1),
    solar_peak_w   REAL NOT NULL DEFAULT 650 CHECK (solar_peak_w >= 0),
    solar_derate   REAL NOT NULL DEFAULT 0.75 CHECK (solar_derate BETWEEN 0 AND 1),
    peak_sun_hours REAL NOT NULL DEFAULT 4.5 CHECK (peak_sun_hours >= 0),  -- วันแดดจัด
    updated_at     TEXT NOT NULL
);

CREATE TABLE power_loads (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    watts         REAL NOT NULL CHECK (watts >= 0),
    hours_per_day REAL NOT NULL CHECK (hours_per_day BETWEEN 0 AND 24),
    enabled       INTEGER NOT NULL DEFAULT 1,
    note          TEXT
);

-- พยากรณ์แสงแดดรายวัน (ใส่เอง/จากวิทยุ) วันที่ไม่มีข้อมูลใช้ settings.solar_default_condition
CREATE TABLE solar_forecast (
    day       TEXT PRIMARY KEY,        -- YYYY-MM-DD
    condition TEXT NOT NULL CHECK (condition IN ('sunny','partly','cloudy','rain','storm'))
);

CREATE TABLE power_log (
    id      INTEGER PRIMARY KEY,
    ts      TEXT NOT NULL,
    soc_pct REAL NOT NULL,
    note    TEXT
);

-- ───────────────────────── Module 2 : อุปกรณ์ & SIM ─────────────────────────
CREATE TABLE devices (
    id                INTEGER PRIMARY KEY,
    name              TEXT NOT NULL,
    kind              TEXT NOT NULL CHECK (kind IN ('phone','tablet','laptop','pc')),
    model             TEXT,
    role              TEXT,
    battery_pct       INTEGER CHECK (battery_pct BETWEEN 0 AND 100),         -- PC = NULL
    battery_health_pct INTEGER CHECK (battery_health_pct BETWEEN 0 AND 100),
    power_state       TEXT NOT NULL DEFAULT 'off'
                      CHECK (power_state IN ('on','off','charging','standby')),
    note              TEXT,
    updated_at        TEXT NOT NULL
);

CREATE TABLE sims (
    id           INTEGER PRIMARY KEY,
    carrier      TEXT NOT NULL CHECK (carrier IN ('AIS','True')),
    label        TEXT NOT NULL,
    msisdn       TEXT,
    device_id    INTEGER REFERENCES devices(id) ON DELETE SET NULL,
    actual_state TEXT NOT NULL DEFAULT 'off' CHECK (actual_state IN ('on','off')),
    expires_on   TEXT,                 -- วันหมดอายุแพ็กเกจ/ซิม (YYYY-MM-DD)
    note         TEXT
);

-- ตารางเวลาเปิด-ปิด: sim_power = เปิดซิม, hotspot = เปิดฮอตสปอตของอุปกรณ์
-- ช่วงที่ end <= start ถือว่าข้ามเที่ยงคืน; days = 7 ตัวอักษร จันทร์..อาทิตย์ ('1' = ทำงาน)
CREATE TABLE schedules (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('sim_power','hotspot')),
    sim_id     INTEGER REFERENCES sims(id)    ON DELETE CASCADE,
    device_id  INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    start_hhmm TEXT NOT NULL CHECK (start_hhmm GLOB '[0-2][0-9]:[0-5][0-9]'),
    end_hhmm   TEXT NOT NULL CHECK (end_hhmm   GLOB '[0-2][0-9]:[0-5][0-9]'),
    days       TEXT NOT NULL DEFAULT '1111111' CHECK (days GLOB '[01][01][01][01][01][01][01]'),
    enabled    INTEGER NOT NULL DEFAULT 1,
    CHECK ((kind = 'sim_power' AND sim_id    IS NOT NULL) OR
           (kind = 'hotspot'   AND device_id IS NOT NULL))
);

-- ───────────────────────── Module 3 : คลังความรู้ ─────────────────────────
CREATE TABLE kb_docs (
    id         INTEGER PRIMARY KEY,
    path       TEXT NOT NULL UNIQUE,   -- path สัมพัทธ์จากโฟลเดอร์ knowledge/ (ใช้ / เสมอ)
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('md','html','txt','pdf')),
    category   TEXT NOT NULL DEFAULT '',
    size       INTEGER NOT NULL DEFAULT 0,
    mtime      REAL NOT NULL DEFAULT 0,
    indexed_at TEXT NOT NULL
);
-- kb_fts(title, body) : FTS5 โดย rowid = kb_docs.id (สร้างใน db.py)

-- ───────────────────────── Module 4 : บันทึกเหตุการณ์ & Checklist ─────────────────────────
CREATE TABLE events (
    id     INTEGER PRIMARY KEY,
    ts     TEXT NOT NULL,
    kind   TEXT NOT NULL CHECK (kind IN
           ('water_gate','water_indoor','breaker','solar','power','supply','health','comms','note')),
    value  REAL,
    unit   TEXT,
    text   TEXT,
    author TEXT
);
CREATE INDEX idx_events_ts   ON events(ts DESC);
CREATE INDEX idx_events_kind ON events(kind, ts DESC);

CREATE TABLE phases (
    level   INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 3),
    name    TEXT NOT NULL,
    flag    TEXT NOT NULL CHECK (flag IN ('yellow','orange','red')),
    summary TEXT
);

CREATE TABLE checklist_items (
    id      INTEGER PRIMARY KEY,
    level   INTEGER NOT NULL REFERENCES phases(level) ON DELETE CASCADE,
    seq     INTEGER NOT NULL,
    text    TEXT NOT NULL,
    done    INTEGER NOT NULL DEFAULT 0,
    done_at TEXT
);
CREATE INDEX idx_items_level ON checklist_items(level, seq);
