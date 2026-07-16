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

export async function deleteReceipt(id: number): Promise<void> {
  await db.transaction("rw", db.receipts, db.items, async () => {
    await db.items.where("receiptId").equals(id).delete();
    await db.receipts.delete(id);
  });
}
