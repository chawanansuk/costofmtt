"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import {
  exportReceiptsCsv,
  exportItemsCsv,
  exportBackup,
  importBackup,
  clearAllData,
} from "@/lib/export";

export default function SettingsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useLiveQuery(async () => ({
    receipts: await db.receipts.count(),
    items: await db.items.count(),
  }), []);

  const [passcode, setPasscode] = useState("");
  const [myShop, setMyShop] = useState("");
  useEffect(() => {
    setPasscode(localStorage.getItem("costsnap:passcode") ?? "");
    setMyShop(localStorage.getItem("costsnap:myshop") ?? "");
  }, []);
  function saveMyShop() {
    if (myShop.trim()) {
      localStorage.setItem("costsnap:myshop", myShop.trim());
      setMsg("บันทึกชื่อร้านแล้ว — AI จะใช้แยกผู้ซื้อ/ผู้ขายให้แม่นขึ้น");
    } else {
      localStorage.removeItem("costsnap:myshop");
      setMsg("ลบชื่อร้านแล้ว");
    }
    setErr(null);
  }
  function savePasscode() {
    if (passcode.trim()) {
      localStorage.setItem("costsnap:passcode", passcode.trim());
      setMsg("บันทึกรหัสผ่านแอปแล้ว");
    } else {
      localStorage.removeItem("costsnap:passcode");
      setMsg("ลบรหัสผ่านแอปออกจากเครื่องนี้แล้ว");
    }
    setErr(null);
  }

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>ตั้งค่าและข้อมูล</h1>
          <p className="page-sub">
            ข้อมูลทั้งหมดเก็บอยู่บนเครื่องนี้ ({counts?.receipts ?? 0} ใบ,{" "}
            {counts?.items ?? 0} รายการสินค้า)
          </p>
        </div>
      </div>

      {msg && <div className="alert alert-ok mt-2">✓ {msg}</div>}
      {err && <div className="alert alert-danger mt-2">{err}</div>}

      <div className="card mt-3">
        <div className="card-title">ชื่อร้านของฉัน (ผู้ซื้อ)</div>
        <p className="muted small" style={{ marginBottom: 10 }}>
          ใส่ชื่อร้านตามที่ผู้ขายมักเขียนบนบิล (เช่น &quot;ม.ทวีภัณฑ์&quot;) —
          AI จะรู้ว่าชื่อนี้คือผู้ซื้อเสมอ ช่วยให้อ่านบิลเขียนมือ/ใบส่งของแม่นขึ้นมาก
        </p>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <input
              placeholder="เช่น ม.ทวีภัณฑ์"
              value={myShop}
              onChange={(e) => setMyShop(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" onClick={saveMyShop}>
            บันทึก
          </button>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-title">รหัสผ่านแอป (สำหรับเซิร์ฟเวอร์ที่ตั้ง APP_PASSCODE)</div>
        <p className="muted small" style={{ marginBottom: 10 }}>
          ถ้าผู้ดูแลตั้งรหัสไว้ตอน deploy (env <code>APP_PASSCODE</code>)
          ให้ใส่รหัสเดียวกันที่นี่ เพื่อป้องกันคนอื่นแอบใช้ AI ของเรา
          รหัสเก็บอยู่ในเครื่องนี้เท่านั้น
        </p>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <input
              type="password"
              placeholder="ไม่ต้องใส่ถ้าเซิร์ฟเวอร์ไม่ได้ตั้งรหัส"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" onClick={savePasscode}>
            บันทึก
          </button>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-title">ส่งออกข้อมูล (เปิดใน Excel ได้)</div>
        <div className="stack">
          <button
            className="btn btn-secondary btn-block"
            disabled={busy}
            onClick={() => run(exportReceiptsCsv)}
          >
            📄 ส่งออกรายใบเอกสาร (CSV)
          </button>
          <button
            className="btn btn-secondary btn-block"
            disabled={busy}
            onClick={() => run(exportItemsCsv)}
          >
            📦 ส่งออกรายการสินค้า (CSV)
          </button>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-title">สำรอง / ย้ายเครื่อง</div>
        <p className="muted small" style={{ marginBottom: 10 }}>
          ไฟล์สำรอง (JSON) รวมข้อมูลและรูปภาพทั้งหมด ใช้กู้คืนหรือย้ายไปเครื่องใหม่ได้
        </p>
        <div className="stack">
          <button
            className="btn btn-secondary btn-block"
            disabled={busy}
            onClick={() => run(exportBackup)}
          >
            💾 ดาวน์โหลดไฟล์สำรองทั้งหมด
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (!confirm("การกู้คืนจะแทนที่ข้อมูลปัจจุบันทั้งหมด ดำเนินการต่อ?")) return;
              run(async () => {
                const r = await importBackup(f);
                setMsg(`กู้คืนสำเร็จ: ${r.receipts} ใบ, ${r.items} รายการ`);
              });
            }}
          />
          <button
            className="btn btn-secondary btn-block"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            📥 กู้คืนจากไฟล์สำรอง
          </button>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-title">อันตราย</div>
        <button
          className="btn btn-danger btn-block"
          disabled={busy}
          onClick={() => {
            if (!confirm("ลบข้อมูลทั้งหมดถาวร? แนะนำให้ดาวน์โหลดไฟล์สำรองก่อน")) return;
            if (!confirm("ยืนยันอีกครั้ง: ลบเอกสารและรายการสินค้าทั้งหมด?")) return;
            run(() => clearAllData(), "ลบข้อมูลทั้งหมดแล้ว");
          }}
        >
          🗑️ ลบข้อมูลทั้งหมด
        </button>
      </div>

      <div className="card mt-3">
        <div className="card-title">เกี่ยวกับ</div>
        <p className="muted small">
          CostSnap อ่านใบกำกับภาษีด้วย AI (Claude) — รูปถูกส่งไปประมวลผลชั่วคราวเท่านั้น
          ข้อมูลและรูปที่บันทึกเก็บอยู่ในเบราว์เซอร์เครื่องนี้ ไม่มีเซิร์ฟเวอร์กลางเก็บข้อมูลของคุณ
          การตรวจความครบถ้วนของใบกำกับภาษีอิงรายการตามมาตรา 86/4 แห่งประมวลรัษฎากร
          (ผลลัพธ์เป็นเพียงตัวช่วย ไม่ใช่คำแนะนำทางภาษี)
        </p>
      </div>
    </div>
  );
}
