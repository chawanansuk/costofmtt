import { db } from "./db";
import type { ReceiptRecord, ItemRecord } from "./types";

// CSV มี BOM เพื่อให้ Excel เปิดภาษาไทยได้ถูกต้อง
function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const today = () => new Date().toISOString().slice(0, 10);

export async function exportReceiptsCsv() {
  const receipts = await db.receipts.orderBy("createdAt").toArray();
  const rows: (string | number | null)[][] = [
    [
      "วันที่เอกสาร", "เลขที่เอกสาร", "ประเภท", "ผู้ขาย", "เลขผู้เสียภาษีผู้ขาย",
      "สาขา", "ยอดก่อน VAT", "ส่วนลด", "VAT", "ยอดสุทธิ", "ขอคืน VAT ได้",
      "สถานะจ่าย", "ครบกำหนดชำระ", "หมายเหตุ",
    ],
    ...receipts.map((r) => [
      r.docDate, r.docNumber, r.documentType, r.sellerName, r.sellerTaxId,
      r.sellerBranch, r.subtotal, r.discount, r.vatAmount, r.total,
      r.vatClaimable ? "ใช่" : "ไม่",
      r.paid === true ? "จ่ายแล้ว" : r.paid === false ? "ค้างจ่าย" : "",
      r.dueDate, r.notes,
    ]),
  ];
  download(toCsv(rows), `costsnap-receipts-${today()}.csv`, "text/csv;charset=utf-8");
}

export async function exportItemsCsv() {
  const { CATEGORY_LABEL } = await import("./format");
  const items = await db.items.toArray();
  const rows: (string | number | null)[][] = [
    ["วันที่", "ผู้ขาย", "รายการ", "หมวดหมู่", "จำนวน", "หน่วย", "ราคา/หน่วย", "รวม"],
    ...items.map((it) => [
      it.docDate, it.sellerName, it.description,
      it.category ? CATEGORY_LABEL[it.category] ?? it.category : "",
      it.quantity, it.unit, it.unitPrice, it.amount,
    ]),
  ];
  download(toCsv(rows), `costsnap-items-${today()}.csv`, "text/csv;charset=utf-8");
}

// ---------- Backup / Restore (JSON รวมรูปภาพ base64) ----------

interface BackupFile {
  app: "costsnap";
  version: 1;
  exportedAt: string;
  receipts: (Omit<ReceiptRecord, "imageBlob"> & { imageBase64?: string })[];
  items: ItemRecord[];
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// สถานะการสำรองล่าสุด — ใช้ตัดสินใจแสดงป้ายเตือนบนแดชบอร์ด
export interface BackupMarker {
  at: number; // epoch ms
  count: number; // จำนวนใบตอนสำรอง
}

export function getBackupMarker(): BackupMarker | null {
  try {
    const raw = localStorage.getItem("costsnap:lastBackup");
    return raw ? (JSON.parse(raw) as BackupMarker) : null;
  } catch {
    return null;
  }
}

export async function exportBackup() {
  const receipts = await db.receipts.toArray();
  const items = await db.items.toArray();

  const backup: BackupFile = {
    app: "costsnap",
    version: 1,
    exportedAt: new Date().toISOString(),
    receipts: await Promise.all(
      receipts.map(async ({ imageBlob, ...rest }) => ({
        ...rest,
        imageBase64: imageBlob ? await blobToBase64(imageBlob) : undefined,
      }))
    ),
    items,
  };
  download(
    JSON.stringify(backup),
    `costsnap-backup-${today()}.json`,
    "application/json"
  );
  try {
    localStorage.setItem(
      "costsnap:lastBackup",
      JSON.stringify({ at: Date.now(), count: receipts.length } satisfies BackupMarker)
    );
  } catch {}
}

export async function importBackup(file: File): Promise<{ receipts: number; items: number }> {
  const text = await file.text();
  const backup = JSON.parse(text) as BackupFile;
  if (backup.app !== "costsnap" || !Array.isArray(backup.receipts)) {
    throw new Error("ไฟล์นี้ไม่ใช่ไฟล์สำรองของ CostSnap");
  }

  await db.transaction("rw", db.receipts, db.items, async () => {
    await db.items.clear();
    await db.receipts.clear();

    // เก็บ mapping id เดิม → id ใหม่ เพื่อผูก items กลับให้ถูกใบ
    const idMap = new Map<number, number>();
    for (const r of backup.receipts) {
      const { imageBase64, id: oldId, ...rest } = r;
      const newId = await db.receipts.add({
        ...rest,
        imageBlob: imageBase64
          ? base64ToBlob(imageBase64, rest.imageType ?? "image/jpeg")
          : undefined,
      });
      if (oldId != null) idMap.set(oldId, newId as number);
    }
    await db.items.bulkAdd(
      backup.items.map(({ id: _id, ...it }) => ({
        ...it,
        receiptId: idMap.get(it.receiptId) ?? it.receiptId,
      }))
    );
  });

  return { receipts: backup.receipts.length, items: backup.items.length };
}

export async function clearAllData() {
  await db.transaction("rw", db.receipts, db.items, async () => {
    await db.items.clear();
    await db.receipts.clear();
  });
}
