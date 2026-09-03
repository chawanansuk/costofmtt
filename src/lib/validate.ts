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

// ---------- ตรวจรายบรรทัด ----------
// ชี้เป้าให้ผู้ใช้ตรวจเฉพาะบรรทัดที่น่าสงสัย แทนที่จะต้องไล่ดูทุกบรรทัด
// และใช้เป็นเงื่อนไขให้เซิร์ฟเวอร์สั่ง AI อ่านซ้ำเฉพาะเมื่อจำเป็น
export type LineIssueLevel = "error" | "warn" | "info";
export interface LineIssue {
  index: number;
  level: LineIssueLevel;
  code:
    | "no_quantity"
    | "no_price"
    | "amount_exceeds"
    | "line_discount"
    | "zero_quantity";
  message: string;
}

const FREEBIE_WORD = /แถม|ฟรี|free/i;

export function checkLineItems(data: ExtractedReceipt): LineIssue[] {
  const issues: LineIssue[] = [];
  data.line_items.forEach((it, index) => {
    if (it.description.trim() === "") return;
    const qty = it.quantity;
    const price = it.unit_price;
    const amount = it.amount;
    const freebie = FREEBIE_WORD.test(it.description) || amount === 0 || price === 0;

    if ((amount ?? 0) > 0 && (qty == null || qty <= 0)) {
      issues.push({
        index,
        level: "error",
        code: qty == null ? "no_quantity" : "zero_quantity",
        message:
          "อ่านจำนวนไม่ได้ — ระบบจะถือว่าจำนวน = 1 ทำให้ต้นทุนต่อหน่วยผิด กรุณากรอกจำนวน",
      });
      return;
    }
    if ((qty ?? 0) > 0 && amount == null && price == null && !freebie) {
      issues.push({
        index,
        level: "error",
        code: "no_price",
        message: "อ่านราคาไม่ได้ — บรรทัดนี้จะไม่มีต้นทุน กรุณากรอกราคาหรือยอดรวม",
      });
      return;
    }
    if (qty != null && qty > 0 && price != null && price > 0 && amount != null && amount > 0) {
      const expected = qty * price;
      const tol = Math.max(1, expected * 0.005);
      if (amount > expected + tol) {
        issues.push({
          index,
          level: "error",
          code: "amount_exceeds",
          message: `ยอดรวม ${amount.toLocaleString("th-TH")} มากกว่า จำนวน×ราคา (${expected.toLocaleString("th-TH")}) — น่าจะอ่านตัวเลขผิดคอลัมน์`,
        });
      } else if (amount < expected - tol) {
        const pct = ((expected - amount) / expected) * 100;
        issues.push({
          index,
          level: "info",
          code: "line_discount",
          message: `ยอดรวมต่ำกว่า จำนวน×ราคา ${pct.toFixed(1)}% — ถ้าไม่มีส่วนลดบรรทัด ให้ตรวจตัวเลข`,
        });
      }
    }
  });
  return issues;
}
