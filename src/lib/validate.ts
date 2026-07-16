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

  const base =
    data.subtotal != null ? data.subtotal - (data.discount ?? 0) : null;

  const itemsSumOk =
    amounts.length > 0 && data.subtotal != null
      ? closeTo(itemsSum, data.subtotal) ||
        (data.total != null && closeTo(itemsSum, data.total))
      : null;

  const totalMathOk =
    base != null && data.vat_amount != null && data.total != null
      ? closeTo(base + data.vat_amount, data.total) ||
        // กรณีราคารวม VAT แล้ว (VAT-included): total = subtotal
        closeTo(base, data.total)
      : null;

  const vatMathOk =
    base != null && data.vat_amount != null && data.vat_amount > 0
      ? closeTo(base * 0.07, data.vat_amount, Math.max(1, base * 0.002)) ||
        // กรณี VAT-included: vat = total * 7/107
        (data.total != null &&
          closeTo((data.total * 7) / 107, data.vat_amount, Math.max(1, data.total * 0.002)))
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
