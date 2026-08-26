// ตรรกะคำนวณต้นทุน (pure — ไม่แตะฐานข้อมูล จึงเทสต์ได้ตรงๆ)
import type { ExtractedReceipt, ItemRecord, ReceiptRecord } from "./types";
import { validateExtraction, normalizeItemName } from "./validate";

// ปัดทศนิยม 2 ตำแหน่งแบบครึ่งขึ้น — เผื่อความคลาดเคลื่อน floating point
// (599.925 เก็บจริงเป็น 599.92499999… ถ้าไม่เผื่อจะปัดลงเป็น 599.92)
export const round2 = (v: number) =>
  Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100;

// สรุปยอดบิลให้สอดคล้องกันเสมอ
// ปัญหาที่เจอจริง: บิลไทยพิมพ์ "รวมราคาสินค้า" เป็นยอด*หลัง*หักส่วนลดแล้ว (เช่น
// 135,960 → ลด 25% → 101,970 → ลด 5% → 96,871.50 → +VAT = 103,652.51)
// ถ้าเอาช่องนั้นมาเป็น "ยอดก่อน VAT" แล้วลบส่วนลดอีกครั้ง จะกลายเป็นหักซ้ำ
// จึงยึด "ยอดสุทธิ" กับ "VAT" ซึ่งเป็นตัวเลขที่พิมพ์ชัดที่สุดเป็นหลักในการไล่ย้อนกลับ
export interface BillSummary {
  itemsSum: number; // ผลรวมรายการตามที่พิมพ์
  gross: number; // ราคาสินค้าก่อนหักส่วนลดท้ายบิล
  discount: number; // ส่วนลดท้ายบิลรวม
  netBeforeVat: number; // ฐานก่อน VAT (หลังหักส่วนลดแล้ว)
  vat: number;
  total: number; // ยอดสุทธิที่ต้องจ่าย
  itemsMatchGross: boolean; // ผลรวมรายการตรงกับราคาก่อนลดไหม
  itemsAlreadyNet: boolean; // รายการเป็นยอดหลังหักส่วนลดอยู่แล้ว
}

export interface BillNumbers {
  subtotal: number | null;
  discount: number | null;
  vatAmount: number | null;
  total: number | null;
  itemsSum: number;
}

export function billSummary(input: BillNumbers): BillSummary {
  const itemsSum = input.itemsSum;
  const discount = Math.max(0, input.discount ?? 0);
  const vat = Math.max(0, input.vatAmount ?? 0);

  // ยอดสุทธิ: ถ้าไม่มีให้ประกอบจากข้อมูลที่มี
  const total =
    input.total ??
    (input.subtotal != null
      ? round2(input.subtotal + vat)
      : round2(itemsSum - discount + vat));

  // ฐานก่อน VAT = ยอดสุทธิ − VAT (ใช้ได้ทั้ง VAT นอกและ VAT ใน)
  let netBeforeVat = round2(total - vat);
  if (netBeforeVat <= 0) netBeforeVat = input.subtotal ?? total;

  const gross = round2(netBeforeVat + discount);
  const tol = Math.max(1, Math.max(itemsSum, gross) * 0.001);
  return {
    itemsSum,
    gross,
    discount,
    netBeforeVat,
    vat,
    total,
    itemsMatchGross: itemsSum > 0 && Math.abs(itemsSum - gross) <= tol,
    itemsAlreadyNet:
      discount > 0 &&
      itemsSum > 0 &&
      (Math.abs(itemsSum - netBeforeVat) <= tol ||
        Math.abs(itemsSum - total) <= tol),
  };
}

export function sumLineAmounts(data: ExtractedReceipt): number {
  return round2(data.line_items.reduce((s, it) => s + (it.amount ?? 0), 0));
}

export function summarizeExtracted(data: ExtractedReceipt): BillSummary {
  return billSummary({
    subtotal: data.subtotal,
    discount: data.discount,
    vatAmount: data.vat_amount,
    total: data.total,
    itemsSum: sumLineAmounts(data),
  });
}

// สัดส่วนหักส่วนลดท้ายบิลลงต้นทุนรายการ — ส่วนลดท้ายบิล (เช่น เงินสด 3%)
// มีผลกับต้นทุนจริงของทุกชิ้นเสมอ จึงต้องเกลี่ยให้อัตโนมัติ ไม่ใช่รอผู้ใช้กดปุ่ม
export function billDiscountFactor(data: ExtractedReceipt): number {
  const s = summarizeExtracted(data);
  if (s.discount <= 0 || s.itemsSum <= 0 || s.discount >= s.itemsSum) return 1;
  // รายการเป็นยอดหลังหักส่วนลดอยู่แล้ว (เทียบทั้งฐานก่อน VAT และยอดสุทธิ) ห้ามหักซ้ำ
  if (s.itemsAlreadyNet) return 1;
  return (s.itemsSum - s.discount) / s.itemsSum;
}

// แปลงผลสกัด → เรคคอร์ด receipts (ใช้ร่วมทั้งตอนบันทึกใหม่และตอนแก้ไข)
export function buildReceiptFields(
  data: ExtractedReceipt
): Omit<ReceiptRecord, "id" | "createdAt" | "imageBlob" | "imageType"> {
  const validation = validateExtraction(data);
  const s = summarizeExtracted(data);
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
    // subtotal ที่เก็บ = ฐานก่อน VAT หลังหักส่วนลดแล้ว (ยอดที่ใช้ยื่น ภ.พ.30)
    subtotal: s.netBeforeVat,
    discount: s.discount,
    vatAmount: s.vat,
    total: s.total,
    vatClaimable: validation.vatClaimable,
    paid: data.paid,
    dueDate: data.due_date,
    confidence: data.confidence,
    warnings: data.warnings,
    notes: data.notes,
  };
}

// เกลี่ยส่วนลดท้ายบิลลงแต่ละบรรทัดด้วยวิธี "เศษมากได้ก่อน" (largest remainder)
// ทุกบรรทัดคลาดจากค่าจริงไม่เกิน 1 สตางค์ และผลรวมเท่ากับยอดหลังหักส่วนลดเป๊ะ
function spreadDiscount(raw: number[], factor: number): number[] {
  if (factor >= 1 || raw.length === 0) return raw.map(round2);
  const exactSatang = raw.map((v) => v * factor * 100);
  const out = exactSatang.map((v) => Math.floor(v + 1e-6));
  const target = Math.round(raw.reduce((a, b) => a + b, 0) * factor * 100);
  let left = target - out.reduce((a, b) => a + b, 0);
  const order = exactSatang
    .map((v, i) => ({ i, frac: v - Math.floor(v + 1e-6) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0 && k < order.length * 2; k++, left--) {
    out[order[k % order.length].i] += 1;
  }
  return out.map((v) => v / 100);
}

export function buildItemRecords(
  receiptId: number,
  data: ExtractedReceipt
): ItemRecord[] {
  const factor = billDiscountFactor(data);
  const lines = data.line_items.filter((it) => it.description.trim() !== "");
  // ต้นทุนจริงต่อหน่วย = จำนวนเงิน ÷ จำนวน — ราคา/หน่วยที่พิมพ์มักเป็นราคาก่อนส่วนลดบรรทัด
  // (เช่นส่วนลดซ้อน "30+25%") จึงใช้ยอดจ่ายจริงเป็นหลักเสมอเมื่อคำนวณได้
  const raw = lines.map(
    (it) => it.amount ?? (it.unit_price != null ? it.unit_price * (it.quantity ?? 1) : 0)
  );
  const net = spreadDiscount(raw, factor);
  return lines.map((it, i) => {
    const qty = it.quantity ?? 1;
    return {
      receiptId,
      docDate: data.doc_date,
      sellerName: data.seller.name,
      description: it.description,
      normalizedName: normalizeItemName(it.description),
      quantity: qty,
      unit: it.unit,
      unitPrice: qty > 0 ? round2(net[i] / qty) : net[i],
      amount: net[i],
      category: it.category,
    };
  });
}
