import { db } from "./db";
import type { ExtractedReceipt, ItemRecord, ReceiptRecord } from "./types";
import { validateExtraction, normalizeItemName } from "./validate";

// แปลงผลสกัด → เรคคอร์ด receipts (ใช้ร่วมทั้งตอนบันทึกใหม่และตอนแก้ไข)
export function buildReceiptFields(
  data: ExtractedReceipt
): Omit<ReceiptRecord, "id" | "createdAt" | "imageBlob" | "imageType"> {
  const validation = validateExtraction(data);
  const itemsSum = data.line_items.reduce((s, it) => s + (it.amount ?? 0), 0);
  const total = data.total ?? itemsSum;
  return {
    docDate: data.doc_date,
    docNumber: data.doc_number,
    documentType: data.document_type,
    sellerName: data.seller.name,
    sellerTaxId: data.seller.tax_id,
    sellerBranch: data.seller.branch,
    sellerAddress: data.seller.address,
    buyerName: data.buyer.name,
    buyerTaxId: data.buyer.tax_id,
    paymentMethod: data.payment_method,
    subtotal: data.subtotal ?? total,
    discount: data.discount ?? 0,
    vatAmount: data.vat_amount ?? 0,
    total,
    vatClaimable: validation.vatClaimable,
    paid: data.paid,
    dueDate: data.due_date,
    confidence: data.confidence,
    warnings: data.warnings,
    notes: data.notes,
  };
}

export function buildItemRecords(
  receiptId: number,
  data: ExtractedReceipt
): ItemRecord[] {
  return data.line_items
    .filter((it) => it.description.trim() !== "")
    .map((it) => {
      const qty = it.quantity ?? 1;
      // ต้นทุนจริงต่อหน่วย = จำนวนเงิน ÷ จำนวน — ราคา/หน่วยที่พิมพ์มักเป็นราคาก่อนส่วนลดบรรทัด
      // (เช่นส่วนลดซ้อน "30+25%") จึงใช้ยอดจ่ายจริงเป็นหลักเสมอเมื่อคำนวณได้
      const effectiveUnitPrice =
        it.amount != null && qty > 0
          ? it.amount / qty
          : it.unit_price ?? it.amount ?? 0;
      return {
        receiptId,
        docDate: data.doc_date,
        sellerName: data.seller.name,
        description: it.description,
        normalizedName: normalizeItemName(it.description),
        quantity: qty,
        unit: it.unit,
        unitPrice: effectiveUnitPrice,
        amount: it.amount ?? 0,
        category: it.category,
      };
    });
}

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
