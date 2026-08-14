import { db } from "./db";
import type { ExtractedReceipt } from "./types";
import { buildItemRecords, buildReceiptFields } from "./cost";

export { billDiscountFactor, buildItemRecords, buildReceiptFields } from "./cost";

// บันทึกเอกสารใหม่พร้อมรูป
export async function addReceipt(
  data: ExtractedReceipt,
  image: { blob: Blob; mediaType: string }
): Promise<number> {
  return db.transaction("rw", db.receipts, db.items, async () => {
    const receiptId = (await db.receipts.add({
      ...buildReceiptFields(data),
      createdAt: Date.now(),
      imageBlob: image.blob,
      imageType: image.mediaType,
    })) as number;
    await db.items.bulkAdd(buildItemRecords(receiptId, data));
    return receiptId;
  });
}

// อัปเดตเอกสารเดิม (คงรูปและ createdAt เดิมไว้) — แทนที่รายการสินค้าทั้งชุด
export async function updateReceipt(
  id: number,
  data: ExtractedReceipt
): Promise<void> {
  await db.transaction("rw", db.receipts, db.items, async () => {
    await db.receipts.update(id, buildReceiptFields(data));
    await db.items.where("receiptId").equals(id).delete();
    await db.items.bulkAdd(buildItemRecords(id, data));
  });
}
