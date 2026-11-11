import Dexie, { type EntityTable } from "dexie";
import type { ReceiptRecord, ItemRecord, UsageRecord } from "./types";
import { backfillIncVat, fixInclusiveExVat } from "./cost";

// ข้อมูลทั้งหมดอยู่ใน IndexedDB บนเครื่องผู้ใช้ (offline-first)
export const db = new Dexie("costsnap") as Dexie & {
  receipts: EntityTable<ReceiptRecord, "id">;
  items: EntityTable<ItemRecord, "id">;
  usage: EntityTable<UsageRecord, "id">;
};

db.version(1).stores({
  receipts: "++id, createdAt, docDate, sellerName, sellerTaxId, docNumber, documentType",
  items: "++id, receiptId, normalizedName, docDate",
});

// v2: เพิ่ม index หมวดหมู่ให้รายการสินค้า (ข้อมูลเก่า category = undefined ได้)
db.version(2).stores({
  receipts: "++id, createdAt, docDate, sellerName, sellerTaxId, docNumber, documentType",
  items: "++id, receiptId, normalizedName, docDate, category",
});

// v3: ติดตามบิลค้างจ่าย — เพิ่ม index วันครบกำหนด (paid เก็บเป็น field ธรรมดา)
db.version(3).stores({
  receipts:
    "++id, createdAt, docDate, sellerName, sellerTaxId, docNumber, documentType, dueDate",
  items: "++id, receiptId, normalizedName, docDate, category",
});

// v4: เก็บการใช้งาน AI เพื่อคิดค่าใช้จ่าย
db.version(4).stores({
  receipts:
    "++id, createdAt, docDate, sellerName, sellerTaxId, docNumber, documentType, dueDate",
  items: "++id, receiptId, normalizedName, docDate, category",
  usage: "++id, at, kind",
});

// v5: เก็บต้นทุนแบบรวม VAT คู่กับแบบก่อน VAT
// เอกสารเก่าคำนวณย้อนหลังให้ โดยดูว่ายอดรายการของใบนั้นรวม VAT อยู่แล้วหรือยัง
db.version(5)
  .stores({
    receipts:
      "++id, createdAt, docDate, sellerName, sellerTaxId, docNumber, documentType, dueDate",
    items: "++id, receiptId, normalizedName, docDate, category",
    usage: "++id, at, kind",
  })
  .upgrade(async (tx) => {
    const receipts = (await tx.table("receipts").toArray()) as ReceiptRecord[];
    const items = (await tx.table("items").toArray()) as ItemRecord[];
    const byReceipt = new Map<number, ItemRecord[]>();
    for (const it of items) {
      const list = byReceipt.get(it.receiptId) ?? [];
      list.push(it);
      byReceipt.set(it.receiptId, list);
    }
    for (const r of receipts) {
      const list = r.id != null ? byReceipt.get(r.id) : undefined;
      if (!list || list.length === 0) continue;
      const filled = backfillIncVat(r, list);
      for (let i = 0; i < list.length; i++) {
        await tx.table("items").update(list[i].id!, filled[i]);
      }
    }
  });

// v6: บิลที่ราคาในรายการรวม VAT แล้ว เดิมเก็บช่อง "ก่อน VAT" เป็นยอดรวม VAT — ถอด VAT ออกย้อนหลัง
db.version(6)
  .stores({
    receipts:
      "++id, createdAt, docDate, sellerName, sellerTaxId, docNumber, documentType, dueDate",
    items: "++id, receiptId, normalizedName, docDate, category",
    usage: "++id, at, kind",
  })
  .upgrade(async (tx) => {
    const receipts = (await tx.table("receipts").toArray()) as ReceiptRecord[];
    for (const r of receipts) {
      if (r.id == null || !(r.vatAmount > 0)) continue;
      const list = (await tx
        .table("items")
        .where("receiptId")
        .equals(r.id)
        .toArray()) as ItemRecord[];
      if (list.length === 0) continue;
      const fixed = fixInclusiveExVat(r, list);
      if (!fixed) continue;
      for (let i = 0; i < list.length; i++) {
        await tx.table("items").update(list[i].id!, fixed[i]);
      }
    }
  });

const sameText = (a: string | null, b: string | null) =>
  (a ?? "").replace(/\s+/g, "").toLowerCase() === (b ?? "").replace(/\s+/g, "").toLowerCase();

// ตรวจใบซ้ำ: ผู้ขายเดียวกัน + เลขที่เอกสารเดียวกัน
export async function findDuplicate(
  sellerTaxId: string | null,
  docNumber: string | null,
  sellerName: string | null = null
): Promise<ReceiptRecord | undefined> {
  const number = docNumber?.trim();
  if (!number) return undefined;
  const candidates = await db.receipts.where("docNumber").equals(number).toArray();
  const taxId = sellerTaxId?.replace(/\D/g, "") || null;
  return candidates.find((r) => {
    // มีเลขผู้เสียภาษีทั้งสองใบ → ตัดสินด้วยเลขนั้น
    const other = r.sellerTaxId?.replace(/\D/g, "") || null;
    if (taxId && other) return taxId === other;
    // ไม่มีเลขให้เทียบ (บิลเขียนมือ/บิลเงินสด เลขที่มักซ้ำกันข้ามร้าน เช่น "001") → เทียบชื่อผู้ขาย
    if (sellerName && r.sellerName) return sameText(sellerName, r.sellerName);
    return true;
  });
}

// เตือนเอกสารเกี่ยวเนื่อง: ใบส่งของชั่วคราว/ใบเสนอขาย มักมีใบกำกับภาษีจริงตามมา
// → ผู้ขายเดิม + ยอดเงินเท่ากัน (±1 บาท) ภายใน 45 วัน ถือว่าน่าสงสัยว่าเป็นรายการเดียวกัน
export async function findRelated(
  sellerTaxId: string | null,
  sellerName: string | null,
  total: number | null,
  docDate: string | null
): Promise<ReceiptRecord | undefined> {
  if (total == null || total <= 0) return undefined;
  const all = await db.receipts.toArray();
  const refTime = docDate ? new Date(docDate + "T00:00:00").getTime() : Date.now();
  const WINDOW = 45 * 24 * 3600 * 1000;
  return all.find((r) => {
    if (Math.abs(r.total - total) > 1) return false;
    const sameSeller =
      (sellerTaxId && r.sellerTaxId && r.sellerTaxId === sellerTaxId) ||
      (sellerName && r.sellerName && r.sellerName.trim() === sellerName.trim());
    if (!sameSeller) return false;
    const rTime = r.docDate ? new Date(r.docDate + "T00:00:00").getTime() : r.createdAt;
    return Math.abs(rTime - refTime) <= WINDOW;
  });
}

export async function deleteReceipt(id: number): Promise<void> {
  await db.transaction("rw", db.receipts, db.items, async () => {
    await db.items.where("receiptId").equals(id).delete();
    await db.receipts.delete(id);
  });
}
