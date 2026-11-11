import { db } from "./db";
import type { ReceiptRecord, ItemRecord } from "./types";
import { backfillIncVat, fixInclusiveExVat } from "./cost";
import { todayISO } from "./format";

// CSV มี BOM เพื่อให้ Excel เปิดภาษาไทยได้ถูกต้อง
function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

function download(content: string | Blob, filename: string, mime: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ถ้า revoke ทันที Safari/iOS บางรุ่นยังไม่ทันเริ่มบันทึกไฟล์ จะได้ไฟล์เปล่าหรือไม่ได้เลย
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const today = () => todayISO();

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
    [
      "วันที่", "ผู้ขาย", "รายการ", "หมวดหมู่", "จำนวนที่ซื้อ", "ของแถม", "หน่วย",
      "ต้นทุน/หน่วย (รวม VAT)", "รวม (รวม VAT)", "ต้นทุน/หน่วย (ก่อน VAT)", "รวม (ก่อน VAT)",
    ],
    ...items.map((it) => [
      it.docDate, it.sellerName, it.description,
      it.category ? CATEGORY_LABEL[it.category] ?? it.category : "",
      it.quantity, it.freeQuantity ?? 0, it.unit,
      it.unitPriceIncVat ?? it.unitPrice, it.amountIncVat ?? it.amount,
      it.unitPrice, it.amount,
    ]),
  ];
  download(toCsv(rows), `costsnap-items-${today()}.csv`, "text/csv;charset=utf-8");
}

// ---------- Backup / Restore (JSON รวมรูปภาพ base64) ----------
// ไฟล์ version 2 ยังเป็น JSON ปกติ แต่เขียน "หนึ่งเรคคอร์ดต่อหนึ่งบรรทัด":
//   {"app":"costsnap","version":2,"exportedAt":"…","receipts":[
//   {…ใบที่ 1…},
//   {…ใบที่ 2…}
//   ],"items":[
//   {…},
//   {…}
//   ]}
// เพื่อให้ทั้งตอนสำรองและตอนกู้คืนทำทีละใบได้ ไม่ต้องถือทั้งไฟล์เป็นข้อความก้อนเดียวในหน่วยความจำ
// (แบบเดิม JSON.stringify ทั้งก้อน — รูปราว 1,000 ใบจะเกินขนาดข้อความสูงสุดของเบราว์เซอร์ แล้วสำรองไม่ได้เลย)

type BackupReceipt = Omit<ReceiptRecord, "imageBlob"> & { imageBase64?: string };

const V2_HEAD = '{"app":"costsnap","version":2,';
const RECEIPT_BATCH = 20;
const ITEM_BATCH = 2000;

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

/** สร้างไฟล์สำรองเป็น Blob (แยกจากการดาวน์โหลด เพื่อให้ทดสอบ/นำไปใช้ต่อได้) */
export async function buildBackupBlob(): Promise<{ blob: Blob; receipts: number; items: number }> {
  const ids = (await db.receipts.toCollection().primaryKeys()) as number[];
  // ต่อ Blob ทีละชุด — เบราว์เซอร์เก็บ Blob นอกหน่วยความจำ JS ข้อความ base64 ของชุดก่อนจึงถูกคืนได้
  let blob = new Blob([
    `${V2_HEAD}"exportedAt":${JSON.stringify(new Date().toISOString())},"receipts":[\n`,
  ]);
  let written = 0;
  for (let i = 0; i < ids.length; i += RECEIPT_BATCH) {
    const batch = await db.receipts.bulkGet(ids.slice(i, i + RECEIPT_BATCH));
    const parts: string[] = [];
    for (const r of batch) {
      if (!r) continue;
      const { imageBlob, ...rest } = r;
      const line: BackupReceipt = {
        ...rest,
        imageBase64: imageBlob ? await blobToBase64(imageBlob) : undefined,
      };
      parts.push((written > 0 ? ",\n" : "") + JSON.stringify(line));
      written += 1;
    }
    blob = new Blob([blob, ...parts]);
  }

  blob = new Blob([blob, '\n],"items":[\n']);
  const items = await db.items.toArray();
  for (let i = 0; i < items.length; i += ITEM_BATCH) {
    const lines = items.slice(i, i + ITEM_BATCH).map((it) => JSON.stringify(it));
    blob = new Blob([blob, (i > 0 ? ",\n" : "") + lines.join(",\n")]);
  }
  blob = new Blob([blob, "\n]}\n"], { type: "application/json" });
  return { blob, receipts: written, items: items.length };
}

export async function exportBackup() {
  const { blob, receipts } = await buildBackupBlob();
  download(blob, `costsnap-backup-${today()}.json`, "application/json");
  try {
    localStorage.setItem(
      "costsnap:lastBackup",
      JSON.stringify({ at: Date.now(), count: receipts } satisfies BackupMarker)
    );
  } catch {}
}

const NOT_A_BACKUP = "ไฟล์นี้ไม่ใช่ไฟล์สำรองของ CostSnap";
const BROKEN_BACKUP =
  "ไฟล์สำรองไม่สมบูรณ์ (อาจดาวน์โหลด/คัดลอกไม่ครบ) — ข้อมูลเดิมในเครื่องยังอยู่ครบ ลองใช้ไฟล์สำรองอื่น";

// อ่านไฟล์ทีละบรรทัดโดยไม่โหลดทั้งไฟล์ (ใช้ slice + arrayBuffer ซึ่งรองรับทุกเบราว์เซอร์)
async function* readLines(file: Blob): AsyncGenerator<string> {
  const CHUNK = 4 * 1024 * 1024;
  const decoder = new TextDecoder();
  let carry = "";
  for (let off = 0; off < file.size; off += CHUNK) {
    carry += decoder.decode(await file.slice(off, off + CHUNK).arrayBuffer(), { stream: true });
    let nl: number;
    while ((nl = carry.indexOf("\n")) >= 0) {
      yield carry.slice(0, nl);
      carry = carry.slice(nl + 1);
    }
  }
  carry += decoder.decode();
  if (carry) yield carry;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// ไฟล์สำรองรุ่นเก่าอาจไม่มีบางช่อง — เติมค่าปลอดภัยให้ครบ ไม่งั้นหน้าที่อ่านช่องนั้นจะพัง
function reviveReceipt(raw: BackupReceipt): Omit<ReceiptRecord, "id"> {
  const { imageBase64, id: _id, ...rest } = raw as BackupReceipt & { id?: number };
  return {
    ...rest,
    createdAt: num(rest.createdAt) || Date.now(),
    documentType: rest.documentType ?? "other",
    subtotal: num(rest.subtotal),
    discount: num(rest.discount),
    vatAmount: num(rest.vatAmount),
    total: num(rest.total),
    vatClaimable: rest.vatClaimable === true,
    confidence: rest.confidence ?? "medium",
    warnings: Array.isArray(rest.warnings) ? rest.warnings : [],
    notes: rest.notes ?? null,
    imageBlob: imageBase64 ? base64ToBlob(imageBase64, rest.imageType ?? "image/jpeg") : undefined,
  };
}

export async function importBackup(file: File): Promise<{ receipts: number; items: number }> {
  const head = await file.slice(0, 200).text();
  const isV2 = head.startsWith(V2_HEAD);

  // ของเดิมในเครื่อง — ลบเป็นขั้นสุดท้ายหลังนำเข้าครบเท่านั้น ถ้าพลาดกลางทางข้อมูลเดิมต้องอยู่ครบ
  const oldReceiptIds = (await db.receipts.toCollection().primaryKeys()) as number[];
  const oldItemIds = (await db.items.toCollection().primaryKeys()) as number[];

  const idMap = new Map<number, number>(); // id ในไฟล์ → id ใหม่
  const money = new Map<number, { total: number; vatAmount: number }>(); // id ใหม่ → ยอดของใบ
  const newReceiptIds: number[] = [];
  const newItemIds: number[] = [];
  const rawItems: ItemRecord[] = [];

  let pending: BackupReceipt[] = [];
  const flushReceipts = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const records = batch.map(reviveReceipt);
    const ids = (await db.receipts.bulkAdd(records as ReceiptRecord[], {
      allKeys: true,
    })) as number[];
    ids.forEach((newId, i) => {
      newReceiptIds.push(newId);
      const oldId = (batch[i] as { id?: number }).id;
      if (oldId != null) idMap.set(oldId, newId);
      money.set(newId, { total: records[i].total, vatAmount: records[i].vatAmount });
    });
  };
  const pushReceipt = async (r: BackupReceipt) => {
    pending.push(r);
    if (pending.length >= RECEIPT_BATCH) await flushReceipts();
  };

  try {
    if (isV2) {
      let section: "head" | "receipts" | "items" | "done" = "head";
      for await (const rawLine of readLines(file)) {
        const line = rawLine.trim();
        if (line === "") continue;
        if (section === "head") {
          if (!line.startsWith(V2_HEAD)) throw new Error(NOT_A_BACKUP);
          section = "receipts";
        } else if (line === '],"items":[') {
          section = "items";
        } else if (line === "]}") {
          section = "done";
        } else {
          const obj = JSON.parse(line.endsWith(",") ? line.slice(0, -1) : line);
          if (section === "receipts") await pushReceipt(obj as BackupReceipt);
          else if (section === "items") rawItems.push(obj as ItemRecord);
        }
      }
      if (section !== "done") throw new Error(BROKEN_BACKUP);
    } else {
      // ไฟล์รุ่นแรก (JSON ก้อนเดียว)
      const backup = JSON.parse(await file.text()) as {
        app?: string;
        receipts?: BackupReceipt[];
        items?: ItemRecord[];
      };
      if (backup?.app !== "costsnap" || !Array.isArray(backup.receipts)) {
        throw new Error(NOT_A_BACKUP);
      }
      for (const r of backup.receipts) await pushReceipt(r);
      if (Array.isArray(backup.items)) rawItems.push(...backup.items);
    }
    await flushReceipts();

    // ผูกรายการสินค้ากลับเข้าใบใหม่ — รายการที่หาใบของตัวเองไม่เจอทิ้งไป (ดีกว่าไปโผล่ผิดใบ)
    const byReceipt = new Map<number, Omit<ItemRecord, "id">[]>();
    for (const { id: _id, ...it } of rawItems) {
      const rid = idMap.get(it.receiptId);
      if (rid == null) continue;
      const list = byReceipt.get(rid) ?? [];
      list.push({ ...it, receiptId: rid });
      byReceipt.set(rid, list);
    }
    const restored: Omit<ItemRecord, "id">[] = [];
    for (const [rid, list] of byReceipt) {
      const r = money.get(rid)!;
      // ไฟล์สำรองเก่าไม่มีต้นทุนแบบรวม VAT / ยังไม่ถอด VAT ของบิลราคารวม VAT — คำนวณย้อนหลังให้
      if (!list.every((it) => it.amountIncVat != null)) {
        const filled = backfillIncVat(r, list);
        list.forEach((it, i) => Object.assign(it, filled[i]));
      }
      const fixed = fixInclusiveExVat(r, list);
      if (fixed) list.forEach((it, i) => Object.assign(it, fixed[i]));
      restored.push(...list);
    }
    for (let i = 0; i < restored.length; i += ITEM_BATCH) {
      const ids = (await db.items.bulkAdd(restored.slice(i, i + ITEM_BATCH) as ItemRecord[], {
        allKeys: true,
      })) as number[];
      newItemIds.push(...ids);
    }

    // นำเข้าครบแล้ว — ค่อยลบของเดิม
    await db.transaction("rw", db.receipts, db.items, async () => {
      await db.items.bulkDelete(oldItemIds);
      await db.receipts.bulkDelete(oldReceiptIds);
    });
    return { receipts: newReceiptIds.length, items: restored.length };
  } catch (e) {
    // ย้อนกลับ: ลบเฉพาะที่เพิ่งเพิ่ม ข้อมูลเดิมไม่ถูกแตะ
    try {
      await db.transaction("rw", db.receipts, db.items, async () => {
        await db.items.bulkDelete(newItemIds);
        await db.receipts.bulkDelete(newReceiptIds);
      });
    } catch {}
    if (e instanceof SyntaxError) throw new Error(isV2 ? BROKEN_BACKUP : NOT_A_BACKUP);
    if (e instanceof Error && /quota/i.test(e.name + e.message)) {
      throw new Error(
        "พื้นที่ในเครื่องไม่พอสำหรับกู้คืน — ข้อมูลเดิมยังอยู่ครบ ลองลบไฟล์อื่นในเครื่องแล้วทำใหม่"
      );
    }
    throw e;
  }
}

export async function clearAllData() {
  await db.transaction("rw", db.receipts, db.items, db.usage, async () => {
    await db.items.clear();
    await db.receipts.clear();
    await db.usage.clear();
  });
}

// ย่อรูปเอกสารเก่าที่เก็บความละเอียดเต็มไว้ ให้เหลือขนาดเก็บถาวร
export async function shrinkAllImages(): Promise<{
  done: number;
  savedMB: number;
}> {
  const { shrinkStoredImage } = await import("./image");
  const receipts = await db.receipts.toArray();
  let done = 0;
  let saved = 0;
  for (const r of receipts) {
    if (!r.imageBlob || r.id == null) continue;
    let smaller: Blob | null = null;
    try {
      smaller = await shrinkStoredImage(r.imageBlob);
    } catch {
      continue; // รูปเสีย/เปิดไม่ได้ ข้ามไป ไม่ให้ทั้งชุดล้ม
    }
    if (!smaller) continue;
    saved += r.imageBlob.size - smaller.size;
    await db.receipts.update(r.id, { imageBlob: smaller, imageType: "image/jpeg" });
    done += 1;
  }
  return { done, savedMB: saved / 1048576 };
}
