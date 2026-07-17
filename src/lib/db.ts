import Dexie, { type EntityTable } from "dexie";
import type { ReceiptRecord, ItemRecord } from "./types";

// ข้อมูลทั้งหมดอยู่ใน IndexedDB บนเครื่องผู้ใช้ (offline-first)
export const db = new Dexie("costsnap") as Dexie & {
  receipts: EntityTable<ReceiptRecord, "id">;
  items: EntityTable<ItemRecord, "id">;
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

// ตรวจใบซ้ำ: ผู้ขายเดียวกัน + เลขที่เอกสารเดียวกัน
export async function findDuplicate(
  sellerTaxId: string | null,
  docNumber: string | null
): Promise<ReceiptRecord | undefined> {
  if (!docNumber) return undefined;
  const candidates = await db.receipts
    .where("docNumber")
    .equals(docNumber)
    .toArray();
  return candidates.find(
    (r) => !sellerTaxId || !r.sellerTaxId || r.sellerTaxId === sellerTaxId
  );
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
