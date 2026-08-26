import type { ExtractedReceipt, ValidationResult } from "./types";

// ตรวจ check digit เลขประจำตัวผู้เสียภาษี/เลขบัตรประชาชน 13 หลัก (mod 11)
export function isValidThaiTaxId(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const closeTo = (a: number, b: number, tol = 1.0) => Math.abs(a - b) <= tol;

// ตรวจความสมเหตุสมผลของตัวเลขและความครบถ้วนตามมาตรา 86/4
export function validateExtraction(data: ExtractedReceipt): ValidationResult {
  const sellerTaxIdValid = data.seller.tax_id
    ? isValidThaiTaxId(data.seller.tax_id)
    : null;

  const amounts = data.line_items
    .map((it) => it.amount)
    .filter((a): a is number => a != null);
  const itemsSum = amounts.reduce((s, a) => s + a, 0);

  const discount = data.discount ?? 0;
  const vat = data.vat_amount ?? 0;

  // ฐานก่อน VAT ที่เชื่อถือได้ที่สุด = ยอดสุทธิ − VAT (ใช้ได้ทั้ง VAT นอกและ VAT ใน)
  // ไม่อิง subtotal เพราะบิลไทยพิมพ์ "รวมราคาสินค้า" เป็นยอดหลังหักส่วนลดบ้าง ก่อนหักบ้าง
  const netBeforeVat =
    data.total != null
      ? round2(data.total - vat)
      : data.subtotal != null
        ? round2(data.subtotal - discount)
        : null;
  const gross = netBeforeVat != null ? round2(netBeforeVat + discount) : null;

  const itemsSumOk =
    amounts.length > 0 && gross != null && netBeforeVat != null
      ? closeTo(itemsSum, gross, Math.max(1, gross * 0.001)) ||
        closeTo(itemsSum, netBeforeVat, Math.max(1, netBeforeVat * 0.001))
      : null;

  // subtotal ที่พิมพ์ต้องเข้ากับรูปแบบใดรูปแบบหนึ่งที่ยอมรับได้
  const totalMathOk =
    data.subtotal != null && data.total != null
      ? closeTo(data.subtotal - discount + vat, data.total) ||
        closeTo(data.subtotal + vat, data.total) ||
        closeTo(data.subtotal, data.total)
      : null;

  const vatMathOk =
    netBeforeVat != null && vat > 0
      ? closeTo(netBeforeVat * 0.07, vat, Math.max(1, netBeforeVat * 0.002))
      : null;

  // ความครบถ้วนของใบกำกับภาษีเต็มรูปตามมาตรา 86/4
  const missingFields: string[] = [];
  if (data.document_type === "tax_invoice_full") {
    if (!data.seller.name) missingFields.push("ชื่อผู้ขาย");
    if (!data.seller.tax_id) missingFields.push("เลขผู้เสียภาษีผู้ขาย");
    if (!data.seller.address) missingFields.push("ที่อยู่ผู้ขาย");
    if (!data.buyer.name) missingFields.push("ชื่อผู้ซื้อ");
    if (!data.doc_number) missingFields.push("เลขที่ใบกำกับภาษี");
    if (!data.doc_date) missingFields.push("วันที่");
    if (data.line_items.length === 0) missingFields.push("รายการสินค้า/บริการ");
    if (data.vat_amount == null) missingFields.push("จำนวนภาษีมูลค่าเพิ่ม");
  }

  const fullInvoiceComplete =
    data.document_type === "tax_invoice_full" && missingFields.length === 0;

  const vatClaimable =
    fullInvoiceComplete &&
    sellerTaxIdValid === true &&
    (data.vat_amount ?? 0) > 0;

  return {
    sellerTaxIdValid,
    itemsSumOk,
    totalMathOk,
    vatMathOk,
    fullInvoiceComplete,
    missingFields,
    vatClaimable,
  };
}

// ชื่อสินค้า normalize สำหรับ group ต้นทุน
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[()[\]{}"'*#]/g, "")
    .trim();
}
