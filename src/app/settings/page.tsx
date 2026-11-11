"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { summarizeUsage, PRICE_USD_PER_MTOK, USD_TO_THB } from "@/lib/usage";
import { baht } from "@/lib/format";
import { setCostBasis, readCostBasis, type CostBasis } from "@/lib/costbasis";
import { postApi, ApiError } from "@/lib/api";
import {
  exportReceiptsCsv,
  exportItemsCsv,
  exportBackup,
  importBackup,
  clearAllData,
  shrinkAllImages,
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

  const usageRecords = useLiveQuery(() => db.usage.toArray(), []);
  const ai = usageRecords ? summarizeUsage(usageRecords) : null;

  const [costBasis, setBasisState] = useState<CostBasis>("inc");
  const [passcode, setPasscode] = useState("");
  const [myShop, setMyShop] = useState("");
  const [storageInfo, setStorageInfo] = useState<{
    persisted: boolean;
    usageMB: number;
  } | null>(null);
  useEffect(() => {
    setBasisState(readCostBasis());
    try {
      setPasscode(localStorage.getItem("costsnap:passcode") ?? "");
      setMyShop(localStorage.getItem("costsnap:myshop") ?? "");
    } catch {
      // เบราว์เซอร์บล็อก localStorage — ปล่อยช่องว่างไว้
    }
    (async () => {
      try {
        const persisted = (await navigator.storage?.persisted?.()) ?? false;
        const est = await navigator.storage?.estimate?.();
        setStorageInfo({
          persisted,
          usageMB: (est?.usage ?? 0) / 1048576,
        });
      } catch {
        // เบราว์เซอร์เก่าไม่รองรับ — ไม่ต้องแสดง
      }
    })();
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
  function pickCostBasis(v: CostBasis) {
    setBasisState(v);
    setCostBasis(v);
    setErr(null);
    setMsg(
      v === "inc"
        ? "ต้นทุนสินค้าจะคิดแบบรวม VAT (เงินที่จ่ายจริง)"
        : "ต้นทุนสินค้าจะคิดแบบก่อน VAT (สำหรับร้านที่ขอคืนภาษีซื้อ)"
    );
  }

  // บันทึกแล้วถามเซิร์ฟเวอร์ทันทีว่ารหัสถูกไหม (ไม่เรียก AI ไม่มีค่าใช้จ่าย)
  // เดิมต้องรอไปสแกนจริงถึงจะรู้ว่าใส่รหัสผิด
  async function savePasscode() {
    setErr(null);
    setMsg(null);
    const code = passcode.trim();
    try {
      if (code) localStorage.setItem("costsnap:passcode", code);
      else localStorage.removeItem("costsnap:passcode");
    } catch {
      setErr("เบราว์เซอร์นี้ไม่ยอมให้บันทึกข้อมูล (อาจเปิดโหมดส่วนตัวอยู่) — บันทึกรหัสไม่ได้");
      return;
    }
    setBusy(true);
    try {
      const r = await postApi<{ passcodeRequired: boolean }>("/api/check", {}, "ตรวจรหัสไม่สำเร็จ");
      if (code) {
        setMsg(
          r.passcodeRequired
            ? "รหัสถูกต้อง — เครื่องนี้สแกนและถาม AI ได้แล้ว"
            : "บันทึกรหัสแล้ว (เซิร์ฟเวอร์นี้ไม่ได้ตั้งรหัสไว้ จึงใช้ได้เลยโดยไม่ต้องใส่)"
        );
      } else {
        setMsg("ลบรหัสออกจากเครื่องนี้แล้ว — เซิร์ฟเวอร์ไม่ได้ตั้งรหัสไว้ ยังใช้งานได้");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setErr(
          code
            ? "รหัสไม่ตรงกับที่ตั้งไว้บนเซิร์ฟเวอร์ — ตรวจตัวพิมพ์เล็ก-ใหญ่และขีดคั่นแล้วลองใหม่ (เครื่องนี้ยังสแกนไม่ได้)"
            : "ลบรหัสแล้ว แต่เซิร์ฟเวอร์ตั้งรหัสไว้ — เครื่องนี้จะสแกนและถาม AI ไม่ได้จนกว่าจะใส่รหัส"
        );
      } else if (e instanceof ApiError && e.status === 0) {
        setMsg("บันทึกรหัสแล้ว แต่ยังตรวจกับเซิร์ฟเวอร์ไม่ได้เพราะไม่มีอินเทอร์เน็ต");
      } else {
        setErr(e instanceof Error ? e.message : "ตรวจรหัสไม่สำเร็จ");
      }
    } finally {
      setBusy(false);
    }
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
        <div className="card-title">รหัสผ่านแอป</div>
        <p className="muted small" style={{ marginBottom: 10 }}>
          ต้องใส่รหัสนี้ทุกเครื่องที่จะสแกนหรือถาม AI — กันคนอื่นที่รู้ลิงก์มาใช้ AI ของร้าน
          กดบันทึกแล้วระบบจะตรวจให้ทันทีว่ารหัสถูก รหัสเก็บอยู่ในเครื่องนี้เท่านั้น
        </p>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <input
              type="password"
              placeholder="รหัสผ่านแอป"
              aria-label="รหัสผ่านแอป"
              autoComplete="off"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" onClick={savePasscode} disabled={busy}>
            บันทึกและตรวจ
          </button>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-title">ต้นทุนสินค้าคิดรวม VAT ไหม</div>
        <p className="muted small" style={{ marginBottom: 10 }}>
          มีผลกับต้นทุนต่อหน่วยในหน้าสินค้า หน้าเอกสาร การเตือนราคาขึ้น และการถาม AI
          (ยอดเงินของใบเอกสารไม่เปลี่ยน) ระบบเก็บไว้ทั้งสองแบบ สลับได้ตลอด
          ไม่ต้องสแกนใหม่
        </p>
        <div className="seg seg-block" role="group" aria-label="ฐานการคิดต้นทุน">
          <button
            className={`seg-item ${costBasis === "inc" ? "active" : ""}`}
            aria-pressed={costBasis === "inc"}
            onClick={() => pickCostBasis("inc")}
          >
            รวม VAT
          </button>
          <button
            className={`seg-item ${costBasis === "ex" ? "active" : ""}`}
            aria-pressed={costBasis === "ex"}
            onClick={() => pickCostBasis("ex")}
          >
            ก่อน VAT
          </button>
        </div>
        <p className="caption mt-2">
          {costBasis === "inc"
            ? "รวม VAT = เงินที่จ่ายจริงต่อหน่วย"
            : "ก่อน VAT = สำหรับร้านที่ขอคืนภาษีซื้อได้"}
        </p>
        <p className="muted small mt-2">
          ถ้าร้านจดทะเบียน VAT และนำภาษีซื้อไปหักในแบบ ภ.พ.30 ได้
          VAT จะไม่ใช่ต้นทุนจริง ควรเลือก &quot;ก่อน VAT&quot; ไม่งั้นจะคิดต้นทุนสูงเกินไป 7%
          (ไม่ใช่คำแนะนำทางภาษี — ถ้าไม่แน่ใจให้ถามนักบัญชี)
        </p>
      </div>

      <div className="card mt-3">
        <div className="card-title">ค่าใช้จ่าย AI</div>
        {usageRecords && usageRecords.length === 0 ? (
          <p className="muted small">
            ยังไม่มีการใช้งาน AI บนเครื่องนี้ — ตัวเลขจะขึ้นหลังสแกนใบแรก
          </p>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat">
                <div className="label">ค่า AI เดือนนี้</div>
                <div className="value">{ai ? baht(ai.monthCostTHB) : "…"}</div>
                <div className="hint">บาท (โดยประมาณ)</div>
              </div>
              <div className="stat">
                <div className="label">ใช้งานเดือนนี้</div>
                <div className="value">{ai ? ai.monthScans : "…"}</div>
                <div className="hint">
                  ใบที่สแกน{ai && ai.monthAsks > 0 ? ` · ถาม AI ${ai.monthAsks} ครั้ง` : ""}
                </div>
              </div>
              <div className="stat">
                <div className="label">เฉลี่ยต่อใบ</div>
                <div className="value">{ai ? baht(ai.avgPerScanTHB) : "…"}</div>
                <div className="hint">บาท/ใบ</div>
              </div>
              <div className="stat">
                <div className="label">รวมทั้งหมด</div>
                <div className="value">{ai ? baht(ai.totalCostTHB) : "…"}</div>
                <div className="hint">บาท · {ai?.totalScans ?? 0} ใบ</div>
              </div>
            </div>
            <p className="muted small mt-3">
              ประมาณการจากจำนวน token ที่ใช้จริง คูณราคาโมเดล (input{" "}
              {PRICE_USD_PER_MTOK.input}$ / output {PRICE_USD_PER_MTOK.output}$ ต่อล้าน token)
              ที่อัตรา {USD_TO_THB} บาท/ดอลลาร์ — ใช้ดูแนวโน้ม ไม่ใช่ยอดเรียกเก็บจริง
              และนับเฉพาะการใช้งานบนเครื่องนี้
            </p>
          </>
        )}
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
          — รูปที่สแกนใหม่จะถูกเก็บแบบย่อ (1600px) อยู่แล้ว ส่วนใบเก่ากดปุ่มย่อได้
        </p>
        {storageInfo && (
          <p className="muted small" style={{ marginBottom: 10 }}>
            พื้นที่ที่ใช้: {storageInfo.usageMB.toFixed(1)} MB ·{" "}
            {storageInfo.persisted ? (
              <span style={{ color: "var(--ok)" }}>
                ✓ เบราว์เซอร์รับปากว่าจะไม่ลบข้อมูลเอง
              </span>
            ) : (
              <span style={{ color: "var(--warn)" }}>
                ⚠️ เบราว์เซอร์อาจลบข้อมูลเองได้ถ้าพื้นที่เต็ม — ควรสำรองสม่ำเสมอ
                (ติดตั้งแอปลงหน้าจอโฮมช่วยลดความเสี่ยง)
              </span>
            )}
          </p>
        )}
        <div className="stack">
          <button
            className="btn btn-secondary btn-block"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await shrinkAllImages();
                setMsg(
                  r.done === 0
                    ? "รูปทั้งหมดเล็กพออยู่แล้ว ไม่มีอะไรต้องย่อ"
                    : `ย่อรูปแล้ว ${r.done} ใบ ประหยัดพื้นที่ ${r.savedMB.toFixed(1)} MB`
                );
              })
            }
          >
            🗜️ ย่อรูปเอกสารเก่าให้เล็กลง
          </button>
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
            accept=".json,application/json"
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
