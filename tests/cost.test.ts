// ทดสอบสูตรคำนวณต้นทุน — รัน: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billSummary,
  billDiscountFactor,
  buildItemRecords,
  buildReceiptFields,
  fixInclusiveExVat,
  isFreebieLine,
  round2,
} from "../src/lib/cost";
import { cleanIsoDate, cleanTaxId, matchesSearch, todayISO } from "../src/lib/format";
import type { ExtractedReceipt, LineItem } from "../src/lib/types";

const party = { name: null, tax_id: null, branch: null, address: null };
const line = (p: Partial<LineItem>): LineItem => ({
  description: "สินค้า",
  quantity: 1,
  unit: "อัน",
  unit_price: null,
  amount: null,
  category: "merchandise",
  ...p,
});
const bill = (p: Partial<ExtractedReceipt>): ExtractedReceipt => ({
  document_type: "tax_invoice_full",
  seller: { ...party, name: "ผู้ขาย" },
  buyer: party,
  doc_number: "A1",
  doc_date: "2026-11-10",
  line_items: [],
  subtotal: null,
  discount: null,
  vat_rate: null,
  vat_amount: null,
  total: null,
  payment_method: null,
  paid: null,
  due_date: null,
  notes: null,
  confidence: "high",
  warnings: [],
  ...p,
});
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

test("ส่วนลดซ้อนท้ายบิล: ไล่ยอดจากยอดสุทธิ ไม่หักส่วนลดซ้ำ", () => {
  // 135,960 → ลด 25% → 101,970 → ลด 5% → 96,871.50 → +VAT 7% = 103,652.51
  const s = billSummary({
    subtotal: 96871.5, discount: 39088.5, vatAmount: 6781.01, total: 103652.51, itemsSum: 135960,
  });
  assert.equal(s.netBeforeVat, 96871.5);
  assert.equal(s.gross, 135960);
  assert.equal(s.itemsMatchGross, true);
  assert.equal(s.itemsAlreadyNet, false);
});

test("VAT นอก: ต้นทุนก่อน VAT = ยอดรายการ, รวม VAT = คูณ 1.07 และผลรวมลงตัวกับยอดสุทธิ", () => {
  const data = bill({
    line_items: [
      line({ description: "ก", quantity: 3, unit_price: 100, amount: 300 }),
      line({ description: "ข", quantity: 7, unit_price: 100, amount: 700 }),
    ],
    subtotal: 1000, vat_amount: 70, total: 1070,
  });
  const recs = buildItemRecords(1, data);
  assert.deepEqual(recs.map((r) => r.amount), [300, 700]);
  assert.deepEqual(recs.map((r) => r.amountIncVat), [321, 749]);
  assert.equal(recs[0].unitPrice, 100);
  assert.equal(recs[0].unitPriceIncVat, 107);
});

test("VAT ใน (ราคาในรายการรวม VAT แล้ว): ต้นทุนก่อน VAT ต้องถอด VAT ออก", () => {
  const data = bill({
    document_type: "tax_invoice_abb",
    line_items: [
      line({ description: "ก", quantity: 2, unit_price: 107, amount: 214 }),
      line({ description: "ข", quantity: 1, unit_price: 856, amount: 856 }),
    ],
    subtotal: 1000, vat_amount: 70, total: 1070,
  });
  const recs = buildItemRecords(1, data);
  assert.deepEqual(recs.map((r) => r.amountIncVat), [214, 856]);
  assert.deepEqual(recs.map((r) => r.amount), [200, 800]);
  assert.equal(recs[0].unitPrice, 100);
  assert.equal(recs[0].unitPriceIncVat, 107);
  assert.equal(sum(recs.map((r) => r.amount)), 1000);
});

test("บิลไม่มี VAT: สองฐานเท่ากัน", () => {
  const data = bill({
    document_type: "handwritten_bill",
    line_items: [line({ quantity: 4, unit_price: 25, amount: 100 })],
    total: 100,
  });
  const [r] = buildItemRecords(1, data);
  assert.equal(r.amount, 100);
  assert.equal(r.amountIncVat, 100);
  assert.equal(r.unitPrice, 25);
});

test("ส่วนลดท้ายบิลเกลี่ยลงทุกรายการ ผลรวมเท่ายอดหลังหักส่วนลดเป๊ะ", () => {
  const data = bill({
    line_items: [
      line({ description: "ก", quantity: 3, amount: 100 }),
      line({ description: "ข", quantity: 3, amount: 100 }),
      line({ description: "ค", quantity: 3, amount: 100 }),
    ],
    discount: 10, vat_amount: 20.3, total: 310.3,
  });
  assert.ok(Math.abs(billDiscountFactor(data) - 290 / 300) < 1e-9);
  const recs = buildItemRecords(1, data);
  assert.equal(sum(recs.map((r) => r.amount)), 290);
  assert.equal(sum(recs.map((r) => r.amountIncVat!)), 310.3);
  for (const r of recs) assert.ok(Math.abs(r.amount - 96.67) <= 0.011);
});

test("รายการเป็นยอดหลังหักส่วนลดอยู่แล้ว: ไม่หักซ้ำ", () => {
  const data = bill({
    line_items: [line({ quantity: 10, amount: 900 })],
    discount: 100, vat_amount: 63, total: 963,
  });
  assert.equal(billDiscountFactor(data), 1);
  assert.equal(buildItemRecords(1, data)[0].amount, 900);
});

test("ของแถม: รวมจำนวนแถมเข้าไปหารต้นทุนต่อหน่วย และไม่เก็บบรรทัดแถมซ้ำ", () => {
  const data = bill({
    line_items: [
      line({ description: "ขนทองเหลือง ตราสมอ", quantity: 80, unit: "โหล", unit_price: 836, amount: 66880 }),
      line({ description: "ขนทองเหลือง ตราสมอ(แถม)", quantity: 20, unit: "โหล", unit_price: 0, amount: 0 }),
    ],
    total: 66880,
  });
  const recs = buildItemRecords(1, data);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].quantity, 80);
  assert.equal(recs[0].freeQuantity, 20);
  assert.equal(recs[0].unitPrice, 668.8);
});

test("ราคาอ่านไม่ออก (null) ไม่ใช่ของแถม / ราคา 0 ชัดเจนคือของแถม", () => {
  assert.equal(isFreebieLine(line({ quantity: 5, unit_price: null, amount: null })), false);
  assert.equal(isFreebieLine(line({ quantity: 5, unit_price: 0, amount: 0 })), true);
  assert.equal(isFreebieLine(line({ description: "มีด (แถม)", quantity: 5 })), true);
});

test("แก้เอกสารเก่า: บิล VAT ในที่เคยเก็บก่อน VAT = รวม VAT", () => {
  const items = [
    { amount: 214, quantity: 2, unitPrice: 107, amountIncVat: 214, unitPriceIncVat: 107 },
    { amount: 856, quantity: 1, unitPrice: 856, amountIncVat: 856, unitPriceIncVat: 856 },
  ];
  const fixed = fixInclusiveExVat({ total: 1070, vatAmount: 70 }, items);
  assert.ok(fixed);
  assert.deepEqual(fixed!.map((f) => f.amount), [200, 800]);
  assert.deepEqual(fixed!.map((f) => f.amountIncVat), [214, 856]);
  assert.equal(fixed![0].unitPrice, 100);
  // ทำซ้ำต้องไม่แก้อีก
  const again = fixInclusiveExVat(
    { total: 1070, vatAmount: 70 },
    items.map((it, i) => ({ ...it, ...fixed![i] }))
  );
  assert.equal(again, null);
  // บิล VAT นอกไม่ต้องแก้
  assert.equal(
    fixInclusiveExVat({ total: 1070, vatAmount: 70 }, [{ amount: 1000, quantity: 1, unitPrice: 1000 }]),
    null
  );
});

test("วันที่: รับเฉพาะวันที่จริง แปลง พ.ศ. เป็น ค.ศ.", () => {
  assert.equal(cleanIsoDate("2026-11-10"), "2026-11-10");
  assert.equal(cleanIsoDate("2569-11-10"), "2026-11-10");
  assert.equal(cleanIsoDate("2026-2-5"), "2026-02-05");
  assert.equal(cleanIsoDate("2026-02-30"), null);
  assert.equal(cleanIsoDate("10/11/2026"), null);
  assert.equal(cleanIsoDate(""), null);
  assert.equal(cleanIsoDate(null), null);
});

test("บันทึก: วันที่เพี้ยนไม่ถูกเก็บ เลขผู้เสียภาษีเก็บเป็นตัวเลขล้วน", () => {
  const f = buildReceiptFields(
    bill({
      doc_date: "2569-01-15",
      due_date: "ไม่ระบุ",
      seller: { ...party, name: "ผู้ขาย", tax_id: "0-1055-56012-34-5" },
      total: 100,
    })
  );
  assert.equal(f.docDate, "2026-01-15");
  assert.equal(f.dueDate, null);
  assert.equal(f.sellerTaxId, "0105556012345");
  assert.equal(cleanTaxId("12345"), "12345");
});

test("วันนี้ใช้เวลาเครื่อง ไม่ใช่ UTC", () => {
  // 02:00 เวลาเครื่องของวันที่ 11 — ต้องได้วันที่ 11 เสมอ ไม่ว่าเครื่องอยู่ timezone ไหน
  assert.equal(todayISO(new Date(2026, 10, 11, 2, 0, 0)), "2026-11-11");
});

test("ค้นหา: ไม่สนตัวพิมพ์ ช่องว่าง ขีดคั่น", () => {
  assert.equal(matchesSearch("WS-9010 คีมปากจิ้งจก 8 นิ้ว", "ws9010"), true);
  assert.equal(matchesSearch("WS 9010 คีมปากจิ้งจก", "WS9010"), true);
  assert.equal(matchesSearch("MT013 มีดคัตเตอร์", "mt-013"), true);
  assert.equal(matchesSearch("มีดคัตเตอร์", "คัตเตอร์"), true);
  assert.equal(matchesSearch("มีดคัตเตอร์", "กรรไกร"), false);
  assert.equal(matchesSearch("อะไรก็ได้", "  "), true);
});
