// ตรรกะคำนวณต้นทุน (pure — ไม่แตะฐานข้อมูล จึงเทสต์ได้ตรงๆ)
import type { ExtractedReceipt, ItemRecord, ReceiptRecord } from "./types";
import { validateExtraction, normalizeItemName } from "./validate";

const round2 = (v: number) => Math.round(v * 100) / 100;

// สัดส่วนหักส่วนลดท้ายบิลลงต้นทุนรายการ — ส่วนลดท้ายบิล (เช่น เงินสด 3%)
// มีผลกับต้นทุนจริงของทุกชิ้นเสมอ จึงต้องเกลี่ยให้อัตโนมัติ ไม่ใช่รอผู้ใช้กดปุ่ม
export function billDiscountFactor(data: ExtractedReceipt): number {
  const itemsSum = data.line_items.reduce((s, it) => s + (it.amount ?? 0), 0);
  const discount = data.discount ?? 0;
  if (discount <= 0 || itemsSum <= 0 || discount >= itemsSum) return 1;
  // ถ้ายอดรวมรายการเท่ากับยอดสุทธิอยู่แล้ว = ส่วนลดถูกหักในแต่ละบรรทัดแล้ว ห้ามหักซ้ำ
  if (data.total != null && Math.abs(itemsSum - data.total) <= 1) return 1;
  return (itemsSum - discount) / itemsSum;
}

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
  const factor = billDiscountFactor(data);
  return data.line_items
    .filter((it) => it.description.trim() !== "")
    .map((it) => {
      const qty = it.quantity ?? 1;
      // ต้นทุนจริงต่อหน่วย = จำนวนเงิน ÷ จำนวน — ราคา/หน่วยที่พิมพ์มักเป็นราคาก่อนส่วนลดบรรทัด
      // (เช่นส่วนลดซ้อน "30+25%") จึงใช้ยอดจ่ายจริงเป็นหลักเสมอเมื่อคำนวณได้
      const rawAmount =
        it.amount ?? (it.unit_price != null ? it.unit_price * qty : 0);
      // แล้วหักส่วนลดท้ายบิลตามสัดส่วน ให้ต้นทุนที่เก็บเป็นราคาที่จ่ายจริง
      const netAmount = round2(rawAmount * factor);
      return {
        receiptId,
        docDate: data.doc_date,
        sellerName: data.seller.name,
        description: it.description,
        normalizedName: normalizeItemName(it.description),
        quantity: qty,
        unit: it.unit,
        unitPrice: qty > 0 ? round2(netAmount / qty) : netAmount,
        amount: netAmount,
        category: it.category,
      };
    });
}
