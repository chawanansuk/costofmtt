"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { exportBackup, getBackupMarker } from "@/lib/export";

const FOURTEEN_DAYS = 14 * 24 * 3600 * 1000;

// เตือนให้สำรองข้อมูล — IndexedDB อาจถูกเบราว์เซอร์ลบเองได้
// เงื่อนไข: ไม่เคยสำรองและมี ≥5 ใบ / มีใบใหม่ ≥10 ใบนับจากสำรองล่าสุด /
// สำรองล่าสุดเกิน 14 วันและมีใบใหม่เพิ่ม
export default function BackupReminder() {
  const count = useLiveQuery(() => db.receipts.count(), []);
  const [dismissedAt, setDismissedAt] = useState(0); // บังคับ re-render หลังสำรอง
  const [busy, setBusy] = useState(false);

  if (!count) return null;
  const marker = getBackupMarker();
  void dismissedAt;

  const never = !marker;
  const newSince = marker ? count - marker.count : count;
  const stale = marker ? Date.now() - marker.at > FOURTEEN_DAYS : false;

  const shouldShow =
    (never && count >= 5) || newSince >= 10 || (stale && newSince > 0);
  if (!shouldShow) return null;

  return (
    <div className="alert alert-warn mt-3">
      <div className="row spread wrap">
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong>💾 อย่าลืมสำรองข้อมูล</strong>
          <div className="small mt-2">
            {never
              ? `มีเอกสาร ${count} ใบที่ยังไม่เคยสำรองเลย`
              : `มีเอกสารใหม่ ${newSince} ใบนับจากสำรองครั้งล่าสุด`}{" "}
            — ข้อมูลเก็บอยู่ในเครื่องนี้เท่านั้น ถ้าเครื่องหาย/เบราว์เซอร์ล้างข้อมูล จะกู้ไม่ได้
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await exportBackup();
              setDismissedAt(Date.now());
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "กำลังสำรอง…" : "ดาวน์โหลดไฟล์สำรอง"}
        </button>
      </div>
    </div>
  );
}
